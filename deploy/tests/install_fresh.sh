#!/usr/bin/env bash
# 全新安装:非交互装一遍,断言 .env、目录、登录、证书、定时备份提示,以及密钥不外泄(规则 15)。
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "== 1/5 准备部署目录并安装(管理员密码经 WS_INSTALL_ADMIN_PASSWORD_FILE 传入;指定非默认子网 WS_SUBNET)"
prepare_deploy_dir
start_ps_sampler
INSTALL_PW_MODE="file"
# L186:用环境变量指定 compose 子网,安装后网络、.env 的 WS_SUBNET 与 WS_TRUSTED_PROXIES 都应是它(其他测试用默认的 172.30.0.0/24)
TEST_SUBNET="10.250.0.0/24"
export WS_SUBNET="$TEST_SUBNET"
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
for k in WS_JWT_SECRET WS_MASTER_KEY POSTGRES_PASSWORD; do
  [ -n "$(env_value "$k")" ] || fail ".env 里的 $k 为空"
done
case "$(env_value WS_DATABASE_URL)" in
  *workstation:@*) fail "WS_DATABASE_URL 里的数据库密码为空" ;;
esac
jwt="$(env_value WS_JWT_SECRET)"
[ "${#jwt}" -ge 48 ] || fail "WS_JWT_SECRET 长度应 >= 48,实际 ${#jwt}"
mk_bytes="$(printf '%s' "$(env_value WS_MASTER_KEY)" | openssl base64 -d -A | wc -c | tr -d ' ')"
[ "$mk_bytes" = "32" ] || fail "WS_MASTER_KEY 解码后应为 32 字节,实际 $mk_bytes"
pgpw="$(env_value POSTGRES_PASSWORD)"
[ "${#pgpw}" -ge 24 ] || fail "POSTGRES_PASSWORD 太短(${#pgpw})"
grep -qF ":${pgpw}@postgres:5432/" "$DEPLOY/.env" || fail "WS_DATABASE_URL 里没有填入数据库密码"
sid="$(env_value WS_SCHOOL_ID)"
grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' <<<"$sid" || fail "WS_SCHOOL_ID 不是小写 uuid"
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
# L186:子网落到 .env 两个键与真实网络上,且安装输出说明了用的是指定值
[ "$(env_value WS_SUBNET)" = "$TEST_SUBNET" ] || fail ".env 的 WS_SUBNET 应为 $TEST_SUBNET,实际 $(env_value WS_SUBNET)"
[ "$(env_value WS_TRUSTED_PROXIES)" = "$TEST_SUBNET" ] || fail ".env 的 WS_TRUSTED_PROXIES 应等于子网 $TEST_SUBNET,实际 $(env_value WS_TRUSTED_PROXIES)"
subnets="$(docker network inspect "${PROJECT}_ws-net" -f '{{range .IPAM.Config}}{{.Subnet}} {{end}}')"
case "$subnets" in *"$TEST_SUBNET"*) ;; *) fail "compose 网络子网应为 $TEST_SUBNET,实际:$subnets" ;; esac
grep -q "WS_SUBNET.*$TEST_SUBNET" "$LOG" || fail "安装输出里没有说明子网来自 WS_SUBNET=$TEST_SUBNET"
pass "WS_SUBNET=$TEST_SUBNET 生效:.env 两键一致、docker 网络子网一致"
# L314:子网重叠检测(lib.sh::host_routes)要看全部路由表(多网卡 + 策略路由的校园网),不只主表。
# 用一个假的 ip 命令证明:只在 `table all` 里出现的网段也会被列出,重复的只列一次,local / broadcast / default 行跳过。
# 网段全部用文档保留段(192.0.2.0/24、10.77.0.0/16 只是虚构值)
mkdir -p "$TMP/fakebin"
cat >"$TMP/fakebin/ip" <<'SH'
#!/usr/bin/env bash
case "$*" in
  *"table all"*)
    printf '%s\n' 'default via 192.0.2.1 dev eth0' '192.0.2.0/24 dev eth0 proto kernel scope link src 192.0.2.10' \
      '10.77.0.0/16 via 192.0.2.1 dev eth0 table 100' '10.77.0.0/16 via 192.0.2.1 dev eth0 table 200' \
      'local 192.0.2.10 dev eth0 table local proto kernel scope host src 192.0.2.10' 'broadcast 192.0.2.255 dev eth0 table local'
    ;;
  *) printf '%s\n' 'default via 192.0.2.1 dev eth0' '192.0.2.0/24 dev eth0 proto kernel scope link src 192.0.2.10' ;;
esac
SH
chmod +x "$TMP/fakebin/ip"
routes="$( PATH="$TMP/fakebin:$PATH" bash -c '. "$1/scripts/lib.sh"; host_routes' _ "$DEPLOY" )" || fail "host_routes 执行失败"
[ "$(grep -cx '10.77.0.0/16' <<<"$routes" || true)" = "1" ] || fail "host_routes 应列出只在其他路由表里的 10.77.0.0/16,且只列一次(去重),实际:$routes"
grep -qx '192.0.2.0/24' <<<"$routes" || fail "host_routes 应列出主表里的 192.0.2.0/24,实际:$routes"
! grep -Eq '^(local|broadcast|default)' <<<"$routes" || fail "host_routes 不应把 local / broadcast / default 行当成网段,实际:$routes"
rm -rf "$TMP/fakebin"
pass "host_routes 看全部路由表:策略路由表里的网段也列出且去重,local / broadcast / default 行被跳过(L314)"

echo "== 3/5 服务与登录"
assert_healthz
pass "healthz 正常"
assert_login_ok
pass "管理员登录成功且 must_change_password 为 true"
assert_services_up
[ "$(user_count)" = "1" ] || fail "users 应只有 1 行(管理员)"
pass "users 只有管理员一行"
ok=0
for _ in $(seq 1 30); do
  if [ -s "$DEPLOY/data/logs/app.jsonl" ]; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || fail "data/logs/app.jsonl 没有出现或为空(应用启动应写入 app.started)"
grep -q '"app.started"' "$DEPLOY/data/logs/app.jsonl" || fail "app.jsonl 里没有 app.started 启动日志"
pass "data/logs/app.jsonl 非空且含启动日志 app.started(容器 uid 10001 可写)"
ok=0
for _ in $(seq 1 30); do
  if [ -f "$DEPLOY/data/logs/scheduler.jsonl" ]; then ok=1; break; fi
  sleep 1
done
[ "$ok" = 1 ] || fail "data/logs/scheduler.jsonl 未出现(scheduler 应单独落盘)"
pass "data/logs/scheduler.jsonl 已创建"
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
grep -q 'logger -t workstation-backup' "$LOG" || fail "crontab 提示应把日志交给 logger(L201),而不是无限追加到文件"
grep -q 'CRON_TZ=Asia/Shanghai' "$LOG" || fail "crontab 提示里没有 CRON_TZ(L184)"
grep -q '以后的备份、恢复、升级、回退请都用' "$LOG" || fail "安装结尾没有「以后所有脚本用同一用户」的提示(L183)"
pass "输出了手动 crontab 提示(logger + CRON_TZ)与同一用户提示"
# L184:systemd 定时器模板带时区占位,渲染后 OnCalendar 含学校时区;测试非 root,只验渲染函数(真机 systemd 行为见台账 L125)
grep -q '^OnCalendar=\*-\*-\* 02:30:00 @TZ@$' "$DEPLOY/systemd/workstation-backup.timer" || fail "timer 模板里应有 OnCalendar=*-*-* 02:30:00 @TZ@"
# shellcheck source=/dev/null
rendered="$( . "$DEPLOY/scripts/lib.sh"; render_systemd_unit "$DEPLOY/systemd/workstation-backup.timer" "$DEPLOY" "$(backup_timezone)" )"
grep -q '^OnCalendar=\*-\*-\* 02:30:00 Asia/Shanghai$' <<<"$rendered" || fail "渲染后的 timer 应含 OnCalendar=*-*-* 02:30:00 Asia/Shanghai,实际:$(grep OnCalendar <<<"$rendered")"
grep -q '@TZ@' <<<"$rendered" && fail "渲染后的 timer 不应残留 @TZ@"
# shellcheck source=/dev/null
rendered="$( . "$DEPLOY/scripts/lib.sh"; render_systemd_unit "$DEPLOY/systemd/workstation-backup.service" "$DEPLOY" "Asia/Shanghai" )"
grep -q "^WorkingDirectory=$DEPLOY$" <<<"$rendered" || fail "渲染后的 service 应含 WorkingDirectory=$DEPLOY"
grep -q '@DEPLOY_DIR@' <<<"$rendered" && fail "渲染后的 service 不应残留 @DEPLOY_DIR@"
pass "systemd 定时器渲染:OnCalendar 带时区 Asia/Shanghai,WorkingDirectory 为部署目录"
# L187:每个容器的 stdout 日志都有大小上限
for svc in postgres redis app scheduler stream-worker web; do
  lc="$(docker inspect -f '{{.HostConfig.LogConfig.Type}} {{index .HostConfig.LogConfig.Config "max-size"}} {{index .HostConfig.LogConfig.Config "max-file"}}' "$(dc ps -q "$svc")")"
  [ "$lc" = "json-file 10m 5" ] || fail "$svc 的日志配置应为 json-file max-size=10m max-file=5,实际:$lc"
done
pass "六个容器的 stdout 日志都限制为 10m × 5"
# L157:/api/* 的请求体超过 4 MB 在 Caddy 就被 413 拒绝(不到应用);正常大小的请求不受影响(上面登录已证明)
head -c 5242880 /dev/zero >"$TMP/big.bin"
code="$(curl -ksS --max-time 30 -o /dev/null -w '%{http_code}' -X POST "https://localhost:$HTTPS_PORT/api/v1/auth/login" \
  -H 'Content-Type: application/json' --data-binary @"$TMP/big.bin")" || fail "发送 5 MB 请求失败"
rm -f "$TMP/big.bin"
[ "$code" = "413" ] || fail "5 MB 请求体应被 Caddy 以 413 拒绝,实际 $code"
pass "5 MB 请求体被 Caddy 以 413 拒绝"

echo "== 5/5 密钥出口扫描(规则 15)"
selftest_scanner
dump_logs "$TMP/compose.log"
assert_no_secrets "安装输出" "$LOG"
assert_no_secrets "容器日志" "$TMP/compose.log"
assert_logs_dir_clean
pass "安装输出、容器日志、data/logs 全部文件里都没有管理员密码与三个密钥"
assert_ps_clean
assert_deploy_hygiene
assert_no_xtrace
assert_static_safe

echo "install_fresh 全部通过"
