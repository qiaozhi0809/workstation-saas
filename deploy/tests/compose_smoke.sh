#!/usr/bin/env bash
# 生产镜像与 compose 冒烟测试:构建镜像 → 起整套服务 → 逐项断言 → 清理。
# 可用环境变量(与 _common.sh 一致):
#   WS_TEST_VERSION            镜像标签(默认取 WS_VERSION,再默认 0.0.0-seg-b)
#   WS_TEST_PROJECT            compose 项目名(默认 ws-m5a-b);旧名 WS_SMOKE_PROJECT 仍作为回退
#   WS_TEST_DEPLOY_SRC         被测的部署目录来源(默认 $ROOT/deploy/prod;compose 文件、Caddyfile.internal、.env.example 取自这里)
#   WS_HTTP_PORT/WS_HTTPS_PORT 宿主机端口(默认 18080 / 18443)
#   WS_SMOKE_SKIP_BUILD=1      不重新构建镜像,直接用已有标签
#   WS_SMOKE_COMPOSE_OVERRIDE  额外的 compose 文件(-f),仅本地验证占位用
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  echo "请不要用 root 运行冒烟测试(会改变 data/ 目录属主,与正式安装不一致)" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${WS_TEST_VERSION:-${WS_VERSION:-0.0.0-seg-b}}"
PROJECT="${WS_TEST_PROJECT:-${WS_SMOKE_PROJECT:-ws-m5a-b}}"
DEPLOY_SRC="${WS_TEST_DEPLOY_SRC:-$ROOT/deploy/prod}"
HTTP_PORT="${WS_HTTP_PORT:-18080}"
HTTPS_PORT="${WS_HTTPS_PORT:-18443}"
OVERRIDE="${WS_SMOKE_COMPOSE_OVERRIDE:-}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ws-smoke.XXXXXX")"
FAILED=0
CANARIES=()
CANARY_DIRS=()

compose() {
  local args=(-p "$PROJECT" --project-directory "$TMP" -f "$TMP/docker-compose.yml")
  if [ -n "$OVERRIDE" ]; then
    args+=(-f "$OVERRIDE")
  fi
  docker compose "${args[@]}" "$@"
}

cleanup() {
  local code=$?
  echo "== 清理:停止并删除容器、卷和临时目录"
  compose down -v --remove-orphans >/dev/null 2>&1 || true
  # data/pg 属于容器内 uid 70(权限 700),宿主机用户删不掉,借 web 镜像里的 root 来删
  if [ -d "$TMP/data" ] && docker image inspect "workstation-web:$VERSION" >/dev/null 2>&1; then
    docker run --rm --entrypoint sh -v "$TMP:/t" "workstation-web:$VERSION" -c 'rm -rf /t/data' >/dev/null 2>&1 || true
  fi
  for f in ${CANARIES[@]+"${CANARIES[@]}"}; do rm -f "$f"; done
  for d in ${CANARY_DIRS[@]+"${CANARY_DIRS[@]}"}; do rmdir "$d" 2>/dev/null || true; done
  rm -rf "$TMP" 2>/dev/null || true
  if [ "$code" -ne 0 ] && [ "$FAILED" -eq 0 ]; then
    echo "冒烟测试异常退出(退出码 $code)" >&2
  fi
  exit "$code"
}
trap cleanup EXIT

pass() { echo "  通过:$1"; }
fail() {
  echo "  失败:$1" >&2
  FAILED=1
  # 失败时只打印各服务最后几行日志,便于定位(日志里不含密钥)
  compose logs --tail 30 2>&1 | sed 's/^/    | /' >&2 || true
  exit 1
}

echo "== 1/6 构建镜像(标签 $VERSION)"
if [ "${WS_SMOKE_SKIP_BUILD:-0}" != "1" ]; then
  # 构建输出写到临时文件,失败时只打印末尾(构建日志不含密钥)
  make -C "$ROOT" image VERSION="$VERSION" >"$TMP/build.log" 2>&1 || {
    tail -n 40 "$TMP/build.log" >&2
    echo "镜像构建失败,请单独运行:make image VERSION=$VERSION" >&2
    exit 1
  }
fi
pass "镜像已就绪"

echo "== 2/6 检查镜像内容"
for img in "workstation-app:$VERSION" "workstation-web:$VERSION"; do
  found="$(docker run --rm --entrypoint sh "$img" -c \
    'find / -xdev \( -name node_modules -o -name .venv \) -prune -print 2>/dev/null' || true)"
  if [ -n "$found" ]; then
    fail "$img 里不应有 node_modules / .venv,发现:$found"
  fi
done
pass "两个镜像都没有 node_modules / .venv"
leaked="$(docker run --rm --entrypoint sh "workstation-app:$VERSION" -c \
  'find /srv -name ".env*" -print 2>/dev/null' || true)"
[ -z "$leaked" ] || fail "应用镜像里不应带 .env 文件:$leaked"
pass "应用镜像里没有 .env"
env_found="$(docker run --rm --entrypoint sh "workstation-app:$VERSION" -c \
  "find / -xdev -name '.env*' -print 2>/dev/null" || true)"
[ -z "$env_found" ] || fail "应用镜像全盘不应有 .env* 文件:$env_found"
pass "应用镜像全盘没有 .env*"

# R7:.dockerignore 真的把 node_modules / .venv / .env* 挡在构建上下文之外。
# 做法:在仓库里放 canary 文件,再用一个只 `COPY . /ctx` 的临时 Dockerfile 构建探针镜像,
# 临时 Dockerfile 旁放一份与正式 .dockerignore 内容相同的同名忽略文件(BuildKit 按 Dockerfile 名取忽略文件),
# 然后在探针镜像里断言 canary 不存在。同时断言正常文件存在,避免"上下文本来就是空的"这种假通过。
# 不直接看正式镜像,因为正式镜像只 COPY 部分目录,即使忽略规则失效 canary 也不会进去。
make_canary() {
  local f="$1" d
  d="$(dirname "$f")"
  if [ ! -d "$d" ]; then mkdir -p "$d"; CANARY_DIRS+=("$d"); fi
  : >"$f"
  CANARIES+=("$f")
}
make_canary "$ROOT/apps/web/node_modules/.ws-canary"
make_canary "$ROOT/server/.venv/.ws-canary"
make_canary "$ROOT/server/.env.ws-canary"
make_canary "$ROOT/apps/web/.env.ws-canary"
mkdir -p "$TMP/probe"
probe_ctx() {  # $1=名称 $2=正式 Dockerfile 名 $3=必须存在的正常文件
  cp "$ROOT/deploy/docker/$2.dockerignore" "$TMP/probe/$1.Dockerfile.dockerignore"
  printf 'FROM workstation-web:%s\nCOPY . /ctx\n' "$VERSION" >"$TMP/probe/$1.Dockerfile"
  docker build -q -f "$TMP/probe/$1.Dockerfile" -t "ws-probe-$1:$VERSION" "$ROOT" >"$TMP/probe/$1.log" 2>&1 \
    || { tail -n 20 "$TMP/probe/$1.log" >&2; fail "探针镜像 $1 构建失败"; }
  docker run --rm --entrypoint sh "ws-probe-$1:$VERSION" -c "test -f /ctx/$3" \
    || { docker image rm "ws-probe-$1:$VERSION" >/dev/null 2>&1; fail "探针上下文里缺少 $3(上下文为空则断言无意义)"; }
  local leaked
  leaked="$(docker run --rm --entrypoint sh "ws-probe-$1:$VERSION" -c \
    "find /ctx \\( -name '.ws-canary' -o -name '.env.ws-canary' \\) -print" || true)"
  docker image rm "ws-probe-$1:$VERSION" >/dev/null 2>&1 || true
  [ -z "$leaked" ] || fail "$2 的 .dockerignore 没挡住:$leaked"
}
probe_ctx app app.Dockerfile server/pyproject.toml
probe_ctx web web.Dockerfile apps/web/package.json
pass "两份 .dockerignore 都挡住了 node_modules / .venv / .env* 的 canary"
docker run --rm --entrypoint sh "workstation-app:$VERSION" -c \
  'test -d /srv/server/app && test -d /srv/server/migrations/versions && test -f /srv/server/alembic.ini' \
  || fail "应用镜像缺少 /srv/server/app、migrations 或 alembic.ini"
pass "应用镜像带有 /srv/server/app、migrations 与 alembic.ini"

echo "== 3/6 准备部署目录与随机密钥(只写入临时目录,不打印)"
cp "$DEPLOY_SRC/docker-compose.yml" "$TMP/docker-compose.yml"
cp "$DEPLOY_SRC/Caddyfile.internal" "$TMP/Caddyfile"
mkdir -p "$TMP/certs" "$TMP/data/pg" "$TMP/data/redis" "$TMP/data/caddy" "$TMP/data/logs"
# data/logs:容器内 uid 10001 要写 app.jsonl,宿主机用户要写 backup-last.json。
# 与 install.sh 同一做法:当前用户所有 + 1777(粘滞位),不依赖 chown / setfacl
chmod 1777 "$TMP/data/logs"
PG_PASS="$(openssl rand -hex 16)"
old_umask="$(umask)"
umask 077
{
  echo "WS_VERSION=$VERSION"
  echo "WS_ENV=prod"
  echo "WS_SCHOOL_ID=11111111-1111-1111-1111-111111111111"
  echo "WS_DATABASE_URL=postgresql+psycopg://workstation:${PG_PASS}@postgres:5432/workstation"
  echo "WS_REDIS_URL=redis://redis:6379/0"
  echo "WS_JWT_SECRET=$(openssl rand -hex 32)"
  echo "WS_MASTER_KEY=$(openssl rand -base64 32)"
  echo "WS_TRUSTED_PROXIES=172.30.0.0/24"
  echo "WS_SITE_ADDRESS=localhost"
  echo "WS_TLS_MODE=internal"
  echo "WS_ACME_EMAIL="
  echo "POSTGRES_PASSWORD=$PG_PASS"
  echo "WS_HTTP_PORT=$HTTP_PORT"
  echo "WS_HTTPS_PORT=$HTTPS_PORT"
} >"$TMP/.env"
umask "$old_umask"
unset PG_PASS
# .env.example 里的密钥必须留空
for key in WS_JWT_SECRET WS_MASTER_KEY POSTGRES_PASSWORD; do
  grep -qx "$key=" "$DEPLOY_SRC/.env.example" || fail ".env.example 中 $key 必须存在且留空"
done
pass "部署目录就绪,.env.example 密钥留空"

echo "== 4/6 启动服务并等待健康"
# up 输出写到临时文件,失败时 fail 会打印各服务日志尾部(输出里不含密钥)
compose up -d --wait --wait-timeout 300 >"$TMP/up.log" 2>&1 || {
  tail -n 30 "$TMP/up.log" >&2
  fail "服务未能在 300 秒内全部健康"
}
pass "所有服务已启动且健康"

echo "== 5/6 逐项断言"
base="https://localhost:$HTTPS_PORT"
health="$(curl -ksS --max-time 10 "$base/api/v1/healthz")" || fail "healthz 请求失败"
[ "$(printf '%s' "$health" | tr -d ' ')" = '{"ok":true}' ] || fail "healthz 返回不是 {\"ok\":true}:$health"
pass "/api/v1/healthz 返回 {\"ok\":true}"
root_page="$(curl -ksS --max-time 10 "$base/")" || fail "/ 请求失败"
grep -q '<div id="root">' <<<"$root_page" || fail "/ 未返回含 <div id=\"root\"> 的页面"
pass "/ 返回前端首页"
teacher_page="$(curl -ksS --max-time 10 "$base/teacher")" || fail "/teacher 请求失败"
grep -q '<div id="root">' <<<"$teacher_page" || fail "/teacher 刷新未回落到 index"
pass "/teacher 刷新回落到 index"
headers="$(curl -ksS --max-time 10 -o /dev/null -D - "$base/")"
for h in strict-transport-security x-content-type-options referrer-policy; do
  grep -qi "^$h:" <<<"$headers" || fail "缺少 $h 响应头"
done
pass "三条安全响应头(HSTS / nosniff / Referrer-Policy)都存在"
code="$(curl -ksS --max-time 10 -o "$TMP/404.body" -w '%{http_code}' "$base/api/v1/no-such-route")"
[ "$code" = "404" ] || fail "/api/v1/no-such-route 应返回 404,实际 $code"
if grep -q '<div id="root">' "$TMP/404.body"; then
  fail "/api/* 的未知路径不应回落到前端首页"
fi
pass "/api/v1/no-such-route 返回 404 且不是前端首页"
uid="$(compose exec -T app id -u | tr -d '\r\n')"
[ "$uid" = "10001" ] || fail "app 容器 uid 应为 10001,实际为 $uid"
pass "app 容器以 uid 10001 运行"
for svc in postgres redis app; do
  ports="$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$(compose ps -q "$svc")")"
  if grep -q 'HostPort' <<<"$ports"; then
    fail "$svc 不应对宿主机发布端口,实际:$ports"
  fi
done
pass "postgres / redis / app 没有 HostPort"
web_ports="$(docker inspect -f '{{json .NetworkSettings.Ports}}' "$(compose ps -q web)")"
grep -q "\"80/tcp\":\[{[^]]*\"HostPort\":\"$HTTP_PORT\"" <<<"$web_ports" || fail "web 缺少 80 的 HostPort:$web_ports"
grep -q "\"443/tcp\":\[{[^]]*\"HostPort\":\"$HTTPS_PORT\"" <<<"$web_ports" || fail "web 缺少 443 的 HostPort:$web_ports"
pass "web 发布了 80 / 443"
# 只判退出码,不打印环境变量的值
if compose exec -T web sh -c 'env | grep -Eq "^(WS_JWT_SECRET|WS_MASTER_KEY|POSTGRES_PASSWORD|WS_DATABASE_URL)="'; then
  fail "web 容器环境里不应出现应用密钥或数据库连接串"
fi
pass "web 容器环境里没有密钥"
subnets="$(docker network inspect "${PROJECT}_ws-net" -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}')"
case "$subnets" in *172.30.0.0/24*) ;; *) fail "网络子网应为 172.30.0.0/24,实际:$subnets" ;; esac
pass "网络子网为 172.30.0.0/24"
sched_state="$(docker inspect -f '{{.State.Running}} {{.RestartCount}}' "$(compose ps -q scheduler)")"
[ "$sched_state" = "true 0" ] || fail "scheduler 应在运行且重启次数为 0,实际:$sched_state"
pass "scheduler 在运行且未重启"
hc_start="$(docker inspect -f '{{.Config.Healthcheck.StartPeriod}}' "$(compose ps -q app)")"
[ "$hc_start" = "5m0s" ] || fail "app 的健康检查启动宽限期应为 5m0s(300s,compose 覆盖),实际:$hc_start"
pass "app 健康检查启动宽限期为 300s(只覆盖 start_period,其余沿用镜像)"
web_health="$(docker inspect -f '{{.State.Health.Status}}' "$(compose ps -q web)")"
[ "$web_health" = "healthy" ] || fail "web 应为 healthy,实际:$web_health"
pass "web 为 healthy"
perm="$(ls -l "$TMP/.env" | cut -c1-10)"
[ "$perm" = "-rw-------" ] || fail ".env 权限应为 600,实际:$perm"
pass ".env 权限为 600"

echo "== 6/6 日志落盘"
ok=0
for _ in $(seq 1 30); do
  if [ -s "$TMP/data/logs/app.jsonl" ]; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || fail "data/logs/app.jsonl 未出现"
pass "data/logs/app.jsonl 已落盘"

echo "冒烟测试全部通过"
