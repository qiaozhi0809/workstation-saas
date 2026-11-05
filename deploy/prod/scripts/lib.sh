#!/usr/bin/env bash
# 部署脚本公共函数(被 install.sh / upgrade.sh 等 source,不单独运行)。
# 目标环境 Ubuntu 22.04 / 24.04(bash 5);只依赖 bash、coreutils、docker、tar、openssl。
# 注意:本文件及所有部署脚本都不得开启 xtrace(逐行回显),也不得把密钥打印出来。
# 即使调用者的环境里带了 xtrace 开关,也在这里关掉:xtrace 会把 .env 里的密钥打到终端或日志。
set +x
unset BASH_XTRACEFD

# 部署目录 = 本文件所在目录(scripts/)的上一级
DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$DEPLOY_DIR/.env"

if [ -t 1 ] && [ -t 2 ]; then
  C_RED=$'\033[31m'; C_YEL=$'\033[33m'; C_GRN=$'\033[32m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_YEL=""; C_GRN=""; C_OFF=""
fi

log_info() { printf '%s[信息]%s %s\n' "$C_GRN" "$C_OFF" "$*"; }
log_warn() { printf '%s[警告]%s %s\n' "$C_YEL" "$C_OFF" "$*" >&2; }
# die [消息]:打印中文错误并以 1 退出。消息里不得带密钥。
die() { printf '%s[错误]%s %s\n' "$C_RED" "$C_OFF" "$*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "缺少命令 $1,${2:-请先安装后再运行}"
}

# compose 项目名:默认 workstation;测试用 WS_COMPOSE_PROJECT 覆盖
compose() {
  docker compose -p "${WS_COMPOSE_PROJECT:-workstation}" --project-directory "$DEPLOY_DIR" "$@"
}

# sha256_of <文件>:优先 sha256sum,缺失时回退 shasum -a 256(macOS 本机测试用)
sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# wait_healthy <服务> <秒>:等容器 healthcheck 变为 healthy;超时返回 1
wait_healthy() {
  local svc="$1" limit="$2" waited=0 cid status
  while [ "$waited" -lt "$limit" ]; do
    cid="$(compose ps -q "$svc" 2>/dev/null | head -n 1)"
    if [ -n "$cid" ]; then
      status="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$cid" 2>/dev/null || true)"
      case "$status" in
        healthy|running) return 0 ;;
      esac
    fi
    sleep 2
    waited=$((waited + 2))
  done
  return 1
}

# read_env <键>:读 .env 里的值(只取第一处);键不存在时输出空
read_env() {
  [ -f "$ENV_FILE" ] || return 0
  grep -m1 "^$1=" "$ENV_FILE" | cut -d= -f2- || true
}

# 临时文件登记:脚本退出(含 Ctrl-C、被 kill)时由 lib_cleanup 统一删除,不留半成品。
# 各脚本需 trap 自己的清理函数(其中调用 lib_cleanup)并把 INT / TERM 转成 exit。
_WS_TMPS=()
register_tmp() { _WS_TMPS+=("$1"); }
lib_cleanup() {
  local f
  for f in ${_WS_TMPS[@]+"${_WS_TMPS[@]}"}; do rm -rf "$f"; done
  return 0
}

# check_disk:部署目录所在磁盘可用空间门槛(默认 20 GB;WS_INSTALL_MIN_DISK_GB 只在测试里下调)
check_disk() {
  local min_gb avail_kb
  min_gb="${WS_INSTALL_MIN_DISK_GB:-20}"
  avail_kb="$(df -Pk "$DEPLOY_DIR" | awk 'NR==2 {print $4}')"
  if [ "$avail_kb" -lt $((min_gb * 1024 * 1024)) ]; then
    die "部署目录所在磁盘可用空间不足 ${min_gb} GB(当前约 $((avail_kb / 1024 / 1024)) GB)"
  fi
}

# set_env <键> <值> [文件]:原地改 .env(键不存在则追加;默认改 $ENV_FILE),不打印值。
# 值经环境变量交给 awk,不进命令行参数(ps 看不到),也不经 awk 的转义处理。
# 先写 600 权限的同目录临时文件再 mv;临时文件已登记,中途退出会被清掉。
set_env() {
  local key="$1" val="$2" target="${3:-$ENV_FILE}" tmp
  tmp="$(umask 077; mktemp "$target.XXXXXX")"
  register_tmp "$tmp"
  chmod 600 "$tmp"
  if ! WS_SETENV_VAL="$val" awk -v k="$key" '
    BEGIN { v = ENVIRON["WS_SETENV_VAL"]; done = 0 }
    index($0, k "=") == 1 && !done { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$target" >"$tmp"; then
    rm -f "$tmp"
    die "写入配置失败"
  fi
  mv "$tmp" "$target"
}

# redact:从标准输入读文本,把 .env 里的 WS_JWT_SECRET / WS_MASTER_KEY / POSTGRES_PASSWORD 的值
# 以及(若有)管理员密码替换成 ***,再输出。值经环境变量交给 awk,不进命令行。
# 所有把容器输出回显到终端之前都应过一遍。
redact() {
  WS_RD1="$(read_env WS_JWT_SECRET)" WS_RD2="$(read_env WS_MASTER_KEY)"   WS_RD3="$(read_env POSTGRES_PASSWORD)" WS_RD4="${ADMIN_PW:-}" awk '
    BEGIN {
      n = 0
      for (i = 1; i <= 4; i++) { v = ENVIRON["WS_RD" i]; if (length(v) >= 4) s[++n] = v }
    }
    {
      line = $0
      for (i = 1; i <= n; i++) {
        out = ""
        while ((p = index(line, s[i])) > 0) {
          out = out substr(line, 1, p - 1) "***"
          line = substr(line, p + length(s[i]))
        }
        line = out line
      }
      print line
    }'
}

# rand_secret <字节数> [urlsafe]:openssl rand -base64;urlsafe 时把 + / 换成 - _(用于放进连接串)
rand_secret() {
  local out
  out="$(openssl rand -base64 "$1" | tr -d '\n')"
  if [ "${2:-}" = "urlsafe" ]; then
    out="$(printf '%s' "$out" | tr '+/' '-_')"
  fi
  printf '%s' "$out"
}

# 到另一个文件的原子替换:先写同目录临时文件再 mv,这样正在运行的脚本(自己被升级覆盖时)仍读旧 inode
replace_file() {
  local src="$1" dst="$2" tmp
  tmp="$dst.new.$$"
  cp -p "$src" "$tmp"
  mv "$tmp" "$dst"
}
