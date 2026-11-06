#!/usr/bin/env bash
# 升级:在部署目录里执行 ./scripts/upgrade.sh <离线包.tar.gz>
#
# 流程:校验离线包 → 强制备份 → 载入新镜像 → 用新镜像做迁移预检 → 覆盖程序文件 → 重启并等健康。
# 预检不通过时,在覆盖任何文件、动任何服务之前就停下(退出码 2),系统仍在旧版本上运行。
# 本脚本不依赖 compose 的重启策略做回滚;覆盖文件开始之后任何一步失败,统一打印手动回退办法
# (先把 .env 里的 WS_VERSION 改回旧版本,再用刚才的备份执行 restore.sh)。
#
# 安全约定:不开 xtrace;不打印密钥;回显容器输出前先过 redact;解包前拒绝绝对路径、..、链接与特殊文件。
# WS_INSTALL_SKIP_LOAD=1 跳过 docker load(仅测试用:镜像已在本机;正式升级不应设置)。
set +x
unset BASH_XTRACEFD
set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WORK=""
OVERWRITE_STARTED=0
OLD_VERSION=""
BACKUP_FILE=""
HEALTH_TIMEOUT="${WS_UPGRADE_HEALTH_TIMEOUT:-300}"

cleanup() {
  local rc=$?
  trap - EXIT
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
  lib_cleanup
  # 覆盖文件之后才失败:打印统一的恢复办法
  if [ "$rc" -ne 0 ] && [ "$OVERWRITE_STARTED" -eq 1 ]; then
    {
      printf '\n升级在覆盖程序文件之后失败了。回到旧版本 %s 的办法(按顺序):\n' "$OLD_VERSION"
      printf '  1) 先把 .env 里的 WS_VERSION 改回 %s\n' "$OLD_VERSION"
      printf '  2) 再执行 ./scripts/restore.sh %s\n' "$BACKUP_FILE"
    } >&2
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

version_ok() { str_grep "$1" -Eq '^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$'; }
major_of() { printf '%s' "${1%%.*}"; }

# version_lt <A> <B>:A 的 主.次.修订 数字小于 B 则返回 0(后缀如 -rc1 不参与比较)
version_lt() {
  local a1 a2 a3 b1 b2 b3
  IFS=.- read -r a1 a2 a3 _ <<<"$1"
  IFS=.- read -r b1 b2 b3 _ <<<"$2"
  [ "$((10#$a1))" -lt "$((10#$b1))" ] && return 0
  [ "$((10#$a1))" -gt "$((10#$b1))" ] && return 1
  [ "$((10#$a2))" -lt "$((10#$b2))" ] && return 0
  [ "$((10#$a2))" -gt "$((10#$b2))" ] && return 1
  [ "$((10#$a3))" -lt "$((10#$b3))" ]
}

# 解包前检查归档:先把清单读到变量里(tar 读失败要能发现,不能被管道吞掉),再逐项检查。
check_archive() {
  local pkg="$1" list vlist tops
  list="$(tar -tzf "$pkg")" || die "离线包无法读取(文件损坏或不是 tar.gz),已拒绝"
  [ -n "$list" ] || die "离线包是空的,已拒绝"
  # 清单可能很长:一律用 here-string 喂给 grep(不用 printf | grep -q:pipefail 下 grep 提前退出会让管道返回 141,检查被绕过)
  if grep -Eq '(^/|(^|/)\.\.(/|$))' <<<"$list"; then
    die "离线包里含有不安全的路径(绝对路径或 ..),已拒绝"
  fi
  vlist="$(tar -tvzf "$pkg")" || die "离线包无法读取(文件损坏或不是 tar.gz),已拒绝"
  # 只允许普通文件与目录;符号链接、硬链接、设备、管道等一律拒绝
  if grep -Evq '^[-d]' <<<"$vlist"; then
    die "离线包里含有链接或特殊文件(符号链接、硬链接、设备等),已拒绝"
  fi
  tops="$(printf '%s\n' "$list" | sed 's#^\./##' | awk -F/ 'NF > 0 && $1 != "" { print $1 }' | sort -u)"
  [ -n "$tops" ] && [ "$(wc -l <<<"$tops" | tr -d '[:space:]')" -eq 1 ] \
    || die "离线包的顶层必须只有一个目录,已拒绝"
}

# 校验和文件两种命名都接受:<包全名>.sha256(workstation-deploy-X.tar.gz.sha256)与去掉 .tar.gz 的
# <包名主干>.sha256(workstation-deploy-X.sha256);全名优先。只取第一行第一列(sha256sum 的输出格式)。
verify_checksum() {
  local pkg="$1" sumfile="" want got cand
  for cand in "$pkg.sha256" "${pkg%.tar.gz}.sha256"; do
    if [ -f "$cand" ]; then sumfile="$cand"; break; fi
  done
  if [ -z "$sumfile" ]; then
    log_warn "没有找到 $(basename "$pkg").sha256(或 $(basename "${pkg%.tar.gz}").sha256):未校验离线包的完整性与来源,请自行确认文件可信"
    return 0
  fi
  want="$(awk 'NR==1 {print $1}' "$sumfile")"
  got="$(sha256_of "$pkg")"
  [ -n "$want" ] && [ "$want" = "$got" ] || die "离线包校验和不符(对照文件 $(basename "$sumfile")),文件可能损坏或被改动,已拒绝"
  log_info "离线包校验和通过($(basename "$sumfile"))"
}

# 把新 .env.example 里有、当前 .env 里没有的键(用默认值)追加进 .env
append_new_env_keys() {
  local example="$1" key line added="" cur
  # L186:1.0.0 之前安装的 .env 没有 WS_SUBNET。补的是"现在在用的"子网(已存在的 compose 网络;没有网络时是旧 compose
  # 写死的 172.30.0.0/24),不是照搬 .env.example 的默认值——否则 WS_TRUSTED_PROXIES 与真实子网可能对不上
  if grep -q '^WS_SUBNET=' "$example" && ! grep -q '^WS_SUBNET=' "$ENV_FILE"; then
    cur="$(compose_network_subnet)"
    [ -n "$cur" ] || cur="172.30.0.0/24"
    set_env WS_SUBNET "$cur"
    added="$added WS_SUBNET(=$cur,取自当前 compose 网络)"
  fi
  while IFS= read -r line; do
    case "$line" in
      [A-Z]*=*)
        key="${line%%=*}"
        if ! grep -q "^$key=" "$ENV_FILE"; then
          set_env "$key" "${line#*=}"
          added="$added $key"
        fi
        ;;
    esac
  done <"$example"
  if [ -n "$added" ]; then
    log_warn "新版本新增了配置项,已按默认值追加到 .env:$added。请核对,必要时修改后重启服务"
  fi
}

list_backups() { ls -1 "$DEPLOY_DIR"/backups/ws-backup-*.tar.gz 2>/dev/null | sort || true; }

main() {
  [ "$#" -eq 1 ] || die "用法:./scripts/upgrade.sh <离线包.tar.gz>"
  local pkg new_version newdir out rc entries before after
  [ -f "$1" ] || die "找不到离线包:$1"
  # 包路径先转成绝对路径,后面 cd 到部署目录后仍然有效
  pkg="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
  [ -f "$ENV_FILE" ] || die "当前目录没有 .env,看起来还没安装;请先运行 scripts/install.sh"
  [ -f "$DEPLOY_DIR/VERSION" ] || die "部署目录里缺少 VERSION 文件"
  require_cmd docker "请先安装 Docker Engine"
  require_compose_version
  cd "$DEPLOY_DIR"
  # 与备份 / 恢复互斥;升级里会调用 backup.sh,经环境变量告诉它"锁已由本进程持有"
  acquire_lock
  export WS_LOCK_OWNER_PID="$$"

  # 1. 校验、解包、版本检查(解包目录放在部署目录下的隐藏临时目录,与磁盘门槛检查对应同一块盘)
  verify_checksum "$pkg"
  check_archive "$pkg"
  check_disk
  WORK="$(mktemp -d "$DEPLOY_DIR/.ws-upgrade.XXXXXX")"
  tar -xzf "$pkg" -C "$WORK" --no-same-owner || die "解包失败"
  if [ -n "$(find "$WORK" -type l -o -type b -o -type c -o -type p 2>/dev/null | head -n 1)" ]; then
    die "离线包解开后含有链接或特殊文件,已拒绝"
  fi
  entries="$(find "$WORK" -mindepth 1 -maxdepth 1 | wc -l | tr -d '[:space:]')"
  newdir="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  { [ "$entries" -eq 1 ] && [ -n "$newdir" ]; } || die "离线包的顶层必须只有一个目录,已拒绝"
  { [ -f "$newdir/VERSION" ] && [ -f "$newdir/docker-compose.yml" ] && [ -d "$newdir/scripts" ]; } \
    || die "离线包内容不完整(缺少 VERSION、docker-compose.yml 或 scripts/)"
  new_version="$(tr -d '[:space:]' <"$newdir/VERSION")"
  OLD_VERSION="$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")"
  version_ok "$new_version" || die "离线包里的版本号格式不对:$new_version"
  version_ok "$OLD_VERSION" || die "当前版本号格式不对:$OLD_VERSION"
  if [ "$(major_of "$new_version")" != "$(major_of "$OLD_VERSION")" ]; then
    die "当前版本 $OLD_VERSION,离线包版本 $new_version:大版本升级需要专门的迁移说明,本脚本拒绝执行"
  fi
  if version_lt "$new_version" "$OLD_VERSION"; then
    die "离线包版本 $new_version 低于当前版本 $OLD_VERSION:不支持降级(数据库可能已迁移到更新的结构)。回退请用备份与 restore.sh"
  fi
  log_info "升级 $OLD_VERSION → $new_version"

  # 2. 强制备份,失败就停;备份前后各列一次清单,必须出现新文件
  [ -x "$DEPLOY_DIR/scripts/backup.sh" ] || die "找不到 scripts/backup.sh,无法做升级前的强制备份,已停止"
  log_info "升级前强制备份……"
  before="$(list_backups)"
  "$DEPLOY_DIR/scripts/backup.sh" || die "备份失败,已停止升级(未改动任何文件)"
  after="$(list_backups)"
  BACKUP_FILE="$(comm -13 <(printf '%s\n' "$before") <(printf '%s\n' "$after") | tail -n 1)"
  [ -n "$BACKUP_FILE" ] && [ -s "$BACKUP_FILE" ] || die "备份脚本没有产出新的备份文件,已停止升级"
  log_info "备份完成:$BACKUP_FILE"

  # 3. 载入新镜像(旧版本镜像标签不删,便于回退)
  if [ "${WS_INSTALL_SKIP_LOAD:-0}" = "1" ]; then
    log_warn "WS_INSTALL_SKIP_LOAD=1:跳过 docker load(仅用于测试)"
  else
    [ -f "$newdir/images/workstation-images-$new_version.tar" ] \
      || die "离线包里找不到 images/workstation-images-$new_version.tar"
    log_info "载入新镜像(可能需要几分钟)……"
    docker load -i "$newdir/images/workstation-images-$new_version.tar" >/dev/null || die "docker load 失败"
  fi
  docker image inspect "workstation-app:$new_version" >/dev/null 2>&1 || die "缺少镜像 workstation-app:$new_version"
  docker image inspect "workstation-web:$new_version" >/dev/null 2>&1 || die "缺少镜像 workstation-web:$new_version"
  docker image inspect "workstation-stream:$new_version" >/dev/null 2>&1 || die "缺少镜像 workstation-stream:$new_version"

  # 4. 用新镜像对现有库做迁移预检;此时还没覆盖任何文件、没动任何服务
  # WS_VERSION 由 shell 环境传入(优先于 .env),只影响本次 run 用哪个镜像
  log_info "用新镜像做迁移预检……"
  rc=0
  out="$(WS_VERSION="$new_version" compose run --rm -T --no-deps app cli migrate --check-only 2>&1)" || rc=$?
  if [ "$rc" -eq 2 ]; then
    printf '%s\n' "$out" | redact
    printf '\n已停止,系统仍在旧版本 %s 上运行,没有覆盖任何文件。请按上面的报告处理数据后重试。\n' "$OLD_VERSION"
    exit 2
  elif [ "$rc" -ne 0 ]; then
    printf '%s\n' "$out" | tail -n 15 | redact >&2
    die "迁移预检执行失败(退出码 $rc)。系统仍在旧版本 $OLD_VERSION 上运行,没有覆盖任何文件"
  fi
  log_info "迁移预检通过"

  # 5. 覆盖程序文件(不动 .env、Caddyfile、certs/、data/、backups/)
  # 从这里开始失败会由 EXIT trap 统一打印恢复办法。
  # 用 replace_file(写临时文件再改名):正在运行的本脚本读的是旧文件,不会被改坏
  OVERWRITE_STARTED=1
  log_info "更新程序文件……"
  local f name
  mkdir -p "$DEPLOY_DIR/scripts" "$DEPLOY_DIR/systemd"
  for f in docker-compose.yml Caddyfile.internal Caddyfile.custom Caddyfile.acme README.md .env.example VERSION; do
    if [ -f "$newdir/$f" ]; then replace_file "$newdir/$f" "$DEPLOY_DIR/$f"; fi
  done
  for f in "$newdir"/scripts/*; do
    [ -f "$f" ] || continue
    replace_file "$f" "$DEPLOY_DIR/scripts/$(basename "$f")"
  done
  if [ -d "$newdir/systemd" ]; then
    for f in "$newdir"/systemd/*; do
      [ -f "$f" ] || continue
      name="$(basename "$f")"
      replace_file "$f" "$DEPLOY_DIR/systemd/$name"
    done
  fi
  append_new_env_keys "$newdir/.env.example"
  set_env WS_VERSION "$new_version"

  # 6. 重启并等健康
  # 失败时 start_and_verify 会 die(退出码 1),EXIT trap 随后打印回退办法(OVERWRITE_STARTED 仍为 1)
  log_info "重启服务……"
  start_and_verify "$HEALTH_TIMEOUT"
  OVERWRITE_STARTED=0
  log_info "升级完成:当前版本 $new_version。升级前备份:$BACKUP_FILE"
}

main "$@"
exit 0
