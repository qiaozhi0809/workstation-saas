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

# str_grep <字符串> <grep 参数...>:把字符串作为输入交给 grep,返回 grep 的退出码。
# 不能写成 `printf '%s' "$s" | grep -q ...`:set -o pipefail 下 grep -q 提前退出会让 printf 收到 SIGPIPE(141),
# 把"匹配成功"变成"管道失败"(grep -v 的检查更会因此被绕过)。这里在子 shell 里关掉 pipefail;
# 字符串不落盘(这也是不用 here-string 的原因:老版本 bash 的 here-string 会写临时文件,密码类字符串不应如此)。
str_grep() {
  local s="$1"
  shift
  ( set +o pipefail; printf '%s\n' "$s" | grep "$@" )
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

# clean_stale_tmp:清理超过 1 天的备份 / 恢复 / 升级临时残留(被强行中断时留下的)
clean_stale_tmp() {
  find "$DEPLOY_DIR/backups" -maxdepth 1 \( -name '.stage.*' -o -name '.ws-backup.*.partial' -o -name '.lock.stale.*' \) -mtime +1 -exec rm -rf {} + 2>/dev/null || true
  find "$DEPLOY_DIR" -maxdepth 1 \( -name '.ws-restore.*' -o -name '.ws-upgrade.*' \) -mtime +1 -exec rm -rf {} + 2>/dev/null || true
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
