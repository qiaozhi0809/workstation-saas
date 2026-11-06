#!/usr/bin/env bash
# 一键安装:在部署目录里执行 ./scripts/install.sh [--non-interactive] [--force]
#
# 安全约定(重点):
#   * .env 一经存在就视为"已安装",绝不重新生成密钥(重新生成会让已加密的 AI Key 等全部失效)。
#   * 管理员密码只经标准输入传给容器里的 init-school;不放命令行参数、不写 .env、不打印、不进日志。
#   * 本脚本不开 xtrace(逐行回显),不打印任何密钥值;错误信息不含密钥;回显容器输出前先过 redact。
#   * .env 先写成 .env.tmp、填完全部密钥后一次 mv 成 .env:有 .env 就一定是完整的。
#
# 非交互模式的环境变量:
#   WS_INSTALL_SCHOOL_NAME(必填) WS_INSTALL_ADMIN_LOGIN(默认 admin) WS_INSTALL_SITE(必填)
#   WS_INSTALL_ADMIN_PASSWORD 或 WS_INSTALL_ADMIN_PASSWORD_FILE(取文件第一行;更稳妥,环境变量会留在调用者环境里;
#     密码文件权限请设 600,装完后删除。WS_INSTALL_ADMIN_PASSWORD 在读完参数后立刻读入变量并从环境 unset)
#   WS_INSTALL_TLS(1/internal 内部证书,2/custom 自备证书,3/acme 自动申请;默认 1)
#   WS_INSTALL_CERT、WS_INSTALL_KEY(自备证书的文件路径) WS_INSTALL_ACME_EMAIL(acme 用)
#   WS_HTTP_PORT、WS_HTTPS_PORT(默认 80 / 443)
# 其他开关:
#   WS_INSTALL_MIN_DISK_GB 磁盘可用空间门槛(默认 20,只在测试里下调)
#   WS_INSTALL_HEALTH_TIMEOUT 等应用就绪的秒数(默认 180,只在测试里下调)
#   WS_INSTALL_SKIP_LOAD=1 跳过 docker load(仅测试用:镜像已在本机;正式离线包不会设置)
#
# data/logs 的权限做法(R10):建成当前用户所有的目录并 chmod 1777(粘滞位)。
#   理由:容器里的应用以 uid 10001 写 app.jsonl,宿主机上执行 backup.sh 的用户(普通用户 / root)写
#   backup-last.json,两者 uid 不同;不依赖 setfacl / chown(各文件系统与 NFS 上不一定可用),
#   也不需要 root。粘滞位保证各用户只能删除、改名自己的文件。已有文件由各自属主维护。
set +x
unset BASH_XTRACEFD
set -euo pipefail

# shellcheck source-path=SCRIPTDIR
# shellcheck source=lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

# 交互输入固定从 fd 3 读:把原标准输入挪到 fd 3,fd 0 改成 /dev/null。
# 否则 docker / docker compose 子进程会继承并吃掉 stdin,管道喂入的交互输入就丢了
# (需要 stdin 的地方,如 init-school 的密码,由 printf 管道显式提供)
exec 3<&0 0</dev/null

trap 'lib_cleanup' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

NON_INTERACTIVE=0
FORCE=0
SCHOOL_NAME=""
ADMIN_LOGIN=""
ADMIN_PW=""
INSTALL_PW_ENV=""   # 启动时从环境变量 WS_INSTALL_ADMIN_PASSWORD 读入的管理员密码(读完立刻 unset,不让后面起的任何子进程继承)
SITE=""
TLS_MODE=""
ACME_EMAIL=""
CERT_SRC=""
KEY_SRC=""

usage() {
  cat <<'USAGE'
用法:./scripts/install.sh [--non-interactive] [--force]
  --non-interactive  不提问,参数从 WS_INSTALL_* 环境变量读取
  --force            不是 Ubuntu 22.04 / 24.04 时仍继续
USAGE
}

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --non-interactive) NON_INTERACTIVE=1 ;;
      --force) FORCE=1 ;;
      -h|--help) usage; exit 0 ;;
      *) usage >&2; die "未知参数:$1" ;;
    esac
    shift
  done
}

port_in_use() { (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1; }

check_os() {
  local id="" ver=""
  if [ -r /etc/os-release ]; then
    id="$(. /etc/os-release && printf '%s' "${ID:-}")"
    ver="$(. /etc/os-release && printf '%s' "${VERSION_ID:-}")"
  fi
  case "$id:$ver" in
    ubuntu:22.04|ubuntu:24.04) return 0 ;;
  esac
  if [ "$FORCE" -eq 1 ]; then
    log_warn "当前系统不是 Ubuntu 22.04 / 24.04(检测到:${id:-未知} ${ver:-}),已按 --force 继续"
  else
    die "仅支持 Ubuntu 22.04 / 24.04(检测到:${id:-未知} ${ver:-})。确需继续请加 --force"
  fi
}

check_docker() {
  require_cmd docker "请先安装 Docker Engine"
  docker compose version >/dev/null 2>&1 || die "缺少 docker compose 插件,请安装 docker-compose-plugin"
  require_compose_version
  if ! docker info >/dev/null 2>&1; then
    die "当前用户无法使用 docker。请把用户加入 docker 组(sudo usermod -aG docker \$USER,重新登录后生效),或用 sudo 运行"
  fi
  require_cmd openssl "请先安装 openssl"
}

check_ports() {
  local http="$1" https="$2" p
  for p in "$http" "$https"; do
    if port_in_use "$p"; then
      die "端口 $p 已被占用。请先停掉占用它的程序,或设置 WS_HTTP_PORT / WS_HTTPS_PORT 换端口后重试"
    fi
  done
}

check_port_number() {
  case "$2" in
    ''|*[!0-9]*) die "$1 必须是数字端口:$2" ;;
  esac
  if [ "$2" -lt 1 ] || [ "$2" -gt 65535 ]; then die "$1 超出范围:$2"; fi
}

# ask <变量名> <提示> [默认值]
ask() {
  local __var="$1" prompt="$2" def="${3:-}" reply=""
  if [ -n "$def" ]; then prompt="$prompt [$def]"; fi
  printf '%s:' "$prompt" >&2
  read -r reply <&3 || true
  if [ -z "$reply" ]; then reply="$def"; fi
  printf -v "$__var" '%s' "$reply"
}

read_password_interactive() {
  local p1 p2
  while :; do
    printf '管理员密码(至少 8 位,含字母与数字或符号,输入不显示):' >&2
    read -rs p1 <&3 || { printf '\n' >&2; die "读取管理员密码时输入已结束(没有更多输入)。请在终端里交互运行,或改用 --non-interactive"; }
    printf '\n' >&2
    printf '请再输入一次:' >&2
    read -rs p2 <&3 || { printf '\n' >&2; die "读取管理员密码时输入已结束(没有更多输入)"; }
    printf '\n' >&2
    if [ -z "$p1" ]; then log_warn "密码不能为空"; continue; fi
    if [ "$p1" != "$p2" ]; then log_warn "两次输入不一致,请重试"; continue; fi
    ADMIN_PW="$p1"
    return 0
  done
}

normalize_tls() {
  case "$1" in
    1|internal) TLS_MODE="internal" ;;
    2|custom) TLS_MODE="custom" ;;
    3|acme) TLS_MODE="acme" ;;
    *) die "证书方式只能是 1(内部证书)、2(自备证书)、3(公网域名自动申请),收到:$1" ;;
  esac
}

# 收集学校名、管理员登录名与密码(首次安装,或已装但学校尚未初始化时)
collect_school_inputs() {
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    SCHOOL_NAME="${WS_INSTALL_SCHOOL_NAME:-}"
    ADMIN_LOGIN="${WS_INSTALL_ADMIN_LOGIN:-admin}"
    [ -n "$SCHOOL_NAME" ] || die "非交互模式需要环境变量 WS_INSTALL_SCHOOL_NAME"
    if [ -n "${WS_INSTALL_ADMIN_PASSWORD_FILE:-}" ]; then
      [ -r "$WS_INSTALL_ADMIN_PASSWORD_FILE" ] || die "读不到密码文件:$WS_INSTALL_ADMIN_PASSWORD_FILE"
      IFS= read -r ADMIN_PW <"$WS_INSTALL_ADMIN_PASSWORD_FILE" || true
    else
      ADMIN_PW="$INSTALL_PW_ENV"
    fi
    INSTALL_PW_ENV=""
    [ -n "$ADMIN_PW" ] || die "非交互模式需要 WS_INSTALL_ADMIN_PASSWORD 或 WS_INSTALL_ADMIN_PASSWORD_FILE"
  else
    ask SCHOOL_NAME "学校名称(1-50 字)"
    ask ADMIN_LOGIN "管理员登录名" "admin"
    read_password_interactive
  fi
  validate_school_inputs
}

# 字符数(按 UTF-8 字符,不是字节)。校名等只经命令行传给容器,密码只在这里检查长度,不会进 ps
utf8_chars() { printf '%s' "$1" | LC_ALL=C.UTF-8 wc -m | tr -d '[:space:]'; }

# 前置校验:全部在生成 .env 之前做,规则与容器里 init-school 一致,这样不会"装到一半才发现输错了"
validate_school_inputs() {
  local n bytes kinds=0
  n="$(utf8_chars "$SCHOOL_NAME")"
  { [ "$n" -ge 1 ] && [ "$n" -le 50 ]; } || die "学校名称需为 1-50 个字"
  case "$SCHOOL_NAME" in
    [[:space:]]*|*[[:space:]]) die "学校名称首尾不能有空白" ;;
  esac
  str_grep "$ADMIN_LOGIN" -Eq '^[A-Za-z0-9_.-]{3,32}$' \
    || die "管理员登录名需为 3-32 位字母、数字或 . _ -"
  n="$(utf8_chars "$ADMIN_PW")"
  [ "$n" -ge 8 ] || die "管理员密码至少 8 位"
  bytes="$(printf '%s' "$ADMIN_PW" | wc -c | tr -d '[:space:]')"
  [ "$bytes" -le 72 ] || die "管理员密码不能超过 72 个字节"
  if LC_ALL=C.UTF-8 str_grep "$ADMIN_PW" -q '[[:alpha:]]'; then kinds=$((kinds + 1)); fi
  if LC_ALL=C.UTF-8 str_grep "$ADMIN_PW" -q '[[:digit:]]'; then kinds=$((kinds + 1)); fi
  if LC_ALL=C.UTF-8 str_grep "$ADMIN_PW" -q '[^[:alnum:]]'; then kinds=$((kinds + 1)); fi
  [ "$kinds" -ge 2 ] || die "管理员密码需包含字母、数字、其他字符中的至少两类"
}

# 首次安装才需要的站点与证书参数
collect_site_inputs() {
  local tls_in="1"
  if [ "$NON_INTERACTIVE" -eq 1 ]; then
    SITE="${WS_INSTALL_SITE:-}"
    [ -n "$SITE" ] || die "非交互模式需要环境变量 WS_INSTALL_SITE(域名或 IP)"
    tls_in="${WS_INSTALL_TLS:-1}"
    CERT_SRC="${WS_INSTALL_CERT:-}"
    KEY_SRC="${WS_INSTALL_KEY:-}"
    ACME_EMAIL="${WS_INSTALL_ACME_EMAIL:-}"
    normalize_tls "$tls_in"
  else
    ask SITE "访问地址(域名或 IP,如 192.168.1.10)"
    printf '证书方式:\n  1) 内部证书(离线可用,各终端需信任根证书)\n  2) 学校自备证书\n  3) 公网域名自动申请(需联网)\n' >&2
    ask tls_in "请选择 1/2/3" "1"
    normalize_tls "$tls_in"
    if [ "$TLS_MODE" = "custom" ]; then
      ask CERT_SRC "证书文件路径(PEM)"
      ask KEY_SRC "私钥文件路径(PEM)"
    elif [ "$TLS_MODE" = "acme" ]; then
      ask ACME_EMAIL "申请证书用的联系邮箱"
    fi
  fi
  # 地址只允许域名 / IPv4 字符,避免带进 .env 与 Caddyfile 后被当成别的配置
  str_grep "$SITE" -Eq '^[A-Za-z0-9._-]+$' || die "访问地址只能含字母、数字、点、短横线与下划线:$SITE"
  case "$TLS_MODE" in
    custom)
      [ -r "$CERT_SRC" ] || die "自备证书模式需要可读的证书文件(WS_INSTALL_CERT):${CERT_SRC:-未提供}"
      [ -r "$KEY_SRC" ] || die "自备证书模式需要可读的私钥文件(WS_INSTALL_KEY):${KEY_SRC:-未提供}"
      openssl x509 -noout -in "$CERT_SRC" >/dev/null 2>&1 || die "证书文件不是有效的 PEM 证书:$CERT_SRC"
      ;;
    acme)
      str_grep "$ACME_EMAIL" -Eq '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+$' \
        || die "公网自动申请需要有效的联系邮箱(WS_INSTALL_ACME_EMAIL)"
      ;;
  esac
}

load_images() {
  local version tar
  version="$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")"
  if [ "${WS_INSTALL_SKIP_LOAD:-0}" = "1" ]; then
    log_warn "WS_INSTALL_SKIP_LOAD=1:跳过 docker load(仅用于测试,正式安装不应设置)"
  else
    tar="$DEPLOY_DIR/images/workstation-images-$version.tar"
    [ -f "$tar" ] || die "找不到镜像包 images/workstation-images-$version.tar"
    log_info "载入镜像(可能需要几分钟)……"
    docker load -i "$tar" >/dev/null || die "docker load 失败"
  fi
  local img
  for img in "workstation-app:$version" "workstation-web:$version" "workstation-stream:$version" postgres:16-alpine redis:7-alpine; do
    docker image inspect "$img" >/dev/null 2>&1 || die "缺少镜像 $img"
  done
}

new_uuid() {
  if [ -r /proc/sys/kernel/random/uuid ]; then
    cat /proc/sys/kernel/random/uuid
  elif command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
  else
    die "无法生成学校 ID:缺少 /proc/sys/kernel/random/uuid 与 uuidgen"
  fi
}

# 建 .env(权限 600)并填入随机密钥;只在首次安装时调用。
# 原子:先在 umask 077 下写 .env.tmp,填完全部键后才 mv 成 .env;中途失败不会留下残缺的 .env,
# 否则重跑会被当成"已安装"而不再补密钥。
generate_env() {
  local pg tmp="$ENV_FILE.tmp"
  rm -f "$tmp"
  register_tmp "$tmp"
  (umask 077; cp "$DEPLOY_DIR/.env.example" "$tmp")
  chmod 600 "$tmp"
  pg="$(rand_secret 24 urlsafe)"
  set_env WS_VERSION "$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION")" "$tmp"
  set_env WS_SCHOOL_ID "$(new_uuid)" "$tmp"
  set_env POSTGRES_PASSWORD "$pg" "$tmp"
  set_env WS_DATABASE_URL "postgresql+psycopg://workstation:${pg}@postgres:5432/workstation" "$tmp"
  set_env WS_JWT_SECRET "$(rand_secret 48)" "$tmp"
  set_env WS_MASTER_KEY "$(rand_secret 32)" "$tmp"
  set_env WS_SITE_ADDRESS "$SITE" "$tmp"
  set_env WS_TLS_MODE "$TLS_MODE" "$tmp"
  set_env WS_ACME_EMAIL "$ACME_EMAIL" "$tmp"
  set_env WS_HTTP_PORT "$HTTP_PORT" "$tmp"
  set_env WS_HTTPS_PORT "$HTTPS_PORT" "$tmp"
  pg=""
  mv "$tmp" "$ENV_FILE"
}

# "已安装"分支:.env 必须是完整的。缺密钥说明 .env 被损坏或被截断;
# 绝不在这里重新生成(会让已加密的数据永远解不开),让管理员从备份恢复。
check_env_complete() {
  local k
  for k in WS_JWT_SECRET WS_MASTER_KEY POSTGRES_PASSWORD; do
    [ -n "$(read_env "$k")" ] \
      || die ".env 里的 $k 为空,.env 可能被损坏。不会重新生成密钥(会让已加密的数据永远无法解开);请从最近一次备份恢复 .env(备份包里的 env 文件)"
  done
  case "$(read_env WS_DATABASE_URL)" in
    *workstation:@*|"") die ".env 里的 WS_DATABASE_URL 缺少数据库密码,.env 可能被损坏;请从最近一次备份恢复 .env" ;;
  esac
}

prepare_dirs() {
  mkdir -p "$DEPLOY_DIR/data/pg" "$DEPLOY_DIR/data/redis" "$DEPLOY_DIR/data/caddy" \
    "$DEPLOY_DIR/data/logs" "$DEPLOY_DIR/backups" "$DEPLOY_DIR/certs"
  # R10:见文件头说明,1777(粘滞位)让容器 uid 10001 与宿主机用户都能在里面写文件
  chmod 1777 "$DEPLOY_DIR/data/logs"
}

# 先于 generate_env 调用:这样"有 .env"就意味着 Caddyfile 与证书已就位,
# 中途失败后重跑不会落到"已安装但缺 Caddyfile"的半成品状态
place_caddyfile_and_certs() {
  mkdir -p "$DEPLOY_DIR/certs"
  case "$TLS_MODE" in
    internal) cp "$DEPLOY_DIR/Caddyfile.internal" "$DEPLOY_DIR/Caddyfile" ;;
    custom)
      cp "$DEPLOY_DIR/Caddyfile.custom" "$DEPLOY_DIR/Caddyfile"
      (umask 077; cp "$CERT_SRC" "$DEPLOY_DIR/certs/site.crt"; cp "$KEY_SRC" "$DEPLOY_DIR/certs/site.key")
      chmod 644 "$DEPLOY_DIR/certs/site.crt"
      chmod 600 "$DEPLOY_DIR/certs/site.key"
      ;;
    acme) cp "$DEPLOY_DIR/Caddyfile.acme" "$DEPLOY_DIR/Caddyfile" ;;
  esac
}

start_services() {
  log_info "启动服务……"
  # 全部服务都要起来才算完成:app 健康、scheduler 在运行、web 健康(见 lib.sh 的 start_and_verify;--pull never 不联网拉取)
  start_and_verify "${WS_INSTALL_HEALTH_TIMEOUT:-180}"
  log_info "应用、定时任务与 web 服务均已就绪"
}

# 输出 schools 行数;查询失败时输出空(调用者必须检查,不可当成 0)
school_count() {
  compose exec -T postgres psql -U workstation -d workstation -tA -c "SELECT count(*) FROM schools" 2>/dev/null | tr -d '[:space:]' || true
}

init_school() {
  local out rc=0 shown
  log_info "初始化学校与管理员……"
  # 密码只经标准输入(printf 是 shell 内建,不进 ps)传给容器
  out="$(printf '%s\n' "$ADMIN_PW" | compose run --rm -T --no-deps app cli init-school \
    --name "$SCHOOL_NAME" --admin-login "$ADMIN_LOGIN" --admin-password-stdin 2>&1)" || rc=$?
  # 先在密码还在内存时脱敏,再清掉密码
  shown="$(printf '%s\n' "$out" | redact)"
  ADMIN_PW=""
  unset ADMIN_PW
  case "$rc" in
    0) printf '%s\n' "$shown" | tail -n 3 ;;
    3) log_info "学校已初始化过,未做任何改动" ;;
    *)
      printf '%s\n' "$shown" | tail -n 6 >&2
      die "初始化学校失败(退出码 $rc)。修正后重新运行本脚本即可继续,不会重新生成密钥"
      ;;
  esac
}

# 写单元文件并启用定时器;任何一步失败返回非 0(调用者降级为 crontab 提示)
enable_backup_timer() {
  local unit content unit_dir pct='%' dollar='$'
  shopt -u patsub_replacement 2>/dev/null || true
  unit_dir="${DEPLOY_DIR//$pct/$pct$pct}"
  unit_dir="${unit_dir//$dollar/$dollar$dollar}"
  for unit in workstation-backup.service workstation-backup.timer; do
    [ -f "$DEPLOY_DIR/systemd/$unit" ] || { log_warn "没有找到 systemd 单元文件 systemd/$unit"; return 1; }
  done
  for unit in workstation-backup.service workstation-backup.timer; do
    # 单元模板里的 @DEPLOY_DIR@ 替换为本部署目录
    # systemd 里 % 与 $ 有特殊含义,写进单元前转义;bash 5.2 的替换串里 & 也有特殊含义,先关掉(install 已拒绝含这些字符的目录,这里是双保险)
    content="$(<"$DEPLOY_DIR/systemd/$unit")"
    printf '%s\n' "${content//@DEPLOY_DIR@/$unit_dir}" >"/etc/systemd/system/$unit" || return 1
  done
  systemctl daemon-reload || return 1
  systemctl enable --now workstation-backup.timer || return 1
}

install_backup_timer() {
  if [ "$(id -u)" -eq 0 ] && command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; then
    if enable_backup_timer; then
      log_info "已启用每日 02:30 自动备份(systemd 定时器 workstation-backup.timer)"
      return 0
    fi
    log_warn "systemd 定时器没有装好(上面是原因),改用 crontab:"
  else
    log_warn "未安装自动备份定时器(非 root 或没有 systemd)。请手动添加 crontab(crontab -e):"
  fi
  printf '    30 2 * * * cd %q && ./scripts/backup.sh >> data/logs/backup.log 2>&1\n' "$DEPLOY_DIR"
}

export_root_ca() {
  local out="$DEPLOY_DIR/certs/ws-root-ca.crt"
  [ "$(read_env WS_TLS_MODE)" = "internal" ] || return 0
  log_info "导出内部证书的根证书……"
  for _ in $(seq 1 30); do
    if compose exec -T web cat /data/caddy/pki/authorities/local/root.crt >"$out.tmp" 2>/dev/null \
      && [ -s "$out.tmp" ]; then
      mv "$out.tmp" "$out"
      log_info "已导出 certs/ws-root-ca.crt,请把它安装到各终端(电脑、手机、平板)的受信任根证书里,否则浏览器会提示不安全"
      return 0
    fi
    sleep 2
  done
  rm -f "$out.tmp"
  log_warn "暂未取到 Caddy 根证书,稍后可手动导出:docker compose exec -T web cat /data/caddy/pki/authorities/local/root.crt > certs/ws-root-ca.crt"
}

print_summary() {
  local site https_port url
  site="$(read_env WS_SITE_ADDRESS)"
  https_port="$(read_env WS_HTTPS_PORT)"
  url="https://$site"
  if [ "$https_port" != "443" ]; then url="$url:$https_port"; fi
  printf '\n'
  log_info "安装完成"
  printf '  访问地址:%s\n' "$url"
  if [ -n "$ADMIN_LOGIN" ]; then
    printf '  管理员登录名:%s(首次登录需修改密码)\n' "$ADMIN_LOGIN"
  fi
  printf '  备份目录:%s/backups\n' "$DEPLOY_DIR"
  printf '  注意:%s 里有主密钥,请连同备份一起妥善保管,不要上传到外网\n' ".env"
}

main() {
  local count
  parse_args "$@"
  # 读完参数后立刻把环境变量里的管理员密码收进普通变量并从环境清除:
  # 之后 docker / docker compose 等任何子进程都不会继承它(环境变量对同用户进程可见)
  INSTALL_PW_ENV="${WS_INSTALL_ADMIN_PASSWORD:-}"
  unset WS_INSTALL_ADMIN_PASSWORD
  cd "$DEPLOY_DIR"
  case "$DEPLOY_DIR" in
    *[[:space:]]*|*%*|*\$*|*\&*) die "部署目录路径里不能含空格或 % $ & 这些字符(会让 systemd 定时备份与脚本出错)。请把部署目录改到不含这些字符的路径(例如 /opt/workstation)再安装" ;;
  esac
  [ -f "$DEPLOY_DIR/VERSION" ] || die "部署目录里缺少 VERSION 文件,请在解开的离线包目录里运行"
  [ -f "$DEPLOY_DIR/docker-compose.yml" ] || die "部署目录里缺少 docker-compose.yml"

  check_os
  check_docker

  if [ -f "$ENV_FILE" ]; then
    # R9:.env 存在即视为已安装,绝不重新生成密钥
    log_info "检测到 .env:系统已安装,不会重新生成密钥,只确保服务已启动"
    HTTP_PORT="$(read_env WS_HTTP_PORT)"; HTTPS_PORT="$(read_env WS_HTTPS_PORT)"
    check_env_complete
    check_disk
    prepare_dirs
    start_services
    count="$(school_count)"
    case "$count" in
      ''|*[!0-9]*) die "无法查询数据库里的学校数量(可能数据库没有就绪或表还没建好),为避免误判已停止。请检查 docker compose logs 后重新运行" ;;
    esac
    if [ "$count" = "0" ]; then
      log_warn "数据库里还没有学校(上次安装可能在初始化前中断),现在补做初始化"
      collect_school_inputs
      init_school
    fi
    export_root_ca
  else
    if [ -d "$DEPLOY_DIR/data/pg" ]; then
      die "发现已有数据但缺少 .env,请从备份恢复 .env(备份包里的 env 文件)。为避免覆盖现有数据,本脚本已停止"
    fi
    HTTP_PORT="${WS_HTTP_PORT:-80}"; HTTPS_PORT="${WS_HTTPS_PORT:-443}"
    check_port_number WS_HTTP_PORT "$HTTP_PORT"
    check_port_number WS_HTTPS_PORT "$HTTPS_PORT"
    check_disk
    check_ports "$HTTP_PORT" "$HTTPS_PORT"
    collect_school_inputs
    collect_site_inputs
    load_images
    place_caddyfile_and_certs
    generate_env
    prepare_dirs
    start_services
    init_school
    export_root_ca
  fi
  install_backup_timer
  print_summary
}

main "$@"
exit 0
