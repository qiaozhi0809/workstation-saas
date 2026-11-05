#!/usr/bin/env bash
# 部署脚本公共函数(被 install.sh / upgrade.sh 等 source,不单独运行)。
# 目标环境 Ubuntu 22.04 / 24.04(bash 5);只依赖 bash、coreutils、docker、tar、openssl。
# 注意:本文件及所有部署脚本都不得开启 set -x,也不得把密钥打印出来。

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

# set_env <键> <值>:原地改 .env(键不存在则追加),不打印值。
# 值经环境变量交给 awk,不进命令行参数(ps 看不到),也不经 awk 的转义处理。
set_env() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  chmod 600 "$tmp"
  WS_SETENV_VAL="$val" awk -v k="$key" '
    BEGIN { v = ENVIRON["WS_SETENV_VAL"]; done = 0 }
    index($0, k "=") == 1 && !done { print k "=" v; done = 1; next }
    { print }
    END { if (!done) print k "=" v }
  ' "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
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
