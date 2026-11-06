#!/usr/bin/env bash
# 升级失败后回到旧版本(L179 / L190):在部署目录里执行 ./scripts/rollback.sh [<快照目录>]
#
# upgrade.sh 在覆盖程序文件之前把旧版的 docker-compose.yml、Caddyfile*、VERSION、.env.example、scripts/、systemd/
# 存进 backups/pre-upgrade-<旧版>-<时间>/。本脚本做的事:
#   1) 把快照里的文件复制回部署目录(用"写临时文件再改名",正在运行的本脚本不会被改坏);
#   2) 把 .env 里的 WS_VERSION 改回快照里的版本(旧版本镜像升级时没有删);
#   3) 清掉升级状态文件 backups/.ws-upgrade-state 与中断留下的解包目录;
#   4) 比对数据库的迁移版本与旧版镜像的迁移 head:
#        一致 → 新版本没有动过数据库结构,直接用旧版镜像重启全部服务并确认健康,回退完成;
#        不一致 → 数据库已被新版本迁移,旧程序不能直接用它:停掉应用容器,提示用升级前的备份执行 restore.sh(退出码 3)。
# 不带参数时用状态文件里记录的快照;没有状态文件就必须指定。不动 .env 里 WS_VERSION 以外的键(新版本追加的键对旧版无害)。
# 与备份 / 恢复 / 升级互斥(backups/.lock);升级进程被 kill -9 留下的锁会被接管。
# 安全约定:不开 xtrace;不打印密钥;回显容器输出前先过 redact。
set +x
unset BASH_XTRACEFD
set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

STATE_FILE="$DEPLOY_DIR/backups/.ws-upgrade-state"
HEALTH_TIMEOUT="${WS_ROLLBACK_HEALTH_TIMEOUT:-300}"

cleanup() {
  local rc=$?
  trap - EXIT
  lib_cleanup
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

usage() {
  cat <<'USAGE'
用法:./scripts/rollback.sh [<快照目录>]
  快照目录是 upgrade.sh 覆盖文件前保存的 backups/pre-upgrade-<旧版>-<时间>;不给时取 backups/.ws-upgrade-state 里记录的那个。
  退出码:0 回退完成且旧版本已在运行;3 程序文件已还原,但数据库已被新版本迁移,需要再执行 restore.sh <升级前备份>。
USAGE
}

list_snapshots() { ls -1d "$DEPLOY_DIR"/backups/pre-upgrade-* 2>/dev/null | sort || true; }

# 用旧版镜像(此时 .env 的 WS_VERSION 已改回)读 alembic 的 head,不连库、不改库;读不到输出空
old_image_head() {
  local out
  out="$(compose run --rm -T --no-deps --entrypoint python app -c '
from alembic.config import Config
from alembic.script import ScriptDirectory
print("HEAD=" + str(ScriptDirectory.from_config(Config("alembic.ini")).get_current_head()))
' </dev/null 2>/dev/null)" || return 0
  printf '%s\n' "$out" | sed -n 's/^HEAD=//p' | tail -n 1
}

db_revision() {
  compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT version_num FROM alembic_version"' </dev/null 2>/dev/null | tr -d '[:space:]' || true
}

main() {
  local snap="" cur_version old_version backup="" f name db_rev head out
  case "${1:-}" in -h|--help) usage; exit 0 ;; esac
  [ "$#" -le 1 ] || { usage >&2; die "最多只能给一个参数(快照目录)"; }
  [ -f "$ENV_FILE" ] || die "当前目录没有 .env,看起来还没安装"
  [ -f "$DEPLOY_DIR/VERSION" ] || die "部署目录里缺少 VERSION 文件"
  require_cmd docker "请先安装 Docker Engine"
  require_compose_version
  require_same_user
  cd "$DEPLOY_DIR"
  acquire_lock

  if [ "$#" -eq 1 ]; then
    snap="$1"
  elif [ -f "$STATE_FILE" ]; then
    snap="$(read_env SNAPSHOT "$STATE_FILE")"
    backup="$(read_env BACKUP "$STATE_FILE")"
    [ -n "$snap" ] || die "状态文件 $STATE_FILE 里没有快照目录,请把快照目录作为参数给出。现有快照:$(list_snapshots | tr '\n' ' ')"
    log_info "按状态文件回退:上次升级 $(read_env OLD_VERSION "$STATE_FILE") → $(read_env NEW_VERSION "$STATE_FILE") 未完成"
  else
    usage >&2
    die "没有找到升级状态文件,请指定快照目录。现有快照:$(list_snapshots | tr '\n' ' ')"
  fi
  [ -d "$snap" ] || die "快照目录不存在:$snap"
  snap="$(cd "$snap" && pwd)"
  case "$snap" in "$DEPLOY_DIR"/backups/pre-upgrade-*) ;; *) die "快照目录必须是部署目录 backups/ 下的 pre-upgrade-* 目录:$snap" ;; esac
  [ -f "$snap/VERSION" ] && [ -f "$snap/docker-compose.yml" ] && [ -d "$snap/scripts" ] \
    || die "快照不完整(缺 VERSION、docker-compose.yml 或 scripts/),无法回退:$snap"
  old_version="$(tr -d '[:space:]' <"$snap/VERSION")"
  cur_version="$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")"
  str_grep "$old_version" -Eq '^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$' || die "快照里的版本号格式不对:$old_version"
  docker image inspect "workstation-app:$old_version" >/dev/null 2>&1 || die "本机没有旧版本镜像 workstation-app:$old_version,无法回退到 $old_version"
  if [ -z "$backup" ]; then backup="$(ls -1 "$DEPLOY_DIR"/backups/ws-backup-*-v"$old_version".tar.gz 2>/dev/null | sort | tail -n 1 || true)"; fi
  log_info "回退程序文件:$cur_version → $old_version(快照 $snap)"

  # 1. 复制回程序文件(快照里没有的文件保留原样;新版本多出的脚本对旧版无害)
  mkdir -p "$DEPLOY_DIR/scripts" "$DEPLOY_DIR/systemd"
  for f in VERSION BUILD_INFO docker-compose.yml Caddyfile Caddyfile.internal Caddyfile.custom Caddyfile.acme .env.example README.md; do
    if [ -f "$snap/$f" ]; then replace_file "$snap/$f" "$DEPLOY_DIR/$f"; fi
  done
  for f in "$snap"/scripts/*; do
    [ -f "$f" ] || continue
    replace_file "$f" "$DEPLOY_DIR/scripts/$(basename "$f")"
  done
  if [ -d "$snap/systemd" ]; then
    for f in "$snap"/systemd/*; do
      [ -f "$f" ] || continue
      name="$(basename "$f")"
      replace_file "$f" "$DEPLOY_DIR/systemd/$name"
    done
  fi
  # 2. WS_VERSION 改回旧版;3. 清状态文件与中断留下的解包目录
  set_env WS_VERSION "$old_version"
  rm -f "$STATE_FILE"
  find "$DEPLOY_DIR" -maxdepth 1 -name '.ws-upgrade.*' -type d -exec rm -rf {} + 2>/dev/null || true
  log_info "程序文件已还原到 $old_version,.env 的 WS_VERSION 已改回 $old_version"

  # 4. 数据库结构是否被新版本动过:先确保数据库在跑,再比对
  if [ -z "$(compose ps -q postgres 2>/dev/null | head -n 1)" ]; then
    if ! out="$(compose up -d --pull never postgres 2>&1)"; then printf '%s\n' "$out" | tail -n 8 | redact >&2; fi
  fi
  wait_healthy postgres 120 || die "数据库服务(postgres)没有就绪,无法判断数据库状态。请检查 docker compose logs postgres 后重试"
  db_rev="$(db_revision)"
  head="$(old_image_head)"
  [ -n "$db_rev" ] || die "读不到数据库的迁移版本(alembic_version)。程序文件已还原;请用升级前的备份恢复:./scripts/restore.sh ${backup:-<备份文件>}"
  [ -n "$head" ] || die "读不到旧版本镜像的迁移 head。程序文件已还原;请用升级前的备份恢复:./scripts/restore.sh ${backup:-<备份文件>}"
  if [ "$db_rev" != "$head" ]; then
    log_warn "数据库已被新版本迁移到 $db_rev(旧版本 $old_version 的结构是 $head),旧程序不能直接使用这个库;停止应用容器"
    compose stop app scheduler stream-worker 2>&1 | redact >/dev/null || true
    {
      printf '\n程序文件与 WS_VERSION 已回到 %s,但数据库需要用升级前的备份恢复。请执行:\n' "$old_version"
      printf '  ./scripts/restore.sh %s\n' "${backup:-backups/<升级前的备份>.tar.gz}"
      printf '恢复会丢失升级开始之后产生的数据;恢复完成后系统即回到 %s。\n' "$old_version"
    } >&2
    exit 3
  fi
  log_info "数据库结构未变(迁移版本 $db_rev),直接用 $old_version 的镜像重启服务……"
  start_and_verify "$HEALTH_TIMEOUT"
  log_info "回退完成:当前版本 $old_version。快照目录 $snap 可在确认无误后手动删除"
}

main "$@"
exit 0
