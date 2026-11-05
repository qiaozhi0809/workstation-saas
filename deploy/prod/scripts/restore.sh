#!/usr/bin/env bash
# 恢复:在部署目录里执行 ./scripts/restore.sh <备份文件> [--yes]
#
# 所有校验都在动数据库之前完成:文件存在可读、归档完整且只含 4 个普通文件(拒绝路径穿越、链接)、
# manifest.json 严格符合本系统格式、sha256 全部对得上、env 含必需键且值非空、caddy.tar 可完整读出且不含绝对路径 / .. /
# 链接 / 设备文件、大版本一致、备份的迁移版本不比当前镜像的 head 新、磁盘空间够(max(当前库大小, db.dump 大小的 6 倍)的 1.2 倍,见"3. 先恢复进临时库"处的说明)。
# 取镜像 head 的办法:用当前 app 镜像执行 python 读 alembic 的 ScriptDirectory(不连库、不改库)。
#
# 恢复顺序与理由:
#   1) 先把备份里的库恢复进一个临时库 ws_restore_tmp(此时 app 仍在运行,正式库完全没动);
#      备份文件读不出来、版本不兼容等问题在这里暴露,系统原样可用。
#   2) 停 app、scheduler;换库采用"先改名、最后再删":终止正式库上的连接 → 正式库改名 ws_restore_old →
#      临时库改名为正式库名 → 两次改名都成功后才 DROP ws_restore_old。任何一步失败,按真实状态(查 pg_database)
#      把旧库改回来;状态确认不了(查询失败、改回失败)时绝不删临时库、不重启服务,提示"状态不确定、备份完好、重跑命令"。
#   3) .env 的取舍(与计划里"默认用备份的 .env"不同,有意为之):备份的 .env 只用来取"与数据绑定"的值:
#      WS_MASTER_KEY、WS_JWT_SECRET、WS_SCHOOL_ID(数据用主密钥加密、令牌与学校 ID 绑在数据里)。
#      其余键一律保留当前机器的值,因为它们是部署环境属性,不是数据属性:POSTGRES_PASSWORD 与 WS_DATABASE_URL
#      (pg 角色密码是装机时定的,不随 pg_restore 变,换成备份里的会让 app 连不上库)、WS_VERSION、WS_REDIS_URL、
#      WS_ENV、WS_TRUSTED_PROXIES、站点地址 / 端口 / 证书方式 / ACME 邮箱。备份里有而当前没有的键追加到末尾。
#      结果与当前 .env 不同时,旧 .env 另存为 .env.before-restore-<时间>(600)。
#   4) web 保持运行,经容器把 Caddy 数据写回(--no-same-owner),再重启 web 让 Caddy 重新加载证书。
#   5) 清 Redis(会话全部失效,所有人重新登录;在 app 停止期间清,避免与新进程竞争)。
#   6) compose up -d --pull never 启动全部服务(app 启动时自动迁移到当前版本),等 app 健康后再 up 一次,
#      并确认 scheduler 在运行、web 健康(start_and_verify),缺一不报"恢复完成"。
# 备份 / 恢复 / 升级互斥(backups/.lock)。
# 安全约定:不开 xtrace;不打印 .env 内容与密钥;回显容器输出前先过 redact;解包用 --no-same-owner。
set +x
unset BASH_XTRACEFD
set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

umask 077

WORK=""
PKG=""
TMPDB_MADE=0
STOPPED=0
SWAP=0          # 0 未开始换库;1 即将改名;2 旧库已改名(新库未就位);3 新库已就位(旧库待删);4 全部完成
ENV_SAVED=""
HEALTH_TIMEOUT="${WS_RESTORE_HEALTH_TIMEOUT:-300}"
TMPDB="ws_restore_tmp"
OLDDB="ws_restore_old"

pg_sh() { compose exec -T postgres sh -c "$1" </dev/null; }

# pgsql <SQL>:经 stdin 把 SQL 交给 postgres 容器里的 psql(连 postgres 库;psql 变量 :"db" / :'db' 是正式库名,
# 取容器环境里的 POSTGRES_DB)。输出先过 redact 再给调用者;psql 失败时返回非 0。
pgsql() {
  printf '%s\n' "$1" | compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d postgres -v ON_ERROR_STOP=1 -tA -v "db=$POSTGRES_DB" -f -' 2>&1 | redact
}

# db_has main|<库名>:库存在输出 1,不存在输出 0;查询本身失败返回非 0
db_has() {
  local sql out
  if [ "$1" = "main" ]; then
    sql="SELECT count(*) FROM pg_database WHERE datname = :'db';"
  else
    sql="SELECT count(*) FROM pg_database WHERE datname = '$1';"
  fi
  out="$(pgsql "$sql")" || return 1
  out="$(printf '%s' "$out" | tr -d '[:space:]')"
  case "$out" in 0|1) printf '%s' "$out" ;; *) return 1 ;; esac
}

# 异常退出时判断正式库的真实状态并尽量还原。输出:intact(正式库是原来的旧库)/ swapped(新库已就位)/ uncertain
swap_state_after_failure() {
  local m o
  m="$(db_has main)" || { printf uncertain; return 0; }
  o="$(db_has "$OLDDB")" || { printf uncertain; return 0; }
  if [ "$m" = "1" ] && [ "$o" = "0" ]; then printf intact
  elif [ "$m" = "0" ] && [ "$o" = "1" ]; then
    if pgsql "ALTER DATABASE \"$OLDDB\" RENAME TO :\"db\";" >/dev/null 2>&1; then printf intact; else printf uncertain; fi
  elif [ "$m" = "1" ] && [ "$o" = "1" ]; then printf swapped
  else printf uncertain
  fi
}

cleanup() {
  local rc=$?
  trap - EXIT
  local state=""
  if [ "$rc" -ne 0 ]; then
    if [ "$SWAP" -ge 1 ] && [ "$SWAP" -le 2 ]; then
      state="$(swap_state_after_failure)"
      if [ "$state" = "swapped" ]; then SWAP=3; TMPDB_MADE=0; fi
    elif [ "$SWAP" -ge 3 ]; then
      state="swapped"
    else
      state="intact"
    fi
  fi
  # 临时库只在"确认正式库状态"之后才清;状态不确定时保留,留给人工判断
  if [ "$TMPDB_MADE" -eq 1 ] && { [ "$rc" -eq 0 ] || [ "$state" = "intact" ]; }; then
    pg_sh "psql -U \"\$POSTGRES_USER\" -d postgres -c 'DROP DATABASE IF EXISTS $TMPDB WITH (FORCE)'" >/dev/null 2>&1 || true
  fi
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
  lib_cleanup
  if [ "$rc" -ne 0 ]; then
    case "$state" in
      intact)
        if [ "$STOPPED" -eq 1 ]; then
          if [ "$SWAP" -ge 1 ]; then
            printf '\n恢复在替换数据库时失败:旧的正式数据库已改回原名,正式数据库已还原、数据没有被改动。正在重新启动服务……\n' >&2
          else
            printf '\n恢复在替换数据库之前失败:正式数据库没有被改动。正在重新启动服务……\n' >&2
          fi
          compose up -d --pull never >/dev/null 2>&1 || printf '自动启动失败,请手动执行:docker compose -p %s --project-directory %s up -d\n' "${WS_COMPOSE_PROJECT:-workstation}" "$DEPLOY_DIR" >&2
        fi
        ;;
      uncertain)
        {
          printf '\n恢复在替换数据库时失败,并且无法确认正式数据库的状态(状态不确定),服务保持停止,请不要直接启动。\n'
          printf '旧的正式数据库如果还在,会保存在名为 %s 的库里;临时库 %s 已保留,没有删除。\n' "$OLDDB" "$TMPDB"
          printf '备份文件完好,没有被改动:%s\n' "$PKG"
          printf '请先确认数据库服务正常,然后重新执行:./scripts/restore.sh %s --yes\n' "$PKG"
        } >&2
        ;;
      swapped)
        {
          printf '\n恢复在数据库已替换之后失败:系统可能处于"数据库已换成备份、其余部分未完成"的状态,请不要直接使用。\n'
          printf '备份文件没有被改动:%s\n' "$PKG"
          if [ -n "$ENV_SAVED" ]; then printf '恢复前的 .env 已另存为:%s\n' "$ENV_SAVED"; fi
          printf '请根据上面的错误修正原因后,重新执行:./scripts/restore.sh %s --yes\n' "$PKG"
        } >&2
        ;;
    esac
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
  # 清单 / 条目表一律用 here-string 喂给 grep:不用 printf | grep -q(pipefail 下 grep 提前退出会让管道返回 141,
  # 检查被绕过——条目很多、第一项就是链接的恶意归档正是这样绕过 grep -Evq 的)
  if grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$list"; then
    die "备份文件里含有不安全的路径(绝对路径或 ..),已拒绝,数据库未改动"
  fi
  vlist="$(tar -tvzf "$pkg" 2>/dev/null)" || die "备份文件无法读取(文件损坏、不完整或不是 tar.gz),已拒绝,数据库未改动"
  if grep -Evq '^-' <<<"$vlist"; then
    die "备份文件里含有链接、目录或特殊文件,已拒绝,数据库未改动"
  fi
  names="$(printf '%s\n' "$list" | sed 's#^\./##')"
  if grep -Evxq 'db\.dump|env|caddy\.tar|manifest\.json' <<<"$names"; then
    die "备份文件里有不认识的条目,已拒绝,数据库未改动"
  fi
  dup="$(printf '%s\n' "$names" | sort | uniq -d)"
  [ -z "$dup" ] || die "备份文件里有重复条目,已拒绝,数据库未改动"
  grep -qx 'manifest\.json' <<<"$names" || die "备份文件里没有 manifest.json,已拒绝,数据库未改动"
  local f
  for f in db.dump env caddy.tar; do
    grep -qx "$f" <<<"$names" || die "备份文件不完整,缺少 $f,已拒绝,数据库未改动"
  done
}

# caddy.tar(会在 web 容器里以 root 解开,必须先在宿主机上验清楚):能完整读出,不含绝对路径、..、链接、设备文件
check_caddy_tar() {
  local f="$1" list vlist
  list="$(tar -tf "$f" 2>/dev/null)" || die "备份里的 caddy.tar 不是有效的归档(读不出来),已拒绝,数据库未改动"
  vlist="$(tar -tvf "$f" 2>/dev/null)" || die "备份里的 caddy.tar 不是有效的归档(读不出来),已拒绝,数据库未改动"
  [ -n "$list" ] || die "备份里的 caddy.tar 是空的,已拒绝,数据库未改动"
  if grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$list"; then
    die "备份里的 caddy.tar 含有不安全的路径(绝对路径或 ..),已拒绝,数据库未改动"
  fi
  if grep -Evq '^[-d]' <<<"$vlist" || grep -Eq ' -> | link to ' <<<"$vlist"; then
    die "备份里的 caddy.tar 含有链接或设备文件,已拒绝,数据库未改动"
  fi
}

manifest_field() { sed -n "s/^  \"$1\": \"\\([^\"]*\\)\",\$/\\1/p" "$2" | head -n 1; }

main() {
  local arg yes=0 pkg_arg="" bver cur_version bmig created out rc head known name want got ans ts newenv m o need_kb avail_kb line dump_bytes cur_bytes est_bytes
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
  require_compose_version
  cd "$DEPLOY_DIR"
  acquire_lock
  clean_stale_tmp

  # ---- 1. 全部校验(不动数据库、不停服务) ----
  check_archive "$PKG"
  WORK="$(mktemp -d "$DEPLOY_DIR/.ws-restore.XXXXXX")"
  tar -xzf "$PKG" -C "$WORK" --no-same-owner || die "解包失败,已拒绝,数据库未改动"
  if [ -n "$(find "$WORK" -mindepth 1 \( ! -type f \) | head -n 1)" ]; then
    die "备份文件解开后含有链接或特殊文件,已拒绝,数据库未改动"
  fi
  manifest_valid "$WORK/manifest.json" || die "manifest.json 不是本系统生成的格式,已拒绝,数据库未改动"
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
  if [ ! -s "$WORK/env" ]; then die "备份里的 env 是空的,已拒绝,数据库未改动"; fi
  for name in WS_MASTER_KEY WS_JWT_SECRET POSTGRES_PASSWORD WS_DATABASE_URL; do
    [ -n "$(read_env "$name" "$WORK/env")" ] || die "备份里的 env 缺少 $name 或它的值为空,已拒绝,数据库未改动"
  done
  check_caddy_tar "$WORK/caddy.tar"
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
  # 磁盘空间:恢复期间旧库(ws_restore_old)与新库(临时库)同时存在。旧库已占着磁盘,新库还要新增空间。
  # 估算新增量 = max(当前库的 pg_database_size, db.dump 大小 × 6) × 1.2:
  #   * pg_dump -Fc 默认压缩,还原后的库通常是 dump 的 2-5 倍(含索引更大),取 6 倍留余量;
  #   * 备份可能比当前库小(如恢复一份很早的备份),此时按当前库大小估,避免低估;
  #   * 再乘 1.2 给 WAL 与临时文件留 20% 余量。可用空间不足这个数就在动库之前拒绝。
  dump_bytes="$(wc -c <"$WORK/db.dump" | tr -d '[:space:]')"
  cur_bytes="$(pgsql "SELECT pg_database_size(:'db');" | tr -d '[:space:]')" || cur_bytes=""
  case "$cur_bytes" in ''|*[!0-9]*) die "查询当前数据库大小失败,无法预估磁盘空间,数据库未改动" ;; esac
  est_bytes=$((dump_bytes * 6))
  if [ "$cur_bytes" -gt "$est_bytes" ]; then est_bytes="$cur_bytes"; fi
  need_kb=$(( est_bytes * 12 / 10 / 1024 + 1 ))
  avail_kb="$(df -Pk "$DEPLOY_DIR" | awk 'NR==2 {print $4}')"
  if [ "$avail_kb" -lt "$need_kb" ]; then
    die "磁盘空间不足:恢复需要约 $((need_kb / 1024)) MB 可用空间(取当前数据库大小与备份数据库大小 6 倍中较大者的 1.2 倍),当前约 $((avail_kb / 1024)) MB,数据库未改动"
  fi
  # 上一次异常中断可能留下 ws_restore_old:正式库还在就删掉它;正式库不在,说明停在换库中途,先把它改回来
  m="$(db_has main)" || die "查询数据库状态失败,数据库未改动"
  o="$(db_has "$OLDDB")" || die "查询数据库状态失败,数据库未改动"
  if [ "$o" = "1" ]; then
    if [ "$m" = "1" ]; then
      pgsql "DROP DATABASE IF EXISTS \"$OLDDB\" WITH (FORCE);" >/dev/null || die "清理上次遗留的 $OLDDB 失败,数据库未改动"
    else
      log_warn "上次恢复在换库中途中断:正式库缺失,把遗留的 $OLDDB 改回正式库名"
      pgsql "ALTER DATABASE \"$OLDDB\" RENAME TO :\"db\";" >/dev/null || die "无法把 $OLDDB 改回正式库名,数据库未改动,请联系技术支持(备份文件完好)"
    fi
  elif [ "$m" = "0" ]; then
    die "找不到正式数据库,也没有遗留的旧库,已停止(备份文件完好),请联系技术支持"
  fi
  log_info "把备份恢复进临时库(此时正式库不受影响)……"
  TMPDB_MADE=1
  pgsql "DROP DATABASE IF EXISTS \"$TMPDB\" WITH (FORCE); CREATE DATABASE \"$TMPDB\";" >/dev/null \
    || die "创建临时库失败,数据库未改动"
  if ! compose exec -T postgres sh -c "pg_restore -U \"\$POSTGRES_USER\" -d $TMPDB --no-owner --exit-on-error" <"$WORK/db.dump" 2>&1 | redact >"$WORK/pgrestore.log"; then
    # 只回显 pg_restore 自己的错误行(再套一遍手机号等打码),不回显其余输出
    { grep '^pg_restore: error:' "$WORK/pgrestore.log" || true; } | tail -n 8 | mask_shapes >&2
    die "pg_restore 失败(备份里的数据库文件不能用),数据库未改动"
  fi

  # ---- 4. 停服务、换库(先改名、最后再删) ----
  log_info "停止应用与定时任务……"
  STOPPED=1
  compose stop app scheduler 2>&1 | redact >/dev/null || die "停止服务失败"
  log_info "替换数据库……"
  SWAP=1
  pgsql "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = :'db' AND pid <> pg_backend_pid();" >"$WORK/swap.log" \
    || { tail -n 8 "$WORK/swap.log" >&2; die "替换数据库失败(清除正式库上的连接时出错)"; }
  pgsql "ALTER DATABASE :\"db\" RENAME TO \"$OLDDB\";" >"$WORK/swap.log" \
    || { tail -n 8 "$WORK/swap.log" >&2; die "替换数据库失败(把正式库改名为 $OLDDB 时出错)"; }
  SWAP=2
  pgsql "ALTER DATABASE \"$TMPDB\" RENAME TO :\"db\";" >"$WORK/swap.log" \
    || { tail -n 8 "$WORK/swap.log" >&2; die "替换数据库失败(把临时库改名为正式库时出错)"; }
  SWAP=3
  TMPDB_MADE=0
  if pgsql "DROP DATABASE IF EXISTS \"$OLDDB\" WITH (FORCE);" >/dev/null; then
    SWAP=4
  else
    log_warn "恢复后的新库已就位,但旧库 $OLDDB 没能删除(占用磁盘空间,下次备份 / 恢复前会自动清理)"
    SWAP=4
  fi

  # ---- 5. .env:只取与数据绑定的值,其余保留当前机器的(理由见文件头注释) ----
  newenv="$WORK/env.new"
  cp "$ENV_FILE" "$newenv"
  chmod 600 "$newenv"
  for name in WS_MASTER_KEY WS_JWT_SECRET WS_SCHOOL_ID; do
    want="$(read_env "$name" "$WORK/env")"
    if [ -n "$want" ] && [ "$want" != "$(read_env "$name" "$newenv")" ]; then
      set_env "$name" "$want" "$newenv"
    fi
  done
  while IFS= read -r line || [ -n "$line" ]; do
    name="${line%%=*}"
    case "$name" in
      ''|*[!A-Za-z0-9_]*|[0-9]*) continue ;;
    esac
    case "$line" in *=*) ;; *) continue ;; esac
    grep -q "^$name=" "$newenv" || set_env "$name" "$(read_env "$name" "$WORK/env")" "$newenv"
  done <"$WORK/env"
  if cmp -s "$newenv" "$ENV_FILE"; then
    log_info ".env 里与数据绑定的值与备份一致,不改动"
  else
    ts="$(date +%Y%m%d-%H%M%S)"
    ENV_SAVED="$DEPLOY_DIR/.env.before-restore-$ts"
    cp "$ENV_FILE" "$ENV_SAVED"
    chmod 600 "$ENV_SAVED"
    mv "$newenv" "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    log_warn ".env 里与数据绑定的值(主密钥、令牌密钥、学校 ID)已换成备份里的,数据库密码、站点与端口等保留当前机器的;恢复前的 .env 另存为 $ENV_SAVED"
  fi

  # ---- 6. Caddy 数据(经 web 容器写回),再重启 web ----
  log_info "写回 Caddy 数据……"
  compose exec -T web tar -C /data --no-same-owner -xf - <"$WORK/caddy.tar" 2>&1 | redact >"$WORK/caddy.log" \
    || { tail -n 8 "$WORK/caddy.log" >&2; die "写回 Caddy 数据失败"; }
  compose restart web 2>&1 | redact >/dev/null || die "重启 web 失败"

  # ---- 7. 清会话、启动、等健康 ----
  log_info "清除登录会话(所有人需要重新登录)……"
  compose exec -T redis redis-cli FLUSHDB </dev/null 2>&1 | redact >/dev/null || die "清除 Redis 会话失败"
  log_info "启动服务(应用启动时会自动迁移到当前版本)……"
  # app 健康、scheduler 在运行、web 健康,三者缺一都不能报"恢复完成"(见 lib.sh 的 start_and_verify)
  start_and_verify "$HEALTH_TIMEOUT"
  STOPPED=0
  log_info "恢复完成:已用 $(basename "$PKG") 恢复数据库、.env 与 Caddy 数据,所有人需要重新登录"
}

main "$@"
exit 0
