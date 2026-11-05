#!/usr/bin/env bash
# 部署测试脚本的公共部分(被 install_*.sh / upgrade_*.sh 等 source,不单独运行)。
# 兼容 macOS 自带的 bash 3.2 与 BSD 工具:不用关联数组、${v,,}、mapfile、GNU 专有选项。
#
# 可用环境变量:
#   WS_VERSION         镜像标签(默认 0.0.0-seg-b)
#   WS_TEST_PROJECT    compose 项目名(默认 ws-m5a-b)
#   WS_HTTP_PORT / WS_HTTPS_PORT  宿主机端口(默认 18080 / 18443)
# 本文件会设置 WS_INSTALL_SKIP_LOAD=1(镜像已在本机,跳过 docker load)与
# WS_INSTALL_MIN_DISK_GB=1(降低磁盘门槛),这两个开关只用于测试。

if [ "$(id -u)" -eq 0 ]; then
  echo "请不要用 root 运行部署测试(会改变 data/ 目录属主,与正式安装不一致)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${WS_VERSION:-0.0.0-seg-b}"
PROJECT="${WS_TEST_PROJECT:-ws-m5a-b}"
HTTP_PORT="${WS_HTTP_PORT:-18080}"
HTTPS_PORT="${WS_HTTPS_PORT:-18443}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ws-deploytest.XXXXXX")"
DEPLOY="$TMP/deploy"
EXTRA_DIRS=""   # 空格分隔的额外目录,清理时一并删(临时目录名不含空格)
ALIAS_TAGS=""   # 空格分隔的、本测试造的镜像标签,清理时 docker image rm(只删标签)
PS_STOP="$TMP/ps.stop"
PS_LOG="$TMP/ps.log"

export WS_COMPOSE_PROJECT="$PROJECT"
export WS_HTTP_PORT="$HTTP_PORT"
export WS_HTTPS_PORT="$HTTPS_PORT"
export WS_INSTALL_SKIP_LOAD=1
export WS_INSTALL_MIN_DISK_GB=1

# 以下为测试用的假值/随机值,只存在于本进程环境与临时目录里
ADMIN_LOGIN="admin"
ADMIN_PW="Aa1-$(openssl rand -hex 8)"
SCHOOL_NAME="示例学校"

dc() {
  docker compose -p "$PROJECT" --project-directory "$DEPLOY" -f "$DEPLOY/docker-compose.yml" "$@"
}

cleanup() {
  local code=$?
  echo "== 清理:停止并删除容器、卷和临时目录"
  if [ -f "$DEPLOY/docker-compose.yml" ]; then
    dc down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  touch "$PS_STOP" 2>/dev/null || true
  local t
  for t in $ALIAS_TAGS; do docker image rm "$t" >/dev/null 2>&1 || true; done
  # data/pg 属于容器内 uid 70(权限 700),宿主机用户删不掉,借 web 镜像里的 root 来删
  local d
  for d in "$TMP" $EXTRA_DIRS; do
    if [ -d "$d" ] && docker image inspect "workstation-web:$VERSION" >/dev/null 2>&1; then
      docker run --rm --entrypoint sh -v "$d:/t" "workstation-web:$VERSION" \
        -c 'rm -rf /t/deploy/data /t/data' >/dev/null 2>&1 || true
    fi
    rm -rf "$d" 2>/dev/null || true
  done
  exit "$code"
}
trap cleanup EXIT

pass() { echo "  通过:$1"; }
# 把标准输入里的四个密钥值替换成 ***(与被测脚本的 redact 各自独立实现)
redact_secrets() {
  WS_T1="$(env_value WS_JWT_SECRET 2>/dev/null || true)" WS_T2="$(env_value WS_MASTER_KEY 2>/dev/null || true)" \
  WS_T3="$(env_value POSTGRES_PASSWORD 2>/dev/null || true)" WS_T4="$ADMIN_PW" awk '
    BEGIN { for (i = 1; i <= 4; i++) { v = ENVIRON["WS_T" i]; if (length(v) >= 4) s[++n] = v } }
    { for (i = 1; i <= n; i++) while ((p = index($0, s[i])) > 0) $0 = substr($0, 1, p - 1) "***" substr($0, p + length(s[i])); print }'
}

fail() {
  echo "  失败:$1" >&2
  # 失败时只打印各服务最后几行日志,先过滤密钥值(日志里不应含密钥,本身也是被测对象)
  if [ -f "$DEPLOY/docker-compose.yml" ] && [ -f "$DEPLOY/.env" ]; then
    dc logs --tail 20 2>&1 | redact_secrets | sed 's/^/    | /' >&2 || true
  fi
  exit 1
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

# 把 deploy/prod 复制成一份部署目录($1,默认 $DEPLOY),写入 VERSION
prepare_deploy_dir() {
  local dir="${1:-$DEPLOY}"
  mkdir -p "$dir"
  cp -R "$ROOT/deploy/prod/." "$dir/"
  printf '%s\n' "$VERSION" >"$dir/VERSION"
}

# 非交互安装,输出(含 stderr)写到 $1;返回安装脚本的退出码。
# INSTALL_PW_MODE=file 时密码经 WS_INSTALL_ADMIN_PASSWORD_FILE(权限 600 的临时文件)传入,否则经环境变量。
run_install() {
  local log="$1" rc pwfile="$TMP/admin-pw.txt"
  [ -x "$DEPLOY/scripts/install.sh" ] || { echo "scripts/install.sh 不存在或不可执行" >"$log"; return 127; }
  if [ "${INSTALL_PW_MODE:-env}" = "file" ]; then
    (umask 077; printf '%s\n' "$ADMIN_PW" >"$pwfile")
    if (
      cd "$DEPLOY" || exit 1
      WS_INSTALL_SCHOOL_NAME="$SCHOOL_NAME" WS_INSTALL_ADMIN_LOGIN="$ADMIN_LOGIN" \
      WS_INSTALL_ADMIN_PASSWORD_FILE="$pwfile" WS_INSTALL_SITE="localhost" WS_INSTALL_TLS="1" \
        ./scripts/install.sh --non-interactive --force
    ) >"$log" 2>&1; then rc=0; else rc=$?; fi
    rm -f "$pwfile"
  elif (
    cd "$DEPLOY" || exit 1
    WS_INSTALL_SCHOOL_NAME="$SCHOOL_NAME" \
    WS_INSTALL_ADMIN_LOGIN="$ADMIN_LOGIN" \
    WS_INSTALL_ADMIN_PASSWORD="$ADMIN_PW" \
    WS_INSTALL_SITE="localhost" \
    WS_INSTALL_TLS="1" \
      ./scripts/install.sh --non-interactive --force
  ) >"$log" 2>&1; then rc=0; else rc=$?; fi
  return "$rc"
}

env_value() { grep -m1 "^$1=" "$DEPLOY/.env" | cut -d= -f2-; }

psql_scalar() {
  dc exec -T postgres psql -U workstation -d workstation -tA -c "$1" | tr -d '[:space:]'
}

user_count() { psql_scalar "SELECT count(*) FROM users"; }

# 登录请求体经 stdin 传给 curl,密码不出现在命令行参数里;结果写到 $2
login_as() {
  local login="$1" out="$2" pw="$3"
  printf '{"login_name":"%s","password":"%s"}' "$login" "$pw" \
    | curl -ksS --max-time 15 -X POST "https://localhost:$HTTPS_PORT/api/v1/auth/login" \
        -H 'Content-Type: application/json' --data-binary @- >"$out"
}

assert_login_ok() {
  local out="$TMP/login.json"
  login_as "$ADMIN_LOGIN" "$out" "$ADMIN_PW" || fail "登录请求失败"
  tr -d ' \n' <"$out" | grep -q '"access_token"' || fail "登录没有返回 access_token"
  tr -d ' \n' <"$out" | grep -q '"must_change_password":true' || fail "登录返回里 must_change_password 不是 true"
  rm -f "$out"
}

assert_healthz() {
  local body
  body="$(curl -ksS --max-time 10 "https://localhost:$HTTPS_PORT/api/v1/healthz")" || fail "healthz 请求失败"
  [ "$(printf '%s' "$body" | tr -d ' ')" = '{"ok":true}' ] || fail "healthz 返回不是 {\"ok\":true}:$body"
}

# ---- 规则 15 的出口断言 ----

# scan_file <文件> <额外值>...:返回 0 干净;1 出现了密钥值;2 文件不存在。只判退出码,绝不打印匹配内容。
# 检查的值:.env 里的三个密钥、管理员密码,以及调用者给的额外值。
scan_file() {
  local f="$1" name val
  shift
  [ -f "$f" ] || return 2
  for name in WS_JWT_SECRET WS_MASTER_KEY POSTGRES_PASSWORD; do
    val="$(env_value "$name")"
    [ -n "$val" ] || { echo "测试自身问题:.env 里读不到 $name" >&2; return 3; }
    if grep -qF -- "$val" "$f"; then return 1; fi
  done
  if grep -qF -- "$ADMIN_PW" "$f"; then return 1; fi
  for val in "$@"; do
    if [ -n "$val" ] && grep -qF -- "$val" "$f"; then return 1; fi
  done
  return 0
}

# 用法:assert_no_secrets <说明> <文件>...;文件不存在、或出现任何密钥值都算失败
assert_no_secrets() {
  local what="$1" f rc
  shift
  [ "$#" -gt 0 ] || fail "测试自身问题:$what 没有给出要扫描的文件"
  for f in "$@"; do
    rc=0
    scan_file "$f" || rc=$?
    case "$rc" in
      0) ;;
      2) fail "$what:要扫描的文件不存在($f),不能当作干净" ;;
      1) fail "$what 里出现了密钥值或管理员密码" ;;
      *) fail "$what:扫描出错" ;;
    esac
  done
}

# 正向自检:扫描器必须能抓到已知密钥,并对缺失文件报失败(否则"干净"毫无意义)
selftest_scanner() {
  local f="$TMP/scanner-selftest.txt" name rc
  for name in WS_JWT_SECRET WS_MASTER_KEY POSTGRES_PASSWORD; do
    printf 'prefix %s suffix\n' "$(env_value "$name")" >"$f"
    rc=0; scan_file "$f" || rc=$?
    [ "$rc" -eq 1 ] || fail "扫描器自检失败:没有抓到 $name 的值"
  done
  printf 'x %s y\n' "$ADMIN_PW" >"$f"
  rc=0; scan_file "$f" || rc=$?
  [ "$rc" -eq 1 ] || fail "扫描器自检失败:没有抓到管理员密码"
  printf 'nothing here\n' >"$f"
  rc=0; scan_file "$f" || rc=$?
  [ "$rc" -eq 0 ] || fail "扫描器自检失败:干净文件被判为泄露"
  rc=0; scan_file "$TMP/does-not-exist" || rc=$?
  [ "$rc" -eq 2 ] || fail "扫描器自检失败:缺失文件没有报失败"
  rm -f "$f"
  pass "扫描器自检:能抓到四个值,缺失文件会报失败"
}

# 把各服务日志落到 $1;docker 报错或输出为空都算失败(不能把"没取到日志"当作"日志干净")
dump_logs() {
  dc logs --no-color >"$1" 2>"$1.err" || fail "docker compose logs 失败"
  [ ! -s "$1.err" ] || fail "docker compose logs 有报错输出"
  [ -s "$1" ] || fail "容器日志为空,无法证明没有泄露"
  rm -f "$1.err"
}

# 扫描整个 data/logs(所有文件),并要求其中至少有一个文件(缺目录/空目录不能当作干净)
assert_logs_dir_clean() {
  local f n=0
  for f in "$DEPLOY"/data/logs/*; do
    [ -f "$f" ] || continue
    n=$((n + 1))
    assert_no_secrets "日志目录文件 $(basename "$f")" "$f"
  done
  [ "$n" -gt 0 ] || fail "data/logs 里没有任何文件,无法证明日志干净"
}

# 安装 / 升级期间在后台采样进程参数(ps -axo args,macOS 与 Linux 通用),事后扫描
start_ps_sampler() {
  rm -f "$PS_STOP"
  ( while [ ! -e "$PS_STOP" ]; do ps -ax -ww -o args= 2>/dev/null; sleep 0.3; done ) \
    | awk '!seen[$0]++' >"$PS_LOG" &
  PS_PID=$!
}
assert_ps_clean() {
  touch "$PS_STOP"
  wait "$PS_PID" 2>/dev/null || true
  [ -s "$PS_LOG" ] || fail "进程参数采样为空,采样器没有工作"
  assert_no_secrets "进程参数采样(ps)" "$PS_LOG"
  pass "安装/升级期间采样的进程参数里没有密钥与管理员密码"
}

# 部署目录卫生:只有一个 .env(外加 .env.example)、没有 *.new.* 残留、没有残留的 compose run 容器
assert_deploy_hygiene() {
  local extra leftover
  extra="$(find "$DEPLOY" -maxdepth 1 -name '.env*' ! -name .env ! -name .env.example)"
  [ -z "$extra" ] || fail "部署目录里有 .env 残留文件:$extra"
  [ -f "$DEPLOY/.env" ] || fail "部署目录里没有 .env"
  leftover="$(find "$DEPLOY" -path "$DEPLOY/data" -prune -o -name '*.new.*' -print)"
  [ -z "$leftover" ] || fail "部署目录里有 *.new.* 残留:$leftover"
  leftover="$(find "$DEPLOY" -maxdepth 1 -name '.ws-upgrade.*')"
  [ -z "$leftover" ] || fail "部署目录里有升级临时目录残留:$leftover"
  leftover="$(docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.oneoff=True")"
  [ -z "$leftover" ] || fail "残留了 compose run 一次性容器"
  pass "部署目录无 .env.XXXXXX / *.new.* / 升级临时目录残留,无 compose run 残留容器"
}

# 静态检查:被测脚本不得开启 xtrace(set -x / bash -x 等)
assert_no_xtrace() {
  local f hits=""
  for f in "$ROOT"/deploy/prod/scripts/*.sh; do
    if grep -nE '(^|[;&|[:space:]])(set[[:space:]]+-[a-zA-Z]*x|(ba)?sh[[:space:]]+-[a-zA-Z]*x)' "$f" | grep -v '^[0-9]*:[[:space:]]*#' >/dev/null; then
      hits="$hits $f"
    fi
  done
  [ -z "$hits" ] || fail "这些脚本里出现了 xtrace:$hits"
  pass "scripts/*.sh 里没有 set -x / bash -x"
}

# 造一个镜像标签别名($1=新版本号),测试结束自动删除;$2=distinct 时基于原镜像加一层,使镜像 ID 不同
make_alias_tags() {
  local nv="$1" img
  for img in workstation-app workstation-web; do
    if [ "${2:-}" = "distinct" ]; then
      printf 'FROM %s:%s\nLABEL ws.test.alias=%s\n' "$img" "$VERSION" "$nv" \
        | docker build -q -t "$img:$nv" - >/dev/null || fail "造镜像标签 $img:$nv 失败"
    else
      docker tag "$img:$VERSION" "$img:$nv" || fail "造镜像标签 $img:$nv 失败"
    fi
    ALIAS_TAGS="$ALIAS_TAGS $img:$nv"
  done
}

# 部署目录整树哈希(排除 data/ 与 backups/),用于证明"没动任何文件"
tree_hash() {
  ( cd "$DEPLOY" && find . \( -path ./data -o -path ./backups \) -prune -o -type f -print \
      | LC_ALL=C sort | while IFS= read -r f; do printf '%s  %s\n' "$(sha256_of "$f")" "$f"; done ) \
    | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; } | awk '{print $1}'
}
