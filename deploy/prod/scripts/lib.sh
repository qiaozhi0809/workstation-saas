#!/usr/bin/env bash
# 部署脚本公共函数(被 install.sh / upgrade.sh 等 source,不单独运行)。
# 目标环境 Ubuntu 22.04 / 24.04(bash 5);只依赖 bash、coreutils、docker、tar、openssl。
# 注意:本文件及所有部署脚本都不得开启 xtrace(逐行回显),也不得把密钥打印出来。
# 即使调用者的环境里带了 xtrace 开关,也在这里关掉:xtrace 会把 .env 里的密钥打到终端或日志。
set +x
unset BASH_XTRACEFD
# 镜像版本只认 .env 里的 WS_VERSION(L117):调用者 shell 里若碰巧导出了 WS_VERSION,compose 会优先用它,
# 升级 / 恢复就可能起错版本的镜像。这里一进来就清掉;需要临时指定版本的地方(升级预检)按命令单独传。
unset WS_VERSION

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

# str_grep <字符串> <grep 参数...>:把字符串作为输入交给 grep,返回 grep 的退出码。
# 不能写成 `printf '%s' "$s" | grep -q ...`:set -o pipefail 下 grep -q 提前退出会让 printf 收到 SIGPIPE(141),
# 把"匹配成功"变成"管道失败"(grep -v 的检查更会因此被绕过)。这里在子 shell 里关掉 pipefail;
# 字符串不落盘(这也是不用 here-string 的原因:老版本 bash 的 here-string 会写临时文件,密码类字符串不应如此)。
str_grep() {
  local s="$1"
  shift
  ( set +o pipefail; printf '%s\n' "$s" | grep "$@" )
}

# compose 项目名:默认 workstation;测试用 WS_COMPOSE_PROJECT 覆盖。
# 变量文件显式指定为部署目录的 .env(L117):不依赖 compose 按当前目录找 .env 的默认行为;.env 还没生成时(首次安装
# 的前半段)不带该参数。调用者环境里按命令单独传的变量(如升级预检的 WS_VERSION)仍优先于 .env。
compose() {
  if [ -f "$ENV_FILE" ]; then
    docker compose -p "${WS_COMPOSE_PROJECT:-workstation}" --project-directory "$DEPLOY_DIR" --env-file "$ENV_FILE" "$@"
  else
    docker compose -p "${WS_COMPOSE_PROJECT:-workstation}" --project-directory "$DEPLOY_DIR" "$@"
  fi
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
    cid="$(compose ps -q "$svc" 2>/dev/null | head -n 1 || true)"
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

# require_same_user(L183):备份 / 恢复 / 升级 / 回退 / 再次安装必须由"安装这套系统的用户"执行(以 .env 的属主为准)。
# root(sudo)安装后普通用户再跑,会撞上 root 的锁目录与 600 文件,报出来的是"另一个备份正在进行"、".env 可能被损坏"
# 这类让人摸不着头脑的错误;普通用户安装后用 sudo 跑,又会把新文件写成 root 的,下次普通用户写不了。这里直接说清楚。
# 还没有 .env(首次安装)时不检查。
require_same_user() {
  local owner me name
  [ -f "$ENV_FILE" ] || return 0
  owner="$(stat -c %u "$ENV_FILE" 2>/dev/null || stat -f %u "$ENV_FILE" 2>/dev/null || true)"
  me="$(id -u)"
  [ -n "$owner" ] && [ "$owner" != "$me" ] || return 0
  if [ "$owner" = "0" ]; then
    die "该部署由 root 安装(.env 的属主是 root),请用 sudo 执行同一条命令(例如 sudo ./scripts/backup.sh)。备份、恢复、升级、回退都必须用同一个用户执行"
  fi
  name="$(id -un "$owner" 2>/dev/null || true)"
  die "该部署由用户 ${name:-uid $owner} 安装(.env 的属主),请切换到该用户执行,不要用 sudo。备份、恢复、升级、回退都必须用同一个用户执行"
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
# 接管陈旧锁时先把旧锁目录 mv 成唯一名字(rename 原子,两个进程同时接管只有一个 mv 成功),再 mkdir 新锁;
# 不先 rm 再 mkdir,否则两个接管者可能互相删掉对方刚建的新锁。
# 升级脚本调用备份脚本时,经环境变量 WS_LOCK_OWNER_PID 告诉子进程"锁是我(父进程)持有的",子进程不再重复加锁。
_WS_LOCK_DIR=""

# pid_alive <pid>:进程存在返回 0。kill -0 对"存在但不属于当前用户"的进程返回 EPERM(Operation not permitted),
# 这种情况进程仍然活着,必须当作存活;不能因为 kill -0 失败就判定持有者已死。
pid_alive() {
  local pid="$1" msg
  case "$pid" in ''|*[!0-9]*) return 1 ;; esac
  if kill -0 "$pid" 2>/dev/null; then return 0; fi
  msg="$(LC_ALL=C kill -0 "$pid" 2>&1 || true)"
  case "$msg" in *"not permitted"*|*"EPERM"*) return 0 ;; esac
  ps -p "$pid" >/dev/null 2>&1
}

# 在 umask 077 下建锁目录并写入 pid(与调用者的 umask 无关)
_lock_mkdir() {
  local dir="$1"
  if (umask 077; mkdir "$dir" 2>/dev/null); then
    (umask 077; printf '%s\n' "$$" >"$dir/pid")
    _WS_LOCK_DIR="$dir"
    return 0
  fi
  return 1
}

acquire_lock() {
  local dir="$DEPLOY_DIR/backups/.lock" holder moved
  mkdir -p "$DEPLOY_DIR/backups"
  chmod 700 "$DEPLOY_DIR/backups" 2>/dev/null || true
  _lock_mkdir "$dir" && return 0
  holder="$(cat "$dir/pid" 2>/dev/null || true)"
  if [ -n "$holder" ] && [ "$holder" = "${WS_LOCK_OWNER_PID:-}" ] && pid_alive "$holder"; then
    return 0
  fi
  if [ -n "$holder" ] && ! pid_alive "$holder"; then
    moved="$dir.stale.$$"
    if mv "$dir" "$moved" 2>/dev/null; then
      if [ "$(cat "$moved/pid" 2>/dev/null || true)" = "$holder" ]; then
        log_warn "发现上一次异常中断留下的锁(进程 $holder 已不存在),已接管"
        rm -rf "$moved"
        _lock_mkdir "$dir" && return 0
      else
        # 读到 holder 之后锁被别人换成了新锁,我们挪走的是活锁:放回去,按"正在进行"处理
        mv "$moved" "$dir" 2>/dev/null || true
      fi
    fi
  fi
  die "另一个备份、恢复或升级正在进行(锁:$dir,持有进程:${holder:-未知})。请等它结束后再试;如果确认没有在运行,删除该目录即可"
}
release_lock() {
  if [ -n "$_WS_LOCK_DIR" ]; then rm -rf "$_WS_LOCK_DIR"; _WS_LOCK_DIR=""; fi
  return 0
}

# clean_stale_tmp:清理超过 1 天的备份 / 恢复 / 升级临时残留(被强行中断时留下的)。
# 不碰 backups/.ws-upgrade-state(升级中断的记录,由 rollback.sh 或下一次成功升级清除,L190)与 backups/pre-upgrade-*(升级前快照)。
clean_stale_tmp() {
  find "$DEPLOY_DIR/backups" -maxdepth 1 \( -name '.stage.*' -o -name '.ws-backup.*.partial' -o -name '.lock.stale.*' \) -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  find "$DEPLOY_DIR" -maxdepth 1 \( -name '.ws-restore.*' -o -name '.ws-upgrade.*' \) -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  return 0
}

# manifest_valid <文件>:manifest.json 必须是备份脚本写出的格式(逐行严格匹配);通过返回 0。两种格式都认:
#   * 1.0.0 之前:没有 caddy 行,files 恰好是 db.dump、env、caddy.tar 各一次;
#   * 1.0.0 起:created_at 之后一行 "caddy": "included" 或 "skipped",files 为 db.dump、env、[caddy.tar]、config.tar,
#     included 时必须有 caddy.tar,skipped 时必须没有。
# 值是 64 位十六进制,除最后一项外每项行尾有逗号。
manifest_valid() {
  awk '
    BEGIN { st = 0; nf = 0; caddy = ""; hex = ""; for (i = 0; i < 64; i++) hex = hex "[0-9a-f]"
            re = "^    \"(db\\.dump|env|caddy\\.tar|config\\.tar)\": \"" hex "\",?$" }
    st == 0 { if ($0 == "{") { st = 1; next } else bad = 1 }
    st == 1 { if ($0 ~ /^  "version": "[A-Za-z0-9._-]+",$/) { st = 2; next } else bad = 1 }
    st == 2 { if ($0 ~ /^  "migration": "[0-9A-Za-z_]+",$/) { st = 3; next } else bad = 1 }
    st == 3 { if ($0 ~ /^  "created_at": "[0-9T:Z-]+",$/) { st = 4; next } else bad = 1 }
    st == 4 {
      if ($0 ~ /^  "caddy": "(included|skipped)",$/ && caddy == "") {
        caddy = $0; sub(/^  "caddy": "/, "", caddy); sub(/",$/, "", caddy); next
      } else if ($0 == "  \"files\": {") { st = 5; next } else bad = 1
    }
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
      if (!seen["db.dump"] || !seen["env"]) bad = 1
      if (caddy == "") {
        if (nf != 3 || !seen["caddy.tar"] || seen["config.tar"]) bad = 1
      } else {
        if (!seen["config.tar"]) bad = 1
        if (caddy == "included" && (nf != 4 || !seen["caddy.tar"])) bad = 1
        if (caddy == "skipped" && (nf != 3 || seen["caddy.tar"])) bad = 1
      }
      for (i = 1; i <= nf; i++) { if (i < nf && !comma[i]) bad = 1; if (i == nf && comma[i]) bad = 1 }
      exit (bad || st != 7) ? 1 : 0
    }
  ' "$1"
}

# manifest_caddy <文件>:输出 manifest 里的 caddy 字段(included / skipped);旧格式没有该字段时输出 included
manifest_caddy() {
  local v
  v="$(sed -n -E 's/^  "caddy": "(included|skipped)",$/\1/p' "$1" | head -n 1)"
  printf '%s\n' "${v:-included}"
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

# disk_avail_kb <路径>:该路径所在文件系统的可用空间(KB)
disk_avail_kb() { df -Pk "$1" | awk 'NR==2 {print $4}'; }

# check_disk:安装 / 升级的磁盘门槛(默认 20 GB;WS_INSTALL_MIN_DISK_GB 只在测试里下调)。
# 同时看两块盘(L199):部署目录所在盘(备份、数据)与 Docker 数据目录所在盘(镜像、容器日志,通常是 /var/lib/docker);
# 两者在同一块盘时只查一次。docker 不可用时跳过后者。
check_disk() {
  local min_gb avail_kb droot
  min_gb="${WS_INSTALL_MIN_DISK_GB:-20}"
  avail_kb="$(disk_avail_kb "$DEPLOY_DIR")"
  if [ "$avail_kb" -lt $((min_gb * 1024 * 1024)) ]; then
    die "部署目录所在磁盘可用空间不足 ${min_gb} GB(当前约 $((avail_kb / 1024 / 1024)) GB)"
  fi
  droot="$(docker info --format '{{.DockerRootDir}}' 2>/dev/null || true)"
  if [ -n "$droot" ] && [ -d "$droot" ] && [ "$(df -Pk "$droot" | awk 'NR==2 {print $1}')" != "$(df -Pk "$DEPLOY_DIR" | awk 'NR==2 {print $1}')" ]; then
    avail_kb="$(disk_avail_kb "$droot")"
    if [ "$avail_kb" -lt $((min_gb * 1024 * 1024)) ]; then
      die "Docker 数据目录 $droot 所在磁盘可用空间不足 ${min_gb} GB(当前约 $((avail_kb / 1024 / 1024)) GB):镜像与容器日志都放在这里。请删除不再需要的旧版本镜像(docker image rm workstation-app:<旧版本> workstation-web:<旧版本> workstation-stream:<旧版本>)或扩容"
    fi
  fi
}

# ---- IPv4 网段(L186 / L207):compose 子网的选择与 WS_TRUSTED_PROXIES 的比对。只处理 IPv4,非法输入返回 1 ----

# ip4_to_int <a.b.c.d>:点分十进制 → 整数;不是合法 IPv4 返回 1
ip4_to_int() {
  local a b c d rest o
  IFS=. read -r a b c d rest <<<"$1"
  [ -z "$rest" ] || return 1
  for o in "$a" "$b" "$c" "$d"; do
    case "$o" in ''|*[!0-9]*) return 1 ;; esac
    [ "${#o}" -le 3 ] && [ "$((10#$o))" -le 255 ] || return 1
  done
  printf '%s\n' $(( (10#$a << 24) + (10#$b << 16) + (10#$c << 8) + 10#$d ))
}

# cidr_range <网段或 IP>:输出 "起始 结束"(整数)。a.b.c.d/n(n 为 0-32);不带 /n 的单个地址按 /32;非法返回 1
cidr_range() {
  local ip bits n mask start
  ip="${1%%/*}"
  if [ "$ip" = "$1" ]; then bits=32; else bits="${1#*/}"; fi
  case "$bits" in ''|*[!0-9]*) return 1 ;; esac
  [ "${#bits}" -le 2 ] && [ "$((10#$bits))" -le 32 ] || return 1
  bits=$((10#$bits))
  n="$(ip4_to_int "$ip")" || return 1
  if [ "$bits" -eq 0 ]; then mask=0; else mask=$(( (0xFFFFFFFF << (32 - bits)) & 0xFFFFFFFF )); fi
  start=$(( n & mask ))
  printf '%s %s\n' "$start" $(( start | (~mask & 0xFFFFFFFF) ))
}

# cidr_valid <网段>:形如 a.b.c.d/n,且是网络地址(主机位全 0),如 172.30.0.0/24
cidr_valid() {
  local r ip
  case "$1" in */*) ;; *) return 1 ;; esac
  r="$(cidr_range "$1")" || return 1
  ip="$(ip4_to_int "${1%%/*}")" || return 1
  [ "$ip" -eq "${r%% *}" ]
}

# cidr_overlap <A> <B>:两个网段(或地址)有交集返回 0;任一非法返回 1
cidr_overlap() {
  local ra rb
  ra="$(cidr_range "$1")" || return 1
  rb="$(cidr_range "$2")" || return 1
  [ "${ra%% *}" -le "${rb##* }" ] && [ "${rb%% *}" -le "${ra##* }" ]
}

# cidr_contains <外> <内>:外网段完全包含内网段返回 0;任一非法返回 1
cidr_contains() {
  local ra rb
  ra="$(cidr_range "$1")" || return 1
  rb="$(cidr_range "$2")" || return 1
  [ "${ra%% *}" -le "${rb%% *}" ] && [ "${rb##* }" -le "${ra##* }" ]
}

# host_routes:本机 IPv4 路由表里的目标网段(每行一个;default 等关键字跳过)。没有 ip 命令(非 Linux)时无输出
host_routes() {
  command -v ip >/dev/null 2>&1 || return 0
  ip -4 route show 2>/dev/null | awk '$1 ~ /^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+(\/[0-9]+)?$/ { print $1 }' | sort -u
  return 0
}

# docker_subnets:本机全部 docker 网络的 IPv4 子网(每行一个);docker 不可用时无输出
docker_subnets() {
  local ids
  ids="$(docker network ls -q 2>/dev/null | tr '\n' ' ')" || return 0
  [ -n "${ids// /}" ] || return 0
  # shellcheck disable=SC2086  # ids 是空格分隔的网络 id 列表,需要拆开
  docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{"\n"}}{{end}}' $ids 2>/dev/null | grep -E '^[0-9]+\.' | sort -u
  return 0
}

# compose_network_subnet:本项目 compose 网络(<项目名>_ws-net)当前的子网;网络不存在时输出空
compose_network_subnet() {
  docker network inspect -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}' "${WS_COMPOSE_PROJECT:-workstation}_ws-net" 2>/dev/null || true
}

# first_overlap <子网> <网段列表(每行一个)>:输出列表里第一个与子网重叠的网段,没有则无输出
first_overlap() {
  local r
  while IFS= read -r r; do
    [ -n "$r" ] || continue
    if cidr_overlap "$1" "$r"; then printf '%s\n' "$r"; return 0; fi
  done <<<"$2"
  return 0
}

# trusted_proxies_cover <逗号分隔的网段列表> <子网>:列表里有某一项完全包含该子网返回 0
trusted_proxies_cover() {
  local list="$1" subnet="$2" e
  local -a entries=()
  IFS=, read -ra entries <<<"$list"
  for e in ${entries[@]+"${entries[@]}"}; do
    e="${e//[[:space:]]/}"
    [ -n "$e" ] || continue
    if cidr_contains "$e" "$subnet"; then return 0; fi
  done
  return 1
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

# url_password <连接串>:取 scheme://用户:密码@主机/... 里的密码(第一个 ":"(用户名之后)与最后一个 "@" 之间的部分,
# 贪婪匹配,密码里含 "@" 时也能整段取到);不是连接串时输出空。
url_password() {
  printf '%s' "$1" | sed -n -E 's#^[A-Za-z0-9+.-]+://[^:@/]*:(.*)@[^@]*$#\1#p' | head -n 1 || true
}

# secret_values:列出 .env 里需要打码的全部值,每行一个(长度不足 4 的忽略,避免把常见短串全替换掉)。
# 规则不写死具体键名,以后新增密钥(如 WS_FUTURE_API_KEY)自动覆盖:
#   1) 键名含 SECRET、KEY、PASSWORD、TOKEN(不分大小写)的键,取它的值;
#   2) 任何值如果是带账号密码的连接串(DATABASE_URL、REDIS_URL 等),取其中的密码。
# 值可能很敏感,本函数只输出给打码函数使用,调用者不得回显。
secret_values() {
  local f="$ENV_FILE" line key val up pw
  [ -f "$f" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      [A-Za-z_]*=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    case "$key" in *[!A-Za-z0-9_]*) continue ;; esac
    val="$(read_env "$key" "$f")"
    up="$(printf '%s' "$key" | tr 'a-z' 'A-Z')"
    case "$up" in
      *SECRET*|*KEY*|*PASSWORD*|*TOKEN*)
        if [ "${#val}" -ge 4 ]; then printf '%s\n' "$val"; fi
        ;;
    esac
    case "$val" in
      *://*:*@*)
        pw="$(url_password "$val")"
        if [ "${#pw}" -ge 4 ]; then printf '%s\n' "$pw"; fi
        ;;
    esac
  done <"$f"
  return 0
}

# redact:标准输入 → 标准输出。把 secret_values 列出的全部值(以及若有的管理员密码 $ADMIN_PW)替换成 ***。
# 值经环境变量(换行分隔)交给 awk,不进命令行参数(ps 看不到)。先替换较长的值,避免一个值是另一个的子串时漏掉尾巴。
# 所有把容器输出回显到终端或写入诊断包之前都应过一遍。
redact() {
  WS_RD_VALUES="$(secret_values)${ADMIN_PW:+
$ADMIN_PW}" awk '
    BEGIN {
      n = split(ENVIRON["WS_RD_VALUES"], raw, "\n"); m = 0
      for (i = 1; i <= n; i++) if (length(raw[i]) >= 4) s[++m] = raw[i]
      for (i = 2; i <= m; i++) {            # 按长度从长到短(插入排序)
        v = s[i]; j = i - 1
        while (j >= 1 && length(s[j]) < length(v)) { s[j + 1] = s[j]; j-- }
        s[j + 1] = v
      }
    }
    {
      line = $0
      for (i = 1; i <= m; i++) {
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

# render_systemd_unit <模板文件> <部署目录> <时区>:把模板里的 @DEPLOY_DIR@、@TZ@ 替换后输出到标准输出(L184)。
# systemd 里 % 与 $ 有特殊含义,部署目录写进单元前转义(install 已拒绝含这些字符的目录,这里是双保险);
# bash 5.2 的替换串里 & 也有特殊含义,先关掉 patsub_replacement。
render_systemd_unit() {
  local tpl="$1" dir="$2" tz="$3" content pct='%' dollar='$'
  shopt -u patsub_replacement 2>/dev/null || true
  dir="${dir//$pct/$pct$pct}"
  dir="${dir//$dollar/$dollar$dollar}"
  content="$(<"$tpl")"
  content="${content//@DEPLOY_DIR@/$dir}"
  printf '%s\n' "${content//@TZ@/$tz}"
}

# backup_timezone:定时备份用的时区 = .env 的 TZ(容器也用它),不合法或为空时 Asia/Shanghai。
# 形状合法还不够:systemd 的 OnCalendar 只认 tzdata 里有的名字,写错(如 Asia/Shangai)定时器会整个加载失败;
# 本机有 tzdata 时顺带核对,没有该文件就退回默认值并告警。
backup_timezone() {
  local tz
  tz="$(read_env TZ)"
  if ! str_grep "$tz" -Eq '^[A-Za-z][A-Za-z0-9_+/-]*$'; then printf 'Asia/Shanghai\n'; return 0; fi
  if [ -d /usr/share/zoneinfo ] && [ ! -f "/usr/share/zoneinfo/$tz" ]; then
    log_warn ".env 里的 TZ=$tz 在本机 tzdata(/usr/share/zoneinfo)里不存在,定时备份按 Asia/Shanghai 计;请核对 TZ 的拼写"
    printf 'Asia/Shanghai\n'
    return 0
  fi
  printf '%s\n' "$tz"
}

# ---- systemd 定时备份单元(install.sh 首装写入,upgrade.sh 成功后重写,L184 / I-1)----
SYSTEMD_UNIT_DIR="/etc/systemd/system"
# systemd_available:本机由 systemd 管理且有 systemctl
systemd_available() { command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ]; }
# backup_timer_installed_here:系统里已有 workstation-backup 定时器单元,且它指向的就是本部署目录
#(同一台机器上另一个部署的单元不算;非 root 安装从来不写单元,所以普通用户执行时通常为假)
backup_timer_installed_here() {
  local svc="$SYSTEMD_UNIT_DIR/workstation-backup.service"
  [ -f "$svc" ] && [ -f "$SYSTEMD_UNIT_DIR/workstation-backup.timer" ] || return 1
  grep -qF -- "$DEPLOY_DIR/scripts/backup.sh" "$svc" 2>/dev/null
}
# write_backup_timer_units:把 systemd/ 下两份模板按本部署目录与 .env 的 TZ 渲染后写入系统目录,daemon-reload 并启用。
# 任何一步失败返回非 0(调用者决定降级还是只告警)。需要 root。
write_backup_timer_units() {
  local unit tz
  tz="$(backup_timezone)"
  for unit in workstation-backup.service workstation-backup.timer; do
    [ -f "$DEPLOY_DIR/systemd/$unit" ] || { log_warn "没有找到 systemd 单元文件 systemd/$unit"; return 1; }
  done
  for unit in workstation-backup.service workstation-backup.timer; do
    render_systemd_unit "$DEPLOY_DIR/systemd/$unit" "$DEPLOY_DIR" "$tz" >"$SYSTEMD_UNIT_DIR/$unit" || return 1
  done
  systemctl daemon-reload || return 1
  systemctl enable --now workstation-backup.timer || return 1
}
# refresh_backup_timer_if_installed:升级成功后调用。root + systemd + 本部署的单元已存在 → 用新模板与当前 TZ 重写
#(1.0.0 之前写入的单元没有时区,02:30 按服务器的 UTC 计;单元模板本身也可能随版本变)。其他情况什么都不做。
refresh_backup_timer_if_installed() {
  [ "$(id -u)" -eq 0 ] && systemd_available && backup_timer_installed_here || return 0
  if write_backup_timer_units; then
    log_info "已按新版本的模板与 .env 的 TZ($(backup_timezone))重写 systemd 定时备份单元 workstation-backup.timer"
  else
    log_warn "systemd 定时备份单元重写失败(上面是原因)。请稍后执行 sudo ./scripts/install.sh 重新写入,否则定时器仍按旧单元运行"
  fi
  return 0
}

# 到另一个文件的原子替换:先写同目录临时文件再 mv,这样正在运行的脚本(自己被升级覆盖时)仍读旧 inode
replace_file() {
  local src="$1" dst="$2" tmp
  tmp="$dst.new.$$"
  register_tmp "$tmp"   # 中途被 kill 时由 lib_cleanup 删除
  cp -p "$src" "$tmp"
  mv "$tmp" "$dst"
}

# service_running <服务>:该服务的容器存在且正在运行则返回 0
service_running() {
  local cid
  cid="$(compose ps -q "$1" 2>/dev/null | head -n 1)"
  [ -n "$cid" ] && [ "$(docker inspect -f '{{.State.Running}}' "$cid" 2>/dev/null || true)" = "true" ]
}

# compose_version_ok:docker compose 插件版本不低于 2.20(`up --pull never` 与顶层 `name:` 需要)。
# 取不到版本(插件太旧不支持 --short)也算不满足。输出版本号到 stdout,供调用者拼提示。
COMPOSE_MIN_MAJOR=2
COMPOSE_MIN_MINOR=20
compose_version() {
  local v
  v="$(docker compose version --short 2>/dev/null | head -n 1 || true)"
  v="${v#v}"
  printf '%s' "$v"
}
compose_version_ok() {
  local v major rest minor
  v="$(compose_version)"
  [ -n "$v" ] || return 1
  major="${v%%.*}"
  rest="${v#*.}"
  minor="${rest%%.*}"
  major="${major%%[!0-9]*}"
  minor="${minor%%[!0-9]*}"
  [ -n "$major" ] && [ -n "$minor" ] || return 1
  [ "$((10#$major))" -gt "$COMPOSE_MIN_MAJOR" ] && return 0
  [ "$((10#$major))" -eq "$COMPOSE_MIN_MAJOR" ] && [ "$((10#$minor))" -ge "$COMPOSE_MIN_MINOR" ]
}
require_compose_version() {
  compose_version_ok || die "docker compose 插件版本过低或无法识别(当前:$(compose_version || true));需要 ${COMPOSE_MIN_MAJOR}.${COMPOSE_MIN_MINOR} 或更高,请升级 docker-compose-plugin"
}

# start_and_verify <等 app 健康的秒数>:启动全部服务并逐项确认,任何一项不满足就 die(打印明确的中文原因)。
# 为什么要两次 up:第一次 up 时 scheduler 依赖 app 健康,app 启动期迁移较久时 compose 可能先报错返回,
# 此时只告警;等 app 健康后再 up 一次(这次失败直接 die),才能保证 scheduler 真的被创建并运行。
# 之后断言:scheduler、stream-worker 在运行、web 健康,否则不能报"完成"。
start_and_verify() {
  local limit="$1" out
  if ! out="$(compose up -d --pull never 2>&1)"; then
    log_warn "docker compose up 返回非 0(app 启动期间可能暂时如此,稍后会再启动一次),最后几行输出:"
    printf '%s\n' "$out" | tail -n 8 | redact >&2
  fi
  if ! wait_healthy app "$limit"; then
    die "应用服务(app)在 ${limit} 秒内没有就绪。请运行 docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' logs app 查看原因"
  fi
  if ! out="$(compose up -d --pull never 2>&1)"; then
    printf '%s\n' "$out" | tail -n 8 | redact >&2
    die "应用已就绪,但启动其余服务(scheduler、stream-worker、web)失败。请运行 docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' ps -a 与 logs 查看原因"
  fi
  if ! wait_healthy web 120; then
    die "web 服务(反向代理)在 120 秒内没有就绪,系统暂时无法通过浏览器访问。请运行 docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' logs web 查看原因"
  fi
  if ! service_running scheduler; then
    die "定时任务服务(scheduler)没有在运行,定时任务不会执行。请运行 docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' logs scheduler 查看原因"
  fi
  if ! service_running stream-worker; then
    die "摄像头转流服务(stream-worker)没有在运行,监控画面无法播放。请运行 docker compose -p ${WS_COMPOSE_PROJECT:-workstation} --project-directory '$DEPLOY_DIR' logs stream-worker 查看原因"
  fi
}
