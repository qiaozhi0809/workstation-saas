#!/usr/bin/env bash
# 备份:在部署目录里执行 ./scripts/backup.sh [--keep N]
#
# 产物:backups/ws-backup-<YYYYMMDD-HHMMSS>-v<版本>.tar.gz(权限 600),内含
#   db.dump(pg_dump -Fc,导出后用 pg_restore -l 核对能读)、env(.env 原样)、caddy.tar(Caddy 数据,经 web 容器打出;
#   web 没在运行时跳过,manifest 记 "caddy": "skipped")、config.tar(Caddyfile、docker-compose.yml、VERSION、certs/ —— 自备证书
#   的私钥在这里,L188)、manifest.json。
# 先写成隐藏的 .partial 临时文件,完整后再改名,不会把半个备份当成完整备份;失败时清理。
# 开头检查磁盘(L118):备份目录所在盘可用空间不少于上次备份大小的 2 倍、至少 1 GB(WS_INSTALL_MIN_DISK_GB 可改门槛)。
# 等数据库就绪最多 120 秒(L184):开机补跑的定时备份可能比容器先到。
# 数据库只经 pg_dump / psql(在 postgres 容器内走本地 socket,不经命令行密码);Caddy 数据只经容器读取
# (data/caddy 里的私钥属容器内 root、权限 600,宿主机普通用户读不了)。
# 成功后原地覆盖写 data/logs/backup-last.json(该目录是 1777 粘滞目录,不能写临时文件再 mv)。
# 安全约定:不开 xtrace;不打印密钥;回显容器输出前先过 redact。
set +x
unset BASH_XTRACEFD
set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

umask 077
export COPYFILE_DISABLE=1   # macOS 的 tar 不要附带 ._ 文件

cleanup() {
  local rc=$?
  trap - EXIT
  lib_cleanup
  if [ "$rc" -ne 0 ]; then
    printf '备份失败,没有留下不完整的备份文件。\n' >&2
  fi
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 在 postgres 容器里执行一段 sh(用户名与库名取容器环境里的实际值,不写死)
pg_sh() { compose exec -T postgres sh -c "$1" </dev/null; }

usage() { printf '用法:./scripts/backup.sh [--keep N]   (默认保留 WS_BACKUP_KEEP 或 14 份)\n'; }

# 磁盘预检(L118):门槛 = max(上次备份大小 × 2,WS_INSTALL_MIN_DISK_GB GB(默认 1))。不够就在导出之前停下
check_backup_disk() {
  local last last_bytes=0 min_gb need_kb avail_kb
  min_gb="${WS_INSTALL_MIN_DISK_GB:-1}"
  last="$(ls -1 "$DEPLOY_DIR"/backups/ws-backup-*.tar.gz 2>/dev/null | sort | tail -n 1 || true)"
  if [ -n "$last" ] && [ -f "$last" ]; then last_bytes="$(wc -c <"$last" | tr -d '[:space:]')"; fi
  need_kb=$((min_gb * 1024 * 1024))
  if [ $((last_bytes * 2 / 1024)) -gt "$need_kb" ]; then need_kb=$((last_bytes * 2 / 1024)); fi
  avail_kb="$(disk_avail_kb "$DEPLOY_DIR/backups")"
  if [ "$avail_kb" -lt "$need_kb" ]; then
    die "备份目录所在磁盘可用空间不足:需要约 $((need_kb / 1024)) MB(上次备份大小的 2 倍,至少 ${min_gb} GB),当前约 $((avail_kb / 1024)) MB。请清理旧备份(或调小 --keep)、把旧备份挪到别的设备后重试"
  fi
}

main() {
  local keep="${WS_BACKUP_KEEP:-14}" ts version migration stage partial final errf n excess f i caddy_state
  local -a files
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --keep) [ "$#" -ge 2 ] || die "--keep 需要一个数字"; keep="$2"; shift 2 ;;
      --keep=*) keep="${1#--keep=}"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "不认识的参数:$1" ;;
    esac
  done
  str_grep "$keep" -Eq '^[1-9][0-9]*$' || die "--keep 必须是不小于 1 的整数"

  [ -f "$ENV_FILE" ] || die "当前目录没有 .env,看起来还没安装;请先运行 scripts/install.sh"
  [ -f "$DEPLOY_DIR/VERSION" ] || die "部署目录里缺少 VERSION 文件"
  require_cmd docker "请先安装 Docker Engine"
  require_same_user
  cd "$DEPLOY_DIR"
  version="$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")"
  str_grep "$version" -Eq '^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$' || die "VERSION 里的版本号格式不对:$version"

  # 数据库容器在就等它就绪(L184:开机补跑的定时备份可能赶在容器就绪之前);容器不存在才算没在运行
  [ -n "$(compose ps -a -q postgres 2>/dev/null | head -n 1)" ] \
    || die "数据库服务没有在运行。请先执行:docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' up -d postgres"
  if ! service_running postgres; then log_info "数据库服务还没就绪,最多等 120 秒……"; fi
  wait_healthy postgres 120 || die "数据库服务在 120 秒内没有就绪。请运行 docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' logs postgres 查看原因"
  # web 没在运行时仍然备份(L118):只是取不到 Caddy 数据(证书、内部 CA 私钥),manifest 里记明,恢复时保留当前机器的 Caddy 数据
  if service_running web; then
    caddy_state="included"
  else
    caddy_state="skipped"
    log_warn "web 服务没有在运行,本次备份不含 Caddy 数据(证书、内部 CA 私钥);manifest 记为 caddy: skipped。如需完整备份请先启动 web 再备份"
  fi

  mkdir -p "$DEPLOY_DIR/backups"
  chmod 700 "$DEPLOY_DIR/backups"
  acquire_lock
  clean_stale_tmp
  check_backup_disk
  stage="$(mktemp -d "$DEPLOY_DIR/backups/.stage.XXXXXX")"
  register_tmp "$stage"
  errf="$stage/err.txt"

  # 当前迁移版本(manifest 里记录,恢复时用来拒绝比镜像新的备份)
  migration="$(pg_sh 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT version_num FROM alembic_version"' 2>"$errf" | tr -d '[:space:]')" || true
  str_grep "$migration" -Eq '^[0-9A-Za-z_]+$' || { redact <"$errf" >&2; die "读取数据库迁移版本失败(库是否已初始化?)"; }

  log_info "导出数据库……"
  if ! pg_sh 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' >"$stage/db.dump" 2>"$errf"; then
    redact <"$errf" >&2
    die "pg_dump 失败"
  fi
  [ -s "$stage/db.dump" ] || die "导出的数据库文件为空"
  # L188:导出的文件必须能被 pg_restore 读出目录,否则不算备份成功
  if ! compose exec -T postgres pg_restore -l <"$stage/db.dump" >/dev/null 2>"$errf"; then
    redact <"$errf" >&2
    die "导出的数据库文件无法被 pg_restore 读取(可能已截断),本次备份作废"
  fi

  if [ "$caddy_state" = "included" ]; then
    log_info "打包 Caddy 数据(证书、私钥)……"
    if ! compose exec -T web tar -C /data -cf - . </dev/null >"$stage/caddy.tar" 2>"$errf"; then
      redact <"$errf" >&2
      die "取 Caddy 数据失败"
    fi
    [ -s "$stage/caddy.tar" ] || die "Caddy 数据为空"
    tar -tf "$stage/caddy.tar" >/dev/null 2>&1 || die "取到的 Caddy 数据不是有效的 tar 归档"
  fi

  # L188:生效的 Caddyfile、compose、VERSION 与 certs/(自备证书的私钥在这里)打成 config.tar;
  # 恢复时不自动应用(版本可能不同),灾备换机时按手册第 8 节手动取用。只收普通文件,不跟链接。
  log_info "打包部署配置(Caddyfile、docker-compose.yml、VERSION、certs/)……"
  files=()
  for f in Caddyfile docker-compose.yml VERSION; do
    [ -f "$DEPLOY_DIR/$f" ] && files+=("$f")
  done
  while IFS= read -r f; do files+=("${f#./}"); done < <(cd "$DEPLOY_DIR" && find ./certs -type f 2>/dev/null | LC_ALL=C sort)
  [ "${#files[@]}" -gt 0 ] || die "部署目录里没有 docker-compose.yml / VERSION,无法备份配置"
  tar -C "$DEPLOY_DIR" -cf "$stage/config.tar" "${files[@]}" 2>"$errf" || { redact <"$errf" >&2; die "打包部署配置失败"; }

  cp "$ENV_FILE" "$stage/env"

  ts="$(date +%Y%m%d-%H%M%S)"
  final="$DEPLOY_DIR/backups/ws-backup-$ts-v$version.tar.gz"
  # 文件名精确到秒:同一秒内连续备份时等到下一秒,避免覆盖上一份
  while [ -e "$final" ]; do
    sleep 1
    ts="$(date +%Y%m%d-%H%M%S)"
    final="$DEPLOY_DIR/backups/ws-backup-$ts-v$version.tar.gz"
  done

  # manifest(格式由 lib.sh 的 manifest_valid 校验;1.0.0 起多了 caddy 字段与 config.tar,caddy 跳过时没有 caddy.tar 一行)
  {
    printf '{\n'
    printf '  "version": "%s",\n' "$version"
    printf '  "migration": "%s",\n' "$migration"
    printf '  "created_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "caddy": "%s",\n' "$caddy_state"
    printf '  "files": {\n'
    printf '    "db.dump": "%s",\n' "$(sha256_of "$stage/db.dump")"
    printf '    "env": "%s",\n' "$(sha256_of "$stage/env")"
    if [ "$caddy_state" = "included" ]; then
      printf '    "caddy.tar": "%s",\n' "$(sha256_of "$stage/caddy.tar")"
    fi
    printf '    "config.tar": "%s"\n' "$(sha256_of "$stage/config.tar")"
    printf '  }\n'
    printf '}\n'
  } >"$stage/manifest.json"
  manifest_valid "$stage/manifest.json" || die "生成的 manifest.json 没有通过自检(脚本缺陷),本次备份作废"

  partial="$DEPLOY_DIR/backups/.ws-backup.$$.partial"
  register_tmp "$partial"
  files=(db.dump env)
  if [ "$caddy_state" = "included" ]; then files+=(caddy.tar); fi
  files+=(config.tar manifest.json)
  tar -czf "$partial" -C "$stage" "${files[@]}" || die "打包失败"
  tar -tzf "$partial" >/dev/null || die "刚打好的备份包读不出来"
  chmod 600 "$partial"
  mv "$partial" "$final"

  # 只保留最新 N 份(glob 按文件名里的时间戳排序;逐个元素处理,目录名含空格也不会被拆开);跳过刚生成的 $final
  files=()
  for f in "$DEPLOY_DIR"/backups/ws-backup-*.tar.gz; do
    [ -f "$f" ] && files+=("$f")
  done
  n="${#files[@]}"
  if [ "$n" -gt "$keep" ]; then
    excess=$((n - keep))
    i=0
    while [ "$i" -lt "$excess" ]; do
      f="${files[$i]}"
      [ "$f" = "$final" ] || rm -f "$f"
      i=$((i + 1))
    done
    log_info "已删除 $excess 份最旧的备份(保留最新 $keep 份)"
  fi

  # 原地覆盖写(不写临时文件再 mv:data/logs 是 1777 粘滞目录)。写失败不算备份失败:备份文件已经好了。
  mkdir -p "$DEPLOY_DIR/data/logs" 2>/dev/null || true
  if ! ( umask 022
         printf '{"at": "%s", "file": "%s", "size_bytes": %s}\n' \
           "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$(basename "$final")" "$(wc -c <"$final" | tr -d '[:space:]')" \
           >"$DEPLOY_DIR/data/logs/backup-last.json" ) 2>/dev/null; then
    log_warn "备份已完成,备份文件已保留($final);只是写 data/logs/backup-last.json 失败(检查该文件的属主与权限),设置页里的\"上次备份\"可能不更新"
  fi

  log_info "备份完成"
  printf '  备份文件:%s\n' "$final"
  printf '  大小:%s 字节\n' "$(wc -c <"$final" | tr -d '[:space:]')"
  printf '  注意:备份里含主密钥,请放在学校自己的安全位置(NAS / 移动硬盘),不要上传到外网\n'
}

main "$@"
exit 0
