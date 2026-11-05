#!/usr/bin/env bash
# 恢复:在部署目录里执行 ./scripts/restore.sh <备份文件> [--yes]
#
# 所有校验都在动数据库之前完成:文件存在可读、归档完整且只含 4 个普通文件(拒绝路径穿越、链接)、
# manifest.json 合法、sha256 全部对得上、大版本一致、备份的迁移版本不比当前镜像的 head 新。
# 取镜像 head 的办法:用当前 app 镜像执行 python 读 alembic 的 ScriptDirectory(不连库、不改库)。
#
# 恢复顺序与理由:
#   1) 先把备份里的库恢复进一个临时库 ws_restore_tmp(此时 app 仍在运行,正式库完全没动);
#      备份文件读不出来、版本不兼容等问题在这里暴露,系统原样可用。
#   2) 停 app、scheduler;DROP 正式库并把临时库改名为正式库名(改名瞬间完成,旧库被删与新库就位之间窗口极短)。
#   3) .env 与当前不同时用备份里的(主密钥必须与数据一致),WS_VERSION 保持当前值;旧 .env 另存为 .env.before-restore-<时间>(600)。
#   4) web 保持运行,经容器把 Caddy 数据写回,再重启 web 让 Caddy 重新加载证书。
#   5) 清 Redis(会话全部失效,所有人重新登录;在 app 停止期间清,避免与新进程竞争)。
#   6) compose up -d --pull never 启动全部服务(app 启动时自动迁移到当前版本),等 app 健康。
# 安全约定:不开 xtrace;不打印 .env 内容与密钥;回显容器输出前先过 redact;解包用 --no-same-owner。
set +x
unset BASH_XTRACEFD
set -euo pipefail

# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

umask 077

WORK=""
PKG=""
TMPDB_MADE=0
STOPPED=0
SWAPPED=0
ENV_SAVED=""
HEALTH_TIMEOUT="${WS_RESTORE_HEALTH_TIMEOUT:-300}"
TMPDB="ws_restore_tmp"

pg_sh() { compose exec -T postgres sh -c "$1" </dev/null; }

cleanup() {
  local rc=$?
  trap - EXIT
  if [ "$TMPDB_MADE" -eq 1 ] && [ "$SWAPPED" -eq 0 ]; then
    pg_sh "psql -U \"\$POSTGRES_USER\" -d postgres -c 'DROP DATABASE IF EXISTS $TMPDB WITH (FORCE)'" >/dev/null 2>&1 || true
  fi
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
  lib_cleanup
  if [ "$rc" -ne 0 ] && [ "$STOPPED" -eq 1 ]; then
    if [ "$SWAPPED" -eq 0 ]; then
      printf '\n恢复在替换数据库之前失败:正式数据库没有被改动。正在重新启动服务……\n' >&2
      compose up -d --pull never >/dev/null 2>&1 || printf '自动启动失败,请手动执行:docker compose -p %s --project-directory %s up -d\n' "${WS_COMPOSE_PROJECT:-workstation}" "$DEPLOY_DIR" >&2
    else
      {
        printf '\n恢复在数据库已替换之后失败:系统可能处于"数据库已换成备份、其余部分未完成"的状态,请不要直接使用。\n'
        printf '备份文件没有被改动:%s\n' "$PKG"
        if [ -n "$ENV_SAVED" ]; then printf '恢复前的 .env 已另存为:%s\n' "$ENV_SAVED"; fi
        printf '请根据上面的错误修正原因后,重新执行:./scripts/restore.sh %s --yes\n' "$PKG"
      } >&2
    fi
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

major_of() { printf '%s' "${1%%.*}"; }

# 解包前检查归档:只允许 db.dump、env、caddy.tar、manifest.json 四个普通文件
check_archive() {
  local pkg="$1" list vlist names dup
  # gzip -t 读完整个压缩流并校验 CRC(bsdtar 的 -t 不一定会读完,不能只靠 tar)
  gzip -t "$pkg" 2>/dev/null || die "备份文件无法读取(文件损坏、不完整或不是 tar.gz),已拒绝,数据库未改动"
  list="$(tar -tzf "$pkg" 2>/dev/null)" || die "备份文件无法读取(文件损坏、不完整或不是 tar.gz),已拒绝,数据库未改动"
  [ -n "$list" ] || die "备份文件是空的,已拒绝"
  if printf '%s\n' "$list" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    die "备份文件里含有不安全的路径(绝对路径或 ..),已拒绝,数据库未改动"
  fi
  vlist="$(tar -tvzf "$pkg" 2>/dev/null)" || die "备份文件无法读取(文件损坏、不完整或不是 tar.gz),已拒绝,数据库未改动"
  if printf '%s\n' "$vlist" | grep -Evq '^-'; then
    die "备份文件里含有链接、目录或特殊文件,已拒绝,数据库未改动"
  fi
  names="$(printf '%s\n' "$list" | sed 's#^\./##')"
  if printf '%s\n' "$names" | grep -Evxq 'db\.dump|env|caddy\.tar|manifest\.json'; then
    die "备份文件里有不认识的条目,已拒绝,数据库未改动"
  fi
  dup="$(printf '%s\n' "$names" | sort | uniq -d)"
  [ -z "$dup" ] || die "备份文件里有重复条目,已拒绝,数据库未改动"
  printf '%s\n' "$names" | grep -qx 'manifest\.json' || die "备份文件里没有 manifest.json,已拒绝,数据库未改动"
  local f
  for f in db.dump env caddy.tar; do
    printf '%s\n' "$names" | grep -qx "$f" || die "备份文件不完整,缺少 $f,已拒绝,数据库未改动"
  done
}

# manifest.json 必须是本系统写出的格式(逐行严格匹配);通过返回 0
manifest_valid() {
  awk '
    BEGIN { st = 0; nf = 0 }
    st == 0 { if ($0 == "{") { st = 1; next } else bad = 1 }
    st == 1 { if ($0 ~ /^  "version": "[A-Za-z0-9._-]+",$/) { st = 2; next } else bad = 1 }
    st == 2 { if ($0 ~ /^  "migration": "[0-9A-Za-z_]+",$/) { st = 3; next } else bad = 1 }
    st == 3 { if ($0 ~ /^  "created_at": "[0-9T:Z-]+",$/) { st = 4; next } else bad = 1 }
    st == 4 { if ($0 == "  \"files\": {") { st = 5; next } else bad = 1 }
    st == 5 {
      if ($0 ~ /^    "[A-Za-z0-9._-]+": "[0-9a-f]+",?$/) { nf++; next }
      else if ($0 == "  }") { st = 6; next } else bad = 1
    }
    st == 6 { if ($0 == "}") { st = 7; next } else bad = 1 }
    st == 7 { bad = 1 }
    END { exit (bad || st != 7 || nf < 1) ? 1 : 0 }
  ' "$1"
}

manifest_field() { sed -n "s/^  \"$1\": \"\\([^\"]*\\)\",\$/\\1/p" "$2" | head -n 1; }

main() {
  local arg yes=0 pkg_arg="" bver cur_version bmig created out rc head known name want got ans ts newenv
  for arg in "$@"; do
    case "$arg" in
      --yes) yes=1 ;;
      -h|--help) printf '用法:./scripts/restore.sh <备份文件> [--yes]\n'; exit 0 ;;
      -*) die "不认识的参数:$arg(用法:./scripts/restore.sh <备份文件> [--yes])" ;;
      *) [ -z "$pkg_arg" ] || die "只能给一个备份文件"; pkg_arg="$arg" ;;
    esac
  done
  [ -n "$pkg_arg" ] || die "用法:./scripts/restore.sh <备份文件> [--yes]"
  [ -e "$pkg_arg" ] || die "找不到备份文件:$pkg_arg"
  [ -f "$pkg_arg" ] || die "不是普通文件:$pkg_arg"
  [ -r "$pkg_arg" ] || die "备份文件不可读:$pkg_arg(检查文件权限)"
  PKG="$(cd "$(dirname "$pkg_arg")" && pwd)/$(basename "$pkg_arg")"
  [ -f "$ENV_FILE" ] || die "当前目录没有 .env,看起来还没安装;请先运行 scripts/install.sh"
  [ -f "$DEPLOY_DIR/VERSION" ] || die "部署目录里缺少 VERSION 文件"
  require_cmd docker "请先安装 Docker Engine"
  cd "$DEPLOY_DIR"

  # ---- 1. 全部校验(不动数据库、不停服务) ----
  check_archive "$PKG"
  WORK="$(mktemp -d "$DEPLOY_DIR/.ws-restore.XXXXXX")"
  tar -xzf "$PKG" -C "$WORK" --no-same-owner || die "解包失败,已拒绝,数据库未改动"
  if [ -n "$(find "$WORK" -mindepth 1 \( ! -type f \) | head -n 1)" ]; then
    die "备份文件解开后含有链接或特殊文件,已拒绝,数据库未改动"
  fi
  manifest_valid "$WORK/manifest.json" || die "manifest.json 不是合法的 JSON(或不是本系统生成的格式),已拒绝,数据库未改动"
  bver="$(manifest_field version "$WORK/manifest.json")"
  bmig="$(manifest_field migration "$WORK/manifest.json")"
  created="$(manifest_field created_at "$WORK/manifest.json")"
  for name in db.dump env caddy.tar; do
    want="$(sed -n "s/^    \"$name\": \"\\([0-9a-f]*\\)\",\\{0,1\\}\$/\\1/p" "$WORK/manifest.json" | head -n 1)"
    [ -n "$want" ] || die "manifest.json 里没有 $name 的校验和,已拒绝,数据库未改动"
    got="$(sha256_of "$WORK/$name")"
    [ "$want" = "$got" ] || die "备份里的 $name 校验和不符(文件已损坏或被改动),已拒绝,数据库未改动"
  done
  if [ "$(grep -c '^    "' "$WORK/manifest.json")" -ne 3 ]; then
    die "manifest.json 的文件清单与备份内容不一致,已拒绝,数据库未改动"
  fi
  cur_version="$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")"
  if [ "$(major_of "$bver")" != "$(major_of "$cur_version")" ]; then
    die "备份来自版本 $bver,当前版本 $cur_version:大版本不同,本脚本拒绝恢复,数据库未改动。请用对应大版本的离线包恢复"
  fi
  log_info "备份校验通过:版本 $bver,迁移 $bmig,创建于 $created"

  service_running postgres || die "数据库服务没有在运行,无法恢复。请先执行:docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' up -d postgres"
  service_running web || die "web 服务没有在运行,无法写回 Caddy 数据。请先执行:docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' up -d web"
  service_running redis || die "redis 服务没有在运行,无法清除会话。请先执行:docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' up -d redis"

  # 当前镜像的迁移 head(不连库);备份的迁移必须是 head 或其祖先
  rc=0
  out="$(compose run --rm -T --no-deps --entrypoint python app -c '
import sys
from alembic.config import Config
from alembic.script import ScriptDirectory
s = ScriptDirectory.from_config(Config("alembic.ini"))
print("HEAD=" + str(s.get_current_head()))
print("KNOWN=" + ("1" if sys.argv[1] in {r.revision for r in s.walk_revisions()} else "0"))
' "$bmig" </dev/null 2>&1)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '%s\n' "$out" | tail -n 8 | redact >&2
    die "读取当前镜像的迁移版本失败(退出码 $rc),已拒绝,数据库未改动"
  fi
  head="$(printf '%s\n' "$out" | sed -n 's/^HEAD=//p' | tail -n 1)"
  known="$(printf '%s\n' "$out" | sed -n 's/^KNOWN=//p' | tail -n 1)"
  [ -n "$head" ] && [ -n "$known" ] || die "没能读到当前镜像的迁移版本,已拒绝,数据库未改动"
  if [ "$known" != "1" ]; then
    die "备份的数据库迁移版本 $bmig 比当前镜像的最新迁移 $head 新(或不认识),已拒绝,数据库未改动。请先用对应版本的离线包恢复"
  fi
  log_info "迁移版本检查通过:备份 $bmig,当前镜像 head $head"

  # ---- 2. 确认 ----
  printf '\n将用备份 %s 覆盖当前的数据库、.env 与 Caddy 数据。\n' "$(basename "$PKG")"
  printf '恢复期间系统暂停服务;所有人需要重新登录;当前数据库里备份之后产生的数据会丢失。\n'
  if [ "$yes" -ne 1 ]; then
    [ -t 0 ] || die "当前不是交互终端,必须加 --yes 才能恢复;已取消,数据库未改动"
    printf '确认恢复请输入 yes:'
    read -r ans || ans=""
    [ "$ans" = "yes" ] || die "已取消,数据库未改动"
  fi

  # ---- 3. 先恢复进临时库(正式库与服务都还没动) ----
  log_info "把备份恢复进临时库(此时正式库不受影响)……"
  TMPDB_MADE=1
  pg_sh "psql -U \"\$POSTGRES_USER\" -d postgres -v ON_ERROR_STOP=1 -c 'DROP DATABASE IF EXISTS $TMPDB WITH (FORCE)' -c 'CREATE DATABASE $TMPDB'" 2>&1 | redact >/dev/null \
    || die "创建临时库失败,数据库未改动"
  if ! compose exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $TMPDB --no-owner --exit-on-error" <"$WORK/db.dump" 2>&1 | redact >"$WORK/pgrestore.log"; then
    tail -n 8 "$WORK/pgrestore.log" >&2
    die "pg_restore 失败(备份里的数据库文件不能用),数据库未改动"
  fi

  # ---- 4. 停服务、换库 ----
  log_info "停止应用与定时任务……"
  STOPPED=1
  compose stop app scheduler 2>&1 | redact >/dev/null || die "停止服务失败"
  log_info "替换数据库……"
  pg_sh "psql -U \"\$POSTGRES_USER\" -d postgres -v ON_ERROR_STOP=1 -c \"DROP DATABASE IF EXISTS \\\"\$POSTGRES_DB\\\" WITH (FORCE)\" -c \"ALTER DATABASE $TMPDB RENAME TO \\\"\$POSTGRES_DB\\\"\"" 2>&1 | redact >"$WORK/swap.log" \
    || { tail -n 8 "$WORK/swap.log" >&2; die "替换数据库失败"; }
  SWAPPED=1

  # ---- 5. .env ----
  newenv="$WORK/env.new"
  cp "$WORK/env" "$newenv"
  chmod 600 "$newenv"
  set_env WS_VERSION "$cur_version" "$newenv"
  if cmp -s "$newenv" "$ENV_FILE"; then
    log_info ".env 与备份里的一致,不改动"
  else
    ts="$(date +%Y%m%d-%H%M%S)"
    ENV_SAVED="$DEPLOY_DIR/.env.before-restore-$ts"
    cp "$ENV_FILE" "$ENV_SAVED"
    chmod 600 "$ENV_SAVED"
    mv "$newenv" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    log_warn ".env 与备份里的不同,已改用备份里的(主密钥必须与数据一致,WS_VERSION 保持当前版本);恢复前的 .env 另存为 $ENV_SAVED"
  fi

  # ---- 6. Caddy 数据(经 web 容器写回),再重启 web ----
  log_info "写回 Caddy 数据……"
  compose exec -T web tar -C /data -xf - <"$WORK/caddy.tar" 2>&1 | redact >"$WORK/caddy.log" \
    || { tail -n 8 "$WORK/caddy.log" >&2; die "写回 Caddy 数据失败"; }
  compose restart web 2>&1 | redact >/dev/null || die "重启 web 失败"

  # ---- 7. 清会话、启动、等健康 ----
  log_info "清除登录会话(所有人需要重新登录)……"
  compose exec -T redis redis-cli FLUSHDB </dev/null 2>&1 | redact >/dev/null || die "清除 Redis 会话失败"
  log_info "启动服务(应用启动时会自动迁移到当前版本)……"
  if ! out="$(compose up -d --pull never 2>&1)"; then
    log_warn "docker compose up 返回非 0,最后几行输出:"
    printf '%s\n' "$out" | tail -n 8 | redact >&2
  fi
  wait_healthy app "$HEALTH_TIMEOUT" || die "恢复后应用没有在 ${HEALTH_TIMEOUT} 秒内就绪,请查看:docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' logs app"
  STOPPED=0
  log_info "恢复完成:已用 $(basename "$PKG") 恢复数据库、.env 与 Caddy 数据,所有人需要重新登录"
}

main "$@"
exit 0
