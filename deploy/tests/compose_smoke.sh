#!/usr/bin/env bash
# 生产镜像与 compose 冒烟测试:构建镜像 → 起整套服务 → 逐项断言 → 清理。
# 可用环境变量:
#   WS_VERSION                 镜像标签(默认 0.0.0-seg-b)
#   WS_SMOKE_PROJECT           compose 项目名(默认 ws-m5a-b)
#   WS_HTTP_PORT/WS_HTTPS_PORT 宿主机端口(默认 18080 / 18443)
#   WS_SMOKE_SKIP_BUILD=1      不重新构建镜像,直接用已有标签
#   WS_SMOKE_SKIP_LOGFILE=1    跳过 app.jsonl 落盘断言(依赖日志落盘功能)
#   WS_SMOKE_COMPOSE_OVERRIDE  额外的 compose 文件(-f),仅本地验证占位用
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
VERSION="${WS_VERSION:-0.0.0-seg-b}"
PROJECT="${WS_SMOKE_PROJECT:-ws-m5a-b}"
HTTP_PORT="${WS_HTTP_PORT:-18080}"
HTTPS_PORT="${WS_HTTPS_PORT:-18443}"
OVERRIDE="${WS_SMOKE_COMPOSE_OVERRIDE:-}"

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ws-smoke.XXXXXX")"
FAILED=0

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
  make -C "$ROOT" image VERSION="$VERSION" >/dev/null 2>&1 || {
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
docker run --rm --entrypoint sh "workstation-app:$VERSION" -c \
  'test -f /srv/server/alembic.ini && test -d /srv/server/migrations/versions' \
  || fail "应用镜像缺少 alembic.ini 或 migrations"
pass "应用镜像带有 alembic.ini 与 migrations"

echo "== 3/6 准备部署目录与随机密钥(只写入临时目录,不打印)"
cp "$ROOT/deploy/prod/docker-compose.yml" "$TMP/docker-compose.yml"
cp "$ROOT/deploy/prod/Caddyfile.internal" "$TMP/Caddyfile"
mkdir -p "$TMP/certs" "$TMP/data/pg" "$TMP/data/redis" "$TMP/data/caddy" "$TMP/data/logs"
# data/logs:容器内 uid 10001 要写 app.jsonl,宿主机用户要写 backup-last.json,
# 冒烟里直接放开为 777(正式安装由 install.sh 处理)
chmod 777 "$TMP/data/logs"
PG_PASS="$(openssl rand -hex 16)"
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
umask 022
unset PG_PASS
# .env.example 里的密钥必须留空
for key in WS_JWT_SECRET WS_MASTER_KEY POSTGRES_PASSWORD; do
  grep -qx "$key=" "$ROOT/deploy/prod/.env.example" || fail ".env.example 中 $key 必须存在且留空"
done
pass "部署目录就绪,.env.example 密钥留空"

echo "== 4/6 启动服务并等待健康"
compose up -d --wait --wait-timeout 300 >/dev/null 2>&1 || fail "服务未能在 300 秒内全部健康"
pass "所有服务已启动且健康"

echo "== 5/6 逐项断言"
base="https://localhost:$HTTPS_PORT"
health="$(curl -ksS --max-time 10 "$base/api/v1/healthz")" || fail "healthz 请求失败"
[ "$(printf '%s' "$health" | tr -d ' ')" = '{"ok":true}' ] || fail "healthz 返回不是 {\"ok\":true}:$health"
pass "/api/v1/healthz 返回 {\"ok\":true}"
curl -ksS --max-time 10 "$base/" | grep -q '<div id="root">' || fail "/ 未返回含 <div id=\"root\"> 的页面"
pass "/ 返回前端首页"
curl -ksS --max-time 10 "$base/teacher" | grep -q '<div id="root">' || fail "/teacher 刷新未回落到 index"
pass "/teacher 刷新回落到 index"
curl -ksS --max-time 10 -o /dev/null -D - "$base/" | grep -qi '^strict-transport-security:' || fail "缺少 Strict-Transport-Security 响应头"
pass "安全响应头存在"
uid="$(compose exec -T app id -u | tr -d '\r\n')"
[ "$uid" = "10001" ] || fail "app 容器 uid 应为 10001,实际为 $uid"
pass "app 容器以 uid 10001 运行"
for pair in postgres:5432 redis:6379 app:8080; do
  # 未发布端口时 compose port 输出空或 ":0"
  if [ -n "$(compose port "${pair%%:*}" "${pair##*:}" 2>/dev/null | grep -v ':0$' || true)" ]; then
    fail "${pair%%:*} 的端口 ${pair##*:} 不应对宿主机发布"
  fi
done
pass "postgres / redis / app 未对宿主机发布端口"

echo "== 6/6 日志落盘"
if [ "${WS_SMOKE_SKIP_LOGFILE:-0}" = "1" ]; then
  echo "  跳过:WS_SMOKE_SKIP_LOGFILE=1"
else
  ok=0
  for _ in $(seq 1 30); do
    if [ -s "$TMP/data/logs/app.jsonl" ]; then ok=1; break; fi
    sleep 1
  done
  [ "$ok" = 1 ] || fail "data/logs/app.jsonl 未出现"
  pass "data/logs/app.jsonl 已落盘"
fi

echo "冒烟测试全部通过"
