#!/usr/bin/env bash
# 备份:在部署目录里执行 ./scripts/backup.sh [--keep N]
#
# 产物:backups/ws-backup-<YYYYMMDD-HHMMSS>-v<版本>.tar.gz(权限 600),内含
#   db.dump(pg_dump -Fc)、env(.env 原样)、caddy.tar(Caddy 数据,经 web 容器打出)、manifest.json。
# 先写成隐藏的 .partial 临时文件,完整后再改名,不会把半个备份当成完整备份;失败时清理。
# 数据库只经 pg_dump / psql(在 postgres 容器内走本地 socket,不经命令行密码);Caddy 数据只经容器读取
# (data/caddy 里的私钥属容器内 root、权限 600,宿主机普通用户读不了)。
# 成功后原地覆盖写 data/logs/backup-last.json(该目录是 1777 粘滞目录,不能写临时文件再 mv)。
# 安全约定:不开 xtrace;不打印密钥;回显容器输出前先过 redact。
set +x
unset BASH_XTRACEFD
set -euo pipefail

# shellcheck source=scripts/lib.sh
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

main() {
  local keep="${WS_BACKUP_KEEP:-14}" ts version migration stage partial final errf n excess f i
  local -a files
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --keep) [ "$#" -ge 2 ] || die "--keep 需要一个数字"; keep="$2"; shift 2 ;;
      --keep=*) keep="${1#--keep=}"; shift ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "不认识的参数:$1" ;;
    esac
  done
  printf '%s' "$keep" | grep -Eq '^[1-9][0-9]*$' || die "--keep 必须是不小于 1 的整数"

  [ -f "$ENV_FILE" ] || die "当前目录没有 .env,看起来还没安装;请先运行 scripts/install.sh"
  [ -f "$DEPLOY_DIR/VERSION" ] || die "部署目录里缺少 VERSION 文件"
  require_cmd docker "请先安装 Docker Engine"
  cd "$DEPLOY_DIR"
  version="$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")"
  printf '%s' "$version" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+([.-][A-Za-z0-9.-]+)?$' || die "VERSION 里的版本号格式不对:$version"

  service_running postgres || die "数据库服务没有在运行。请先执行:docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' up -d postgres"
  service_running web || die "web 服务没有在运行,取不到 Caddy 数据。请先执行:docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' up -d web"

  mkdir -p "$DEPLOY_DIR/backups"
  chmod 700 "$DEPLOY_DIR/backups"
  acquire_lock
  clean_stale_tmp
  stage="$(mktemp -d "$DEPLOY_DIR/backups/.stage.XXXXXX")"
  register_tmp "$stage"
  errf="$stage/err.txt"

  # 当前迁移版本(manifest 里记录,恢复时用来拒绝比镜像新的备份)
  migration="$(pg_sh 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tA -c "SELECT version_num FROM alembic_version"' 2>"$errf" | tr -d '[:space:]')" || true
  printf '%s' "$migration" | grep -Eq '^[0-9A-Za-z_]+$' || { redact <"$errf" >&2; die "读取数据库迁移版本失败(库是否已初始化?)"; }

  log_info "导出数据库……"
  if ! pg_sh 'pg_dump -Fc -U "$POSTGRES_USER" "$POSTGRES_DB"' >"$stage/db.dump" 2>"$errf"; then
    redact <"$errf" >&2
    die "pg_dump 失败"
  fi
  [ -s "$stage/db.dump" ] || die "导出的数据库文件为空"

  log_info "打包 Caddy 数据(证书、私钥)……"
  if ! compose exec -T web tar -C /data -cf - . </dev/null >"$stage/caddy.tar" 2>"$errf"; then
    redact <"$errf" >&2
    die "取 Caddy 数据失败"
  fi
  [ -s "$stage/caddy.tar" ] || die "Caddy 数据为空"
  tar -tf "$stage/caddy.tar" >/dev/null 2>&1 || die "取到的 Caddy 数据不是有效的 tar 归档"

  cp "$ENV_FILE" "$stage/env"

  ts="$(date +%Y%m%d-%H%M%S)"
  final="$DEPLOY_DIR/backups/ws-backup-$ts-v$version.tar.gz"
  # 文件名精确到秒:同一秒内连续备份时等到下一秒,避免覆盖上一份
  while [ -e "$final" ]; do
    sleep 1
    ts="$(date +%Y%m%d-%H%M%S)"
    final="$DEPLOY_DIR/backups/ws-backup-$ts-v$version.tar.gz"
  done

  {
    printf '{\n'
    printf '  "version": "%s",\n' "$version"
    printf '  "migration": "%s",\n' "$migration"
    printf '  "created_at": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "files": {\n'
    printf '    "db.dump": "%s",\n' "$(sha256_of "$stage/db.dump")"
    printf '    "env": "%s",\n' "$(sha256_of "$stage/env")"
    printf '    "caddy.tar": "%s"\n' "$(sha256_of "$stage/caddy.tar")"
    printf '  }\n'
    printf '}\n'
  } >"$stage/manifest.json"

  partial="$DEPLOY_DIR/backups/.ws-backup.$$.partial"
  register_tmp "$partial"
  tar -czf "$partial" -C "$stage" db.dump env caddy.tar manifest.json || die "打包失败"
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
