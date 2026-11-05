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

# read_env <键> [文件]:读 .env(默认 $ENV_FILE)里的值(只取第一处);键不存在时输出空。
# 统一去掉首尾的 \r(Windows 换行)与成对的单引号或双引号,这样"带引号"与"不带引号"的写法得到同一个值。
read_env() {
  local f="${2:-$ENV_FILE}" v
  [ -f "$f" ] || return 0
  v="$(grep -m1 "^$1=" "$f" | cut -d= -f2- || true)"
  v="${v%$'\r'}"
  v="${v#$'\r'}"
  case "$v" in
    \"*\") v="${v#\"}"; v="${v%\"}" ;;
    \'*\') v="${v#\'}"; v="${v%\'}" ;;
  esac
  printf '%s\n' "$v"
}

# 临时文件登记:脚本退出(含 Ctrl-C、被 kill)时由 lib_cleanup 统一删除,不留半成品。
# 各脚本需 trap 自己的清理函数(其中调用 lib_cleanup)并把 INT / TERM 转成 exit。
_WS_TMPS=()
register_tmp() { _WS_TMPS+=("$1"); }
lib_cleanup() {
  local f
  for f in ${_WS_TMPS[@]+"${_WS_TMPS[@]}"}; do rm -rf "$f"; done
  release_lock
  return 0
}

# ---- 互斥锁:备份 / 恢复 / 升级同一时刻只能有一个在跑 ----
# 用 mkdir 当锁(原子),锁目录里记录持有者 pid;持有者已不存在(被 kill -9、断电)则接管。
# 升级脚本调用备份脚本时,经环境变量 WS_LOCK_OWNER_PID 告诉子进程"锁是我(父进程)持有的",子进程不再重复加锁。
_WS_LOCK_DIR=""
acquire_lock() {
  local dir="$DEPLOY_DIR/backups/.lock" holder
  mkdir -p "$DEPLOY_DIR/backups"
  chmod 700 "$DEPLOY_DIR/backups" 2>/dev/null || true
  if mkdir "$dir" 2>/dev/null; then
    printf '%s\n' "$$" >"$dir/pid"
    _WS_LOCK_DIR="$dir"
    return 0
  fi
  holder="$(cat "$dir/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && [ "$holder" = "${WS_LOCK_OWNER_PID:-}" ] && kill -0 "$holder" 2>/dev/null; then
    return 0
  fi
  if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
    log_warn "发现上一次异常中断留下的锁(进程 $holder 已不存在),已接管"
    rm -rf "$dir"
    if mkdir "$dir" 2>/dev/null; then
      printf '%s\n' "$$" >"$dir/pid"
      _WS_LOCK_DIR="$dir"
      return 0
    fi
  fi
  die "另一个备份、恢复或升级正在进行(锁:$dir,持有进程:${holder:-未知})。请等它结束后再试;如果确认没有在运行,删除该目录即可"
}
release_lock() {
  if [ -n "$_WS_LOCK_DIR" ]; then rm -rf "$_WS_LOCK_DIR"; _WS_LOCK_DIR=""; fi
  return 0
}

# clean_stale_tmp:清理超过 1 天的备份 / 恢复临时残留(被强行中断时留下的)
clean_stale_tmp() {
  find "$DEPLOY_DIR/backups" -maxdepth 1 \( -name '.stage.*' -o -name '.ws-backup.*.partial' \) -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  find "$DEPLOY_DIR" -maxdepth 1 -name '.ws-restore.*' -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  return 0
}

# manifest_valid <文件>:manifest.json 必须是备份脚本写出的格式(逐行严格匹配);通过返回 0。
# files 里键集合必须恰好是 db.dump、env、caddy.tar 各一次,值是 64 位十六进制,除最后一项外每项行尾有逗号。
manifest_valid() {
  awk '
    BEGIN { st = 0; nf = 0; hex = ""; for (i = 0; i < 64; i++) hex = hex "[0-9a-f]"
            re = "^    \"(db\\.dump|env|caddy\\.tar)\": \"" hex "\",?$" }
    st == 0 { if ($0 == "{") { st = 1; next } else bad = 1 }
    st == 1 { if ($0 ~ /^  "version": "[A-Za-z0-9._-]+",$/) { st = 2; next } else bad = 1 }
    st == 2 { if ($0 ~ /^  "migration": "[0-9A-Za-z_]+",$/) { st = 3; next } else bad = 1 }
    st == 3 { if ($0 ~ /^  "created_at": "[0-9T:Z-]+",$/) { st = 4; next } else bad = 1 }
    st == 4 { if ($0 == "  \"files\": {") { st = 5; next } else bad = 1 }
    st == 5 {
      if ($0 ~ re) {
        nf++
        key = $0; sub(/^    "/, "", key); sub(/".*$/, "", key)
        seen[key]++
        if (seen[key] > 1) bad = 1
        comma[nf] = ($0 ~ /,$/) ? 1 : 0
        next
      } else if ($0 == "  }") { st = 6; next } else bad = 1
    }
    st == 6 { if ($0 == "}") { st = 7; next } else bad = 1 }
    st == 7 { bad = 1 }
    END {
      if (nf != 3) bad = 1
      for (i = 1; i <= nf; i++) { if (i < nf && !comma[i]) bad = 1; if (i == nf && comma[i]) bad = 1 }
      exit (bad || st != 7) ? 1 : 0
    }
  ' "$1"
}

# mask_shapes:标准输入 → 标准输出。按形状打码(不依赖已知密钥值):JWT、Bearer / Token 授权头、
# Cookie / Set-Cookie、URL 里的 token 参数、password / secret / token 类的 key=value 与 JSON 字段、手机号
# (含 +86 / 86 前缀,以及 - 或空格分隔的写法)。只用 POSIX 字符类,兼容 BSD 与 GNU sed。
mask_shapes() {
  sed -E \
    -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/***/g' \
    -e 's/([Aa][Uu][Tt][Hh][Oo][Rr][Ii][Zz][Aa][Tt][Ii][Oo][Nn][[:space:]]*:[[:space:]]*[A-Za-z]+[[:space:]]+)[^[:space:]]+/\1***/g' \
    -e 's/[Bb][Ee][Aa][Rr][Ee][Rr][[:space:]]+[A-Za-z0-9._~+\/=-]+/Bearer ***/g' \
    -e 's/([Ss][Ee][Tt]-[Cc][Oo][Oo][Kk][Ii][Ee][[:space:]]*:|[Cc][Oo][Oo][Kk][Ii][Ee][[:space:]]*:).*/\1 ***/g' \
    -e 's/([?&][A-Za-z0-9_]*([Tt][Oo][Kk][Ee][Nn]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt])=)[^&[:space:]"'"'"']+/\1***/g' \
    -e 's/("[A-Za-z0-9_]*([Tt][Oo][Kk][Ee][Nn]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt])"[[:space:]]*:[[:space:]]*)"[^"]*"/\1"***"/g' \
    -e 's/([A-Za-z0-9_]*([Tt][Oo][Kk][Ee][Nn]|[Pp][Aa][Ss][Ss][Ww][Oo][Rr][Dd]|[Ss][Ee][Cc][Rr][Ee][Tt])[[:space:]]*=[[:space:]]*["'"'"']?)[^[:space:]&,;"'"'"']+/\1***/g' \
    -e 's/(^|[^0-9])(\+?86[- ]?)?1[3-9][0-9][- ]?[0-9]{4}[- ]?[0-9]{4}([^0-9]|$)/\11**********\3/g' \
    -e 's/(^|[^0-9])(\+?86[- ]?)?1[3-9][0-9][- ]?[0-9]{4}[- ]?[0-9]{4}([^0-9]|$)/\11**********\3/g'
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

# service_running <服务>:该服务的容器存在且正在运行则返回 0
service_running() {
  local cid
  cid="$(compose ps -q "$1" 2>/dev/null | head -n 1)"
  [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || true)" = "true" ]
}
