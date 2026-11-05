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
fail() {
  echo "  失败:$1" >&2
  # 失败时只打印各服务最后几行日志(日志里不应含密钥,本身也是被测对象)
  if [ -f "$DEPLOY/docker-compose.yml" ] && [ -f "$DEPLOY/.env" ]; then
    dc logs --tail 20 2>&1 | sed 's/^/    | /' >&2 || true
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

# 非交互安装,输出(含 stderr)写到 $1;返回安装脚本的退出码
run_install() {
  local log="$1" rc
  [ -x "$DEPLOY/scripts/install.sh" ] || { echo "scripts/install.sh 不存在或不可执行" >"$log"; return 127; }
  if (
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

# 规则 15 的出口断言:密钥值不得出现在给定文件里(只判退出码,绝不打印匹配内容)。
# 用法:assert_no_secrets <说明> <文件>...
assert_no_secrets() {
  local what="$1" f name val
  shift
  for f in "$@"; do
    [ -f "$f" ] || continue
    for name in WS_JWT_SECRET WS_MASTER_KEY POSTGRES_PASSWORD; do
      val="$(env_value "$name")"
      [ -n "$val" ] || fail "测试自身问题:.env 里读不到 $name"
      if grep -qF -- "$val" "$f"; then fail "$what 里出现了 $name 的值"; fi
    done
    if grep -qF -- "$ADMIN_PW" "$f"; then fail "$what 里出现了管理员密码"; fi
  done
}

# 把各服务日志落到 $1,供 assert_no_secrets 扫描
dump_logs() { dc logs --no-color >"$1" 2>&1 || true; }
