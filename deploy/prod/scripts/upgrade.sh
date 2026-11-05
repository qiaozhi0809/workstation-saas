#!/usr/bin/env bash
# 升级:在部署目录里执行 ./scripts/upgrade.sh <离线包.tar.gz>
#
# 流程:校验离线包 → 强制备份 → 载入新镜像 → 用新镜像做迁移预检 → 覆盖程序文件 → 重启并等健康。
# 预检不通过时,在覆盖任何文件、动任何服务之前就停下(退出码 2),系统仍在旧版本上运行。
# 本脚本不依赖 compose 的重启策略做回滚;启动失败时只给出手动回退办法(用刚才的备份恢复)。
#
# WS_INSTALL_SKIP_LOAD=1 跳过 docker load(仅测试用:镜像已在本机;正式升级不应设置)。
set -euo pipefail

# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

WORK=""
cleanup() {
  if [ -n "$WORK" ] && [ -d "$WORK" ]; then rm -rf "$WORK"; fi
}
trap cleanup EXIT

version_ok() { printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$'; }
major_of() { printf '%s' "${1%%.*}"; }

# 解包前先检查归档里没有绝对路径或 .. 路径
check_archive_paths() {
  if tar -tzf "$1" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
    die "离线包里含有不安全的路径(绝对路径或 ..),已拒绝"
  fi
}

verify_checksum() {
  local pkg="$1" sumfile="$1.sha256" want got
  if [ ! -f "$sumfile" ]; then
    log_warn "没有找到 $(basename "$sumfile"),跳过离线包校验和检查"
    return 0
  fi
  want="$(awk 'NR==1 {print $1}' "$sumfile")"
  got="$(sha256_of "$pkg")"
  [ -n "$want" ] && [ "$want" = "$got" ] || die "离线包校验和不符,文件可能损坏或被改动,已拒绝"
  log_info "离线包校验和通过"
}

latest_backup() { ls -1t "$DEPLOY_DIR"/backups/ws-backup-*.tar.gz 2>/dev/null | head -n 1 || true; }

# 把新 .env.example 里有、当前 .env 里没有的键(用默认值)追加进 .env
append_new_env_keys() {
  local example="$1" key line added=""
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

main() {
  [ "$#" -eq 1 ] || die "用法:./scripts/upgrade.sh <离线包.tar.gz>"
  local pkg="$1" old_version new_version newdir backup_file out rc
  [ -f "$pkg" ] || die "找不到离线包:$pkg"
  [ -f "$ENV_FILE" ] || die "当前目录没有 .env,看起来还没安装;请先运行 scripts/install.sh"
  [ -f "$DEPLOY_DIR/VERSION" ] || die "部署目录里缺少 VERSION 文件"
  require_cmd docker "请先安装 Docker Engine"
  cd "$DEPLOY_DIR"

  # 1. 解包、校验、版本检查
  verify_checksum "$pkg"
  check_archive_paths "$pkg"
  WORK="$(mktemp -d "${TMPDIR:-/tmp}/ws-upgrade.XXXXXX")"
  tar -xzf "$pkg" -C "$WORK"
  newdir="$(find "$WORK" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
  [ -n "$newdir" ] && [ -f "$newdir/VERSION" ] && [ -f "$newdir/docker-compose.yml" ] \
    && [ -d "$newdir/scripts" ] || die "离线包内容不完整(缺少 VERSION、docker-compose.yml 或 scripts/)"
  new_version="$(tr -d '[:space:]' <"$newdir/VERSION")"
  old_version="$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")"
  version_ok "$new_version" || die "离线包里的版本号格式不对:$new_version"
  version_ok "$old_version" || die "当前版本号格式不对:$old_version"
  if [ "$(major_of "$new_version")" != "$(major_of "$old_version")" ]; then
    die "当前版本 $old_version,离线包版本 $new_version:大版本升级需要专门的迁移说明,本脚本拒绝执行"
  fi
  log_info "升级 $old_version → $new_version"

  # 2. 强制备份,失败就停
  [ -x "$DEPLOY_DIR/scripts/backup.sh" ] || die "找不到 scripts/backup.sh,无法做升级前的强制备份,已停止"
  log_info "升级前强制备份……"
  "$DEPLOY_DIR/scripts/backup.sh" || die "备份失败,已停止升级(未改动任何文件)"
  backup_file="$(latest_backup)"
  [ -n "$backup_file" ] || die "备份脚本没有产出备份文件,已停止升级"
  log_info "备份完成:$backup_file"

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

  # 4. 用新镜像对现有库做迁移预检;此时还没覆盖任何文件、没动任何服务
  # WS_VERSION 由 shell 环境传入(优先于 .env),只影响本次 run 用哪个镜像
  log_info "用新镜像做迁移预检……"
  rc=0
  out="$(WS_VERSION="$new_version" compose run --rm -T --no-deps app cli migrate --check-only 2>&1)" || rc=$?
  if [ "$rc" -eq 2 ]; then
    printf '%s\n' "$out"
    printf '\n已停止,系统仍在旧版本 %s 上运行,没有覆盖任何文件。请按上面的报告处理数据后重试。\n' "$old_version"
    exit 2
  elif [ "$rc" -ne 0 ]; then
    printf '%s\n' "$out" | tail -n 15 >&2
    die "迁移预检执行失败(退出码 $rc)。系统仍在旧版本 $old_version 上运行,没有覆盖任何文件"
  fi
  log_info "迁移预检通过"

  # 5. 覆盖程序文件(不动 .env、Caddyfile、certs/、data/、backups/)
  # 用 replace_file(写临时文件再改名):正在运行的本脚本读的是旧文件,不会被改坏
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
  log_info "重启服务……"
  if ! out="$(compose up -d 2>&1)"; then
    log_warn "docker compose up 返回非 0,最后几行输出:"
    printf '%s\n' "$out" | tail -n 8 >&2
  fi
  if ! wait_healthy app 300; then
    printf '\n升级后应用没有在 300 秒内就绪。回到旧版本 %s 的办法:\n' "$old_version" >&2
    printf '  1) ./scripts/restore.sh %s\n' "$backup_file" >&2
    printf '  2) 把 .env 里的 WS_VERSION 改回 %s 后执行 docker compose up -d\n' "$old_version" >&2
    exit 1
  fi
  log_info "升级完成:当前版本 $new_version。升级前备份:$backup_file"
}

main "$@"
exit 0
