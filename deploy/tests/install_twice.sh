#!/usr/bin/env bash
# 装两次(Review Focus 1)+ R9:第二次不能重新生成密钥、不能多建用户/学校/绑定;
# 缺 .env 但有数据目录时拒绝覆盖;有 .env 但学校为空时(交互方式)补做初始化;.env 缺密钥时拒绝;
# 故意配错 WS_MASTER_KEY 时,安装输出里不得出现密钥值。
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

start_ps_sampler

echo "== 0/6 L119:安装进行到启动服务时被 TERM 打断:退出码 143,不留 .env.tmp / 锁 / *.new.*,之后重跑能装好"
prepare_deploy_dir
# 直接后台运行脚本($! 就是脚本进程,TERM 才会送到它的 trap);等 .env 已落地且 app 容器已创建(正在等健康)再发 TERM
WS_INSTALL_SCHOOL_NAME="$SCHOOL_NAME" WS_INSTALL_ADMIN_LOGIN="$ADMIN_LOGIN" WS_INSTALL_ADMIN_PASSWORD="$ADMIN_PW" \
WS_INSTALL_SITE=localhost WS_INSTALL_TLS=1 \
  "$DEPLOY/scripts/install.sh" --non-interactive --force >"$TMP/install-term.log" 2>&1 &
ipid=$!
w=0
until [ -f "$DEPLOY/.env" ] && [ -n "$(dc ps -q app 2>/dev/null)" ]; do
  kill -0 "$ipid" 2>/dev/null || break
  w=$((w + 1)); [ "$w" -lt 1200 ] || break
  sleep 0.1
done
kill -TERM "$ipid" 2>/dev/null || true
rc=0; wait "$ipid" || rc=$?
[ "$rc" -eq 143 ] || { tail -n 10 "$TMP/install-term.log" >&2; fail "install.sh 被 TERM 后退出码应为 143,实际 $rc(测试自身问题:TERM 没有赶在安装结束之前?)"; }
[ -f "$DEPLOY/.env" ] || fail "TERM 时 .env 已生成,不应被清理掉(.env 一旦存在就是完整的)"
[ "$(ls -l "$DEPLOY/.env" | cut -c1-10)" = "-rw-------" ] || fail "被打断后 .env 权限应仍为 600"
[ ! -e "$DEPLOY/.env.tmp" ] || fail "被 TERM 打断后残留了 .env.tmp"
[ -z "$(find "$DEPLOY" -maxdepth 1 -name '.env.*' ! -name .env.example)" ] || fail "被 TERM 打断后残留了 .env.XXXXXX 临时文件"
[ ! -e "$DEPLOY/backups/.lock" ] || fail "被 TERM 打断后锁目录没有释放"
[ -z "$(find "$DEPLOY" -path "$DEPLOY/data" -prune -o -name '*.new.*' -print)" ] || fail "被 TERM 打断后残留了 *.new.* 文件"
assert_no_secrets "被 TERM 打断的安装输出" "$TMP/install-term.log"
pass "install.sh 被 TERM 打断:退出码 143,.env 完整(600),无 .env.tmp / 锁 / *.new.* 残留"

echo "== 1/6 第一次安装(密码经环境变量;接着上面被打断的安装,.env 已在,应走「已安装」分支补完)"
rc=0
run_install "$TMP/install1.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install1.log" >&2; fail "第一次安装退出码 $rc"; fi
env_sha="$(sha256_of "$DEPLOY/.env")"
users_before="$(user_count)"
[ "$users_before" = "1" ] || fail "第一次安装后 users 应为 1 行,实际 $users_before"
[ "$(psql_scalar "SELECT count(*) FROM schools")" = "1" ] || fail "第一次安装后 schools 应为 1 行"
admins_before="$(psql_scalar "SELECT count(*) FROM role_bindings WHERE role_type='it_admin'")"
[ "$admins_before" = "1" ] || fail "第一次安装后 it_admin 绑定应为 1 条,实际 $admins_before"
[ "$(psql_scalar "SELECT count(*) FROM academic_years WHERE is_active")" = "1" ] || fail "第一次安装后 进行中的 academic_years 应为 1 行(首个学年,G-1)"
pass "第一次安装完成(users=1、schools=1、it_admin=1、academic_years=1)"

echo "== 2/6 第二次安装"
rc=0
run_install "$TMP/install2.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install2.log" >&2; fail "第二次安装退出码 $rc(期望 0)"; fi
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "第二次安装改动了 .env(密钥被重新生成?)"
[ "$(user_count)" = "$users_before" ] || fail "第二次安装后 users 行数变了"
[ "$(psql_scalar "SELECT count(*) FROM schools")" = "1" ] || fail "第二次安装后 schools 不是 1 行"
[ "$(psql_scalar "SELECT count(*) FROM role_bindings WHERE role_type='it_admin'")" = "$admins_before" ] \
  || fail "第二次安装后 it_admin 绑定数变了"
grep -q '已安装' "$TMP/install2.log" || fail "第二次安装的输出里没有「已安装」"
[ "$(psql_scalar "SELECT count(*) FROM academic_years WHERE is_active")" = "1" ] || fail "第二次安装后 进行中的 academic_years 不是 1 行"
assert_healthz
assert_login_ok
dump_logs "$TMP/compose.log"
assert_no_secrets "第二次安装输出" "$TMP/install2.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
pass ".env 的 sha256、users / schools / it_admin 数量都不变,输出含「已安装」,仍可登录,无密钥泄露"

echo "== 2b WS_INSTALL_ADMIN_PASSWORD 读入后立即从环境清除,docker 子进程不得继承(S-6)"
# 在 PATH 最前面放一个只观察的 docker 包装:发现自己的环境里还有 WS_INSTALL_ADMIN_PASSWORD 就记一笔,然后原样转交真正的 docker
# (不改变任何行为,不是桩)。先做正向对照,证明包装确实能发现变量。
mkdir -p "$TMP/shim"
cat >"$TMP/shim/docker" <<'SH'
#!/bin/sh
if [ -n "${WS_INSTALL_ADMIN_PASSWORD+x}" ]; then echo leaked >>"$WS_SHIM_LOG"; fi
exec "$WS_REAL_DOCKER" "$@"
SH
chmod 755 "$TMP/shim/docker"
REAL_DOCKER="$(command -v docker)"
: >"$TMP/shim.log"
WS_SHIM_LOG="$TMP/shim.log" WS_REAL_DOCKER="$REAL_DOCKER" WS_INSTALL_ADMIN_PASSWORD=control "$TMP/shim/docker" version >/dev/null 2>&1 || true
[ -s "$TMP/shim.log" ] || fail "测试自身问题:docker 观察包装没有发现对照用的环境变量"
: >"$TMP/shim.log"
rc=0
(
  cd "$DEPLOY" || exit 1
  PATH="$TMP/shim:$PATH" WS_SHIM_LOG="$TMP/shim.log" WS_REAL_DOCKER="$REAL_DOCKER" \
  WS_INSTALL_SCHOOL_NAME="$SCHOOL_NAME" WS_INSTALL_ADMIN_LOGIN="$ADMIN_LOGIN" \
  WS_INSTALL_ADMIN_PASSWORD="$ADMIN_PW" WS_INSTALL_SITE=localhost WS_INSTALL_TLS=1 \
    ./scripts/install.sh --non-interactive --force
) >"$TMP/install2b.log" 2>&1 || rc=$?
[ "$rc" -eq 0 ] || { tail -n 20 "$TMP/install2b.log" >&2; fail "带观察包装的第三次安装退出码 $rc"; }
[ ! -s "$TMP/shim.log" ] || fail "docker 子进程的环境里仍有 WS_INSTALL_ADMIN_PASSWORD(没有在启动时清除)"
assert_no_secrets "第三次安装输出" "$TMP/install2b.log"
assert_services_up
rm -rf "$TMP/shim"
pass "docker 子进程环境里没有 WS_INSTALL_ADMIN_PASSWORD(对照包装能发现该变量);三个服务均就绪"

echo "== 3/6 已有 .env 但 schools=0:交互方式补做 init-school"
# 模拟"上次安装在初始化前中断":清空学校与用户(级联),.env 保持不变
psql_scalar "TRUNCATE schools, users CASCADE" >/dev/null 2>&1 || fail "清空 schools 失败"
[ "$(psql_scalar "SELECT count(*) FROM schools")" = "0" ] || fail "schools 没有被清空"
# 3a. 弱密码在交互里被前置校验拦下,.env 不变
rc=0
(
  cd "$DEPLOY" || exit 1
  printf '%s\n' "$SCHOOL_NAME" "$ADMIN_LOGIN" "short1" "short1" | ./scripts/install.sh --force
) >"$TMP/install3a.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "弱密码时补做初始化应失败"
grep -q '管理员密码至少 8 位' "$TMP/install3a.log" || fail "弱密码的提示里没有「管理员密码至少 8 位」"
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "补做初始化失败后 .env 变了"
[ "$(psql_scalar "SELECT count(*) FROM schools")" = "0" ] || fail "弱密码时不应创建学校"
pass "弱密码被前置校验拦下,schools 仍为 0,.env 不变"
# 3b. 正确密码(经管道喂 stdin 的交互路径)补做成功
rc=0
(
  cd "$DEPLOY" || exit 1
  printf '%s\n' "$SCHOOL_NAME" "$ADMIN_LOGIN" "$ADMIN_PW" "$ADMIN_PW" | ./scripts/install.sh --force
) >"$TMP/install3b.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install3b.log" >&2; fail "交互补做初始化退出码 $rc"; fi
grep -q '补做初始化' "$TMP/install3b.log" || fail "输出里没有「补做初始化」"
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "补做初始化改动了 .env"
[ "$(psql_scalar "SELECT count(*) FROM schools")" = "1" ] || fail "补做后 schools 应为 1 行"
[ "$(user_count)" = "1" ] || fail "补做后 users 应为 1 行"
[ "$(psql_scalar "SELECT count(*) FROM role_bindings WHERE role_type='it_admin'")" = "1" ] \
  || fail "补做后 it_admin 绑定应为 1 条"
assert_login_ok
assert_no_secrets "交互补做输出" "$TMP/install3a.log" "$TMP/install3b.log"
pass "交互补做 init-school 成功:schools=1、users=1、it_admin=1,.env 的 sha256 不变,可登录"
# 3c. 再来一次(非交互,环境变量路径),仍然只有一所学校
rc=0
run_install "$TMP/install3c.log" || rc=$?
[ "$rc" -eq 0 ] || fail "补做之后再装一次退出码 $rc"
[ "$(psql_scalar "SELECT count(*) FROM schools")" = "1" ] || fail "再装一次后 schools 不是 1 行"
pass "补做之后再装一次,仍是一所学校"

echo "== 4/6 .env 缺密钥时拒绝(不重新生成)"
cp -p "$DEPLOY/.env" "$TMP/env.good"
awk -F= '$1=="WS_MASTER_KEY" {print "WS_MASTER_KEY="; next} {print}' "$TMP/env.good" >"$DEPLOY/.env"
broken_sha="$(sha256_of "$DEPLOY/.env")"
rc=0
run_install "$TMP/install4.log" || rc=$?
[ "$rc" -ne 0 ] || fail ".env 里 WS_MASTER_KEY 为空时,install.sh 应拒绝"
grep -q '从最近一次备份恢复' "$TMP/install4.log" || fail "提示里没有「从最近一次备份恢复」"
[ "$(sha256_of "$DEPLOY/.env")" = "$broken_sha" ] || fail "拒绝时不应改动 .env(不得重新生成密钥)"
cp -p "$TMP/env.good" "$DEPLOY/.env"
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "测试自身问题:恢复 .env 失败"
pass "WS_MASTER_KEY 为空 → 拒绝并提示从备份恢复,.env 未被重新生成"

echo "== 4b check_env_complete 的其他拒绝(L206 / L207):缺非密钥键、可信网段不含子网、改子网未 down"
# reject_env_edit <说明> <awk 程序(改写 .env)> <期望提示>:install 必须以非 0 退出、.env 不被改动、不起任何新容器(app 容器 ID 不变)
app_cid="$(dc ps -q app)"
reject_env_edit() {
  local what="$1" prog="$2" want="$3" rc=0 sha
  awk -F= "$prog" "$TMP/env.good" >"$DEPLOY/.env"
  sha="$(sha256_of "$DEPLOY/.env")"
  run_install "$TMP/install4b.log" || rc=$?
  [ "$rc" -ne 0 ] || fail "$what:install.sh 应拒绝,实际退出码 0"
  grep -q -- "$want" "$TMP/install4b.log" || { tail -n 5 "$TMP/install4b.log" >&2; fail "$what:提示里没有「$want」"; }
  [ "$(sha256_of "$DEPLOY/.env")" = "$sha" ] || fail "$what:拒绝时不应改动 .env"
  [ "$(dc ps -q app)" = "$app_cid" ] || fail "$what:拒绝时不应重建 app 容器"
  assert_no_secrets "$what 的输出" "$TMP/install4b.log"
  cp -p "$TMP/env.good" "$DEPLOY/.env"
  pass "$what:被拒绝(提示含「$want」),.env 与容器未动"
}
reject_env_edit "WS_TRUSTED_PROXIES 为空" '$1=="WS_TRUSTED_PROXIES" {print "WS_TRUSTED_PROXIES="; next} {print}' 'WS_TRUSTED_PROXIES 为空'
reject_env_edit "WS_ENV 为空" '$1=="WS_ENV" {print "WS_ENV="; next} {print}' 'WS_ENV 为空'
reject_env_edit "WS_TRUSTED_PROXIES 不包含子网" '$1=="WS_TRUSTED_PROXIES" {print "WS_TRUSTED_PROXIES=10.9.9.0/24"; next} {print}' '不包含 compose 子网'
reject_env_edit "WS_SUBNET 改了但网络没重建" '$1=="WS_SUBNET" {print "WS_SUBNET=172.31.0.0/24"; next} $1=="WS_TRUSTED_PROXIES" {print "WS_TRUSTED_PROXIES=172.31.0.0/24"; next} {print}' '现在的子网是'
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "测试自身问题:4b 之后 .env 没有恢复"
# 可信网段比子网宽(/16 包含 /24)或多项里含子网都应放行:只跑到 check_env_complete 之后即可,所以直接再装一次看退出码
awk -F= '$1=="WS_TRUSTED_PROXIES" {print "WS_TRUSTED_PROXIES=10.0.0.5,172.30.0.0/16"; next} {print}' "$TMP/env.good" >"$DEPLOY/.env"
rc=0; run_install "$TMP/install4c.log" || rc=$?
[ "$rc" -eq 0 ] || { tail -n 10 "$TMP/install4c.log" >&2; fail "WS_TRUSTED_PROXIES=10.0.0.5,172.30.0.0/16 包含子网,install 不应拒绝(退出码 $rc)"; }
cp -p "$TMP/env.good" "$DEPLOY/.env"
rc=0; run_install "$TMP/install4d.log" || rc=$?
[ "$rc" -eq 0 ] || { tail -n 10 "$TMP/install4d.log" >&2; fail "恢复 .env 后再装一次退出码 $rc"; }
assert_healthz
pass "可信网段含更宽的 /16 时放行;.env 恢复后服务健康"

echo "== 4c L183:另一个用户(nobody)执行 backup.sh → 明确提示该部署的属主与该用哪个用户,而不是「另一个备份正在进行」"
if sudo -n true 2>/dev/null && id nobody >/dev/null 2>&1; then
  chmod 711 "$TMP"   # 让 nobody 能走到部署目录(.env 仍是 600,它读不了,只需要能 stat 到属主)
  rc=0
  # 日志文件有意由测试用户(不是 nobody)创建与持有
  # shellcheck disable=SC2024
  sudo -n -u nobody "$DEPLOY/scripts/backup.sh" >"$TMP/other-user.log" 2>&1 || rc=$?
  chmod 700 "$TMP"
  [ "$rc" -ne 0 ] || fail "另一个用户执行 backup.sh 应被拒绝"
  grep -q '该部署由用户' "$TMP/other-user.log" || { cat "$TMP/other-user.log" >&2; fail "提示里没有「该部署由用户 … 安装」"; }
  grep -qF -- "$(id -un)" "$TMP/other-user.log" || fail "提示里应写出安装用户名 $(id -un)"
  grep -q '正在进行' "$TMP/other-user.log" && fail "不应报成「另一个备份正在进行」"
  [ ! -e "$DEPLOY/backups/.lock" ] || fail "另一个用户的尝试不应留下锁目录"
  pass "nobody 执行 backup.sh:提示由用户 $(id -un) 安装、请切换用户,不是锁冲突"
else
  echo "  跳过:本机没有免密 sudo 或 nobody 用户(CI 的 runner 有)"
fi

echo "== 4d L200:备份 / 恢复 / 升级持锁时 install.sh 被拒,锁不被抢"
mkdir "$DEPLOY/backups/.lock"
sleep 300 &
HOLDER=$!
printf '%s\n' "$HOLDER" >"$DEPLOY/backups/.lock/pid"
rc=0; run_install "$TMP/install-locked.log" || rc=$?
kill "$HOLDER" 2>/dev/null || true
wait "$HOLDER" 2>/dev/null || true
[ "$rc" -ne 0 ] || fail "锁被活进程持有时 install.sh 应拒绝"
grep -q '正在进行' "$TMP/install-locked.log" || fail "install 锁冲突时的提示不对"
[ "$(cat "$DEPLOY/backups/.lock/pid")" = "$HOLDER" ] || fail "install 不应改动别人持有的锁"
rm -rf "$DEPLOY/backups/.lock"
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "被锁拒绝时不应改动 .env"
pass "持锁时 install.sh 被拒绝(提示「正在进行」),锁与 .env 未动"

echo "== 4e I-2:上次升级中断的状态文件在时 install.sh 拒绝启动服务(否则会用新版 compose 起新版并迁移数据库)"
app_cid_before="$(dc ps -q app)"
# 模拟 kill -9 留下的现场:状态文件 + 被遗弃的锁(upgrade.sh 的 EXIT trap 没有执行)
(umask 077; printf 'OLD_VERSION=%s\nNEW_VERSION=%s-next\nSNAPSHOT=%s/backups/pre-upgrade-%s-19700101-000000\nBACKUP=\nSTARTED_AT=1970-01-01T00:00:00Z\n' \
  "$VERSION" "$VERSION" "$DEPLOY" "$VERSION" >"$DEPLOY/backups/.ws-upgrade-state")
true & dead_pid=$!; wait "$dead_pid" 2>/dev/null || true   # 一个已经退出的 pid
mkdir "$DEPLOY/backups/.lock"; printf '%s\n' "$dead_pid" >"$DEPLOY/backups/.lock/pid"
rc=0; run_install "$TMP/install-interrupted.log" || rc=$?
[ "$rc" -ne 0 ] || fail "状态文件在时 install.sh 应拒绝"
grep -q '上次升级' "$TMP/install-interrupted.log" || { tail -n 5 "$TMP/install-interrupted.log" >&2; fail "拒绝提示里没有「上次升级」"; }
grep -q 'rollback.sh' "$TMP/install-interrupted.log" && grep -q 'upgrade.sh' "$TMP/install-interrupted.log" || fail "拒绝提示应同时给出 rollback.sh 与重跑 upgrade.sh 两条出路"
grep -q '\.ws-upgrade-state' "$TMP/install-interrupted.log" || fail "拒绝提示应说明确认新版正常后可删除 backups/.ws-upgrade-state"
[ -f "$DEPLOY/backups/.ws-upgrade-state" ] || fail "install.sh 不应删除状态文件"
[ ! -d "$DEPLOY/backups/.lock" ] || fail "install.sh 接管的废弃锁应在退出时释放"
[ "$(dc ps -q app)" = "$app_cid_before" ] || fail "被拒绝的 install.sh 不应重建 app 容器"
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "被拒绝时不应改动 .env"
assert_no_secrets "状态文件在时的安装输出" "$TMP/install-interrupted.log"
rm -f "$DEPLOY/backups/.ws-upgrade-state"
pass "状态文件在时 install.sh 拒绝(提示 rollback.sh / 重跑 upgrade.sh / 确认后删状态文件),容器与 .env 未动,锁已释放"

echo "== 5/6 故意配错 WS_MASTER_KEY:安装输出不得泄露密钥"
bad_key="not-a-valid-key-$(openssl rand -hex 16)"
awk -F= -v k="$bad_key" '$1=="WS_MASTER_KEY" {print "WS_MASTER_KEY=" k; next} {print}' "$TMP/env.good" >"$DEPLOY/.env"
rc=0
(
  cd "$DEPLOY" || exit 1
  WS_INSTALL_HEALTH_TIMEOUT=25 WS_INSTALL_SCHOOL_NAME="$SCHOOL_NAME" WS_INSTALL_ADMIN_LOGIN="$ADMIN_LOGIN" \
  WS_INSTALL_ADMIN_PASSWORD="$ADMIN_PW" WS_INSTALL_SITE=localhost WS_INSTALL_TLS=1 \
    ./scripts/install.sh --non-interactive --force
) >"$TMP/install5.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "主密钥配错时安装应失败(应用起不来)"
assert_no_secrets "配错主密钥时的安装输出" "$TMP/install5.log"
if grep -qF -- "$bad_key" "$TMP/install5.log"; then fail "配错的 WS_MASTER_KEY 值出现在安装输出里"; fi
pass "配错主密钥:安装失败,输出里没有原密钥,也没有配错的值"
dump_logs "$TMP/compose-badkey.log"
rc=0; scan_file "$TMP/compose-badkey.log" "$bad_key" || rc=$?
[ "$rc" -eq 0 ] || fail "配错主密钥时,容器日志里出现了密钥值(rc=$rc)"
pass "配错主密钥:容器日志里也没有密钥值(含配错的值)"
cp -p "$TMP/env.good" "$DEPLOY/.env"
rc=0
run_install "$TMP/install5b.log" || rc=$?
[ "$rc" -eq 0 ] || { tail -n 20 "$TMP/install5b.log" >&2; fail "恢复 .env 后再装一次退出码 $rc"; }
assert_healthz
assert_login_ok
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "恢复后 .env 变了"
pass "恢复正确的 .env 后服务恢复健康"

echo "== 6/6 R9:缺 .env 但已有 data/pg 时拒绝覆盖"
D2="$TMP/deploy-no-env"
prepare_deploy_dir "$D2"
mkdir -p "$D2/data/pg"
rc=0
(
  cd "$D2" || exit 1
  WS_COMPOSE_PROJECT="${PROJECT}-r9" \
  WS_INSTALL_SCHOOL_NAME="$SCHOOL_NAME" WS_INSTALL_ADMIN_LOGIN="$ADMIN_LOGIN" \
  WS_INSTALL_ADMIN_PASSWORD="$ADMIN_PW" WS_INSTALL_SITE=localhost WS_INSTALL_TLS=1 \
    ./scripts/install.sh --non-interactive --force
) >"$TMP/r9.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "缺 .env 但有 data/pg 时,install.sh 应以非 0 退出"
grep -q '缺少 .env' "$TMP/r9.log" || fail "R9 提示里没有「缺少 .env」"
[ ! -e "$D2/.env" ] || fail "R9 场景下不应生成 .env"
assert_no_secrets "R9 输出" "$TMP/r9.log"
pass "R9:拒绝覆盖,未生成 .env,退出码非 0"

echo "== 出口检查"
selftest_scanner
dump_logs "$TMP/compose.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
assert_logs_dir_clean
assert_ps_clean
assert_deploy_hygiene
assert_no_xtrace
assert_static_safe

echo "install_twice 全部通过"
