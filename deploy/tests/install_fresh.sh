#!/usr/bin/env bash
# 全新安装:非交互装一遍,断言 .env、目录、登录、证书、定时备份提示,以及密钥不外泄(规则 15)。
set -euo pipefail
# shellcheck source=deploy/tests/_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "== 1/5 准备部署目录并安装"
prepare_deploy_dir
LOG="$TMP/install.log"
rc=0
run_install "$LOG" || rc=$?
if [ "$rc" -ne 0 ]; then
  tail -n 20 "$LOG" >&2
  fail "install.sh 退出码 $rc(期望 0)"
fi
pass "install.sh 退出码 0"

echo "== 2/5 .env 与目录"
perm="$(ls -l "$DEPLOY/.env" | cut -c1-10)"
[ "$perm" = "-rw-------" ] || fail ".env 权限应为 600,实际:$perm"
pass ".env 权限为 600"
if grep -q 'CHANGE_ME' "$DEPLOY/.env"; then fail ".env 里不应含 CHANGE_ME"; fi
jwt="$(env_value WS_JWT_SECRET)"
[ "${#jwt}" -ge 48 ] || fail "WS_JWT_SECRET 长度应 >= 48,实际 ${#jwt}"
mk_bytes="$(printf '%s' "$(env_value WS_MASTER_KEY)" | openssl base64 -d -A | wc -c | tr -d ' ')"
[ "$mk_bytes" = "32" ] || fail "WS_MASTER_KEY 解码后应为 32 字节,实际 $mk_bytes"
pgpw="$(env_value POSTGRES_PASSWORD)"
[ "${#pgpw}" -ge 24 ] || fail "POSTGRES_PASSWORD 太短(${#pgpw})"
grep -qF ":${pgpw}@postgres:5432/" "$DEPLOY/.env" || fail "WS_DATABASE_URL 里没有填入数据库密码"
sid="$(env_value WS_SCHOOL_ID)"
printf '%s' "$sid" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || fail "WS_SCHOOL_ID 不是小写 uuid"
[ "$sid" != "11111111-1111-1111-1111-111111111111" ] || fail "WS_SCHOOL_ID 不应是种子学校 ID"
[ "$(env_value WS_HTTPS_PORT)" = "$HTTPS_PORT" ] || fail ".env 里的 WS_HTTPS_PORT 不对"
[ "$(env_value WS_VERSION)" = "$VERSION" ] || fail ".env 里的 WS_VERSION 不对"
if grep -qF -- "$ADMIN_PW" "$DEPLOY/.env"; then fail "管理员密码不应出现在 .env 里"; fi
unset jwt pgpw sid mk_bytes
pass "密钥长度、数据库连接串、学校 ID、端口、版本都对,管理员密码不在 .env"
for d in data/pg data/redis data/caddy data/logs backups certs; do
  [ -d "$DEPLOY/$d" ] || fail "缺少目录 $d"
done
cmp -s "$DEPLOY/Caddyfile" "$DEPLOY/Caddyfile.internal" || fail "Caddyfile 应复制自 Caddyfile.internal"
logs_mode="$(ls -ld "$DEPLOY/data/logs" | cut -c1-10)"
[ "$logs_mode" = "drwxrwxrwt" ] || fail "data/logs 应为 1777(粘滞位),实际:$logs_mode"
pass "目录齐全,Caddyfile 正确,data/logs 为 1777"

echo "== 3/5 服务与登录"
assert_healthz
pass "healthz 正常"
assert_login_ok
pass "管理员登录成功且 must_change_password 为 true"
[ "$(user_count)" = "1" ] || fail "users 应只有 1 行(管理员)"
pass "users 只有管理员一行"
ok=0
for _ in $(seq 1 30); do
  if [ -s "$DEPLOY/data/logs/app.jsonl" ]; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || fail "data/logs/app.jsonl 未出现"
pass "data/logs/app.jsonl 已落盘(容器 uid 10001 可写)"
# 宿主机用户也要能在日志目录里写 backup-last.json
: >"$DEPLOY/data/logs/backup-last.json" || fail "宿主机用户无法在 data/logs 里写文件"
rm -f "$DEPLOY/data/logs/backup-last.json"
pass "宿主机用户可在 data/logs 里写文件"

echo "== 4/5 证书与备份提示"
[ -s "$DEPLOY/certs/ws-root-ca.crt" ] || fail "内部证书模式应导出 certs/ws-root-ca.crt"
openssl x509 -noout -in "$DEPLOY/certs/ws-root-ca.crt" 2>/dev/null || fail "ws-root-ca.crt 不是有效证书"
pass "已导出 Caddy 根证书"
grep -q 'crontab' "$LOG" || fail "输出里没有 crontab 提示(测试以非 root 运行,应打印手动 crontab 行)"
grep -q 'backup.sh' "$LOG" || fail "crontab 提示里没有 backup.sh"
pass "输出了手动 crontab 提示"

echo "== 5/5 密钥出口扫描(规则 15)"
dump_logs "$TMP/compose.log"
assert_no_secrets "安装输出" "$LOG"
assert_no_secrets "容器日志" "$TMP/compose.log"
assert_no_secrets "应用日志文件" "$DEPLOY/data/logs/app.jsonl"
pass "安装输出、容器日志、应用日志里都没有管理员密码与三个密钥"

echo "install_fresh 全部通过"
