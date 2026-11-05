#!/usr/bin/env bash
# 备份与恢复主流程:安装 → 建标识数据 → 备份 → 删数据 → 恢复 → 数据回来;--keep 保留份数;
# backup-last.json;旧 refresh 令牌失效;Caddy 根证书不变;.env 不同时的另存;密钥出口(规则 15)。
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$DEPLOY_SRC/scripts/backup.sh" ] || fail "scripts/backup.sh 不存在或不可执行"
[ -x "$DEPLOY_SRC/scripts/restore.sh" ] || fail "scripts/restore.sh 不存在或不可执行"

echo "== 1/6 安装并造标识数据"
prepare_deploy_dir
start_ps_sampler
rc=0
run_install "$TMP/install.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install.log" >&2; fail "安装退出码 $rc"; fi
make_marker "原始"
users_before="$(user_count)"
sig_before="$(state_sig)"
get_refresh_token "$TMP/rt.txt"
[ "$(refresh_code "$TMP/rt.txt")" = "200" ] || fail "备份前 refresh 令牌应当可用(200)"
fp_before="$(root_ca_fp)"
[ -n "$fp_before" ] || fail "取不到 Caddy 根证书指纹"
pass "已安装,标识数据、refresh 令牌、根证书指纹就绪"

echo "== 2/6 backup.sh"
rc=0
( cd "$DEPLOY" && ./scripts/backup.sh ) >"$TMP/backup1.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/backup1.log" >&2; fail "backup.sh 退出码 $rc"; fi
B1="$(ls -1 "$DEPLOY"/backups/ws-backup-*.tar.gz | tail -n 1)"
[ -s "$B1" ] || fail "没有生成备份文件"
case "$(basename "$B1")" in
  ws-backup-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-[0-9][0-9][0-9][0-9][0-9][0-9]-v"$VERSION".tar.gz) ;;
  *) fail "备份文件名格式不对:$(basename "$B1")" ;;
esac
[ "$(ls -l "$B1" | cut -c1-10)" = "-rw-------" ] || fail "备份包权限应为 600"
[ "$(ls -ld "$DEPLOY/backups" | cut -c1-10)" = "drwx------" ] || fail "backups 目录权限应为 700"
grep -q "$(basename "$B1")" "$TMP/backup1.log" || fail "输出里没有备份文件名"
grep -q '主密钥' "$TMP/backup1.log" || fail "输出里没有保管主密钥的提示"
grep -q '不要上传到外网' "$TMP/backup1.log" || fail "输出里没有\"不要上传到外网\"提示"
pass "备份包 600、backups 700、文件名与输出正确"
# 包内容:四个文件、manifest 字段、sha256、env 与 .env 一致(env 按设计含密钥,不扫描,只比对)
X="$TMP/x1"; mkdir -p "$X"
tar -xzf "$B1" -C "$X"
for f in db.dump env caddy.tar manifest.json; do [ -s "$X/$f" ] || fail "备份包里缺少 $f"; done
[ "$(find "$X" -type f | wc -l | tr -d ' ')" = "4" ] || fail "备份包里应只有 4 个文件"
cmp -s "$X/env" "$DEPLOY/.env" || fail "备份包里的 env 与 .env 不一致"
grep -q "\"version\": \"$VERSION\"" "$X/manifest.json" || fail "manifest 的 version 不对"
grep -q "\"migration\": \"$(psql_scalar 'SELECT version_num FROM alembic_version')\"" "$X/manifest.json" || fail "manifest 的 migration 不对"
grep -Eq '"created_at": "[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z"' "$X/manifest.json" || fail "manifest 的 created_at 格式不对"
for f in db.dump env caddy.tar; do
  grep -q "\"$f\": \"$(sha256_of "$X/$f")\"" "$X/manifest.json" || fail "manifest 里 $f 的 sha256 不对"
done
caddy_list="$(tar -tf "$X/caddy.tar")" || fail "caddy.tar 读不出来"
grep -q 'pki/authorities/local/root.crt' <<<"$caddy_list" || fail "caddy.tar 里没有根证书"
# 防漂移:backup.sh 写出的 manifest 必须被 restore.sh 用的校验函数接受(两处格式各写各的会悄悄失配)
# shellcheck source=/dev/null
( . "$DEPLOY/scripts/lib.sh"; manifest_valid "$X/manifest.json" ) || fail "backup.sh 生成的 manifest 没通过 restore 的 manifest_valid 校验(格式漂移)"
rm -rf "$X"
pass "包内 4 个文件齐全,manifest 字段与 sha256 正确,env 与 .env 一致,caddy 数据含根证书"
# backup-last.json
LAST="$DEPLOY/data/logs/backup-last.json"
[ -s "$LAST" ] || fail "data/logs/backup-last.json 没有写成功"
grep -q "\"file\": *\"$(basename "$B1")\"" "$LAST" || fail "backup-last.json 的 file 不对"
grep -q "\"size_bytes\": *$(wc -c <"$B1" | tr -d ' ')" "$LAST" || fail "backup-last.json 的 size_bytes 不对"
grep -Eq '"at": *"[0-9]{4}-[0-9]{2}-[0-9]{2}T' "$LAST" || fail "backup-last.json 的 at 不对"
pass "backup-last.json 字段正确"

echo "== 3/6 改数据、拆 Caddy 根证书后恢复"
psql_scalar "DELETE FROM ws_backup_marker" >/dev/null || fail "删标识数据失败"
make_marker "恢复前被改"
psql_scalar "DELETE FROM ws_backup_marker WHERE id = 1" >/dev/null
[ "$(state_sig)" != "$sig_before" ] || fail "测试自身问题:数据没有变化"
dc exec -T web rm -rf /data/caddy/pki || fail "删 Caddy pki 失败"
[ -z "$(root_ca_fp)" ] || fail "测试自身问题:根证书没有被删掉"
cp "$DEPLOY/.env" "$TMP/env.same"
rc=0
( cd "$DEPLOY" && ./scripts/restore.sh "$B1" --yes ) >"$TMP/restore1.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/restore1.log" >&2; fail "restore.sh 退出码 $rc"; fi
# 重建后库的 oid 会变,所以比较内容部分
sig_after="$(state_sig)"
[ "${sig_after#*/}" = "${sig_before#*/}" ] || fail "恢复后数据与备份时不一致:$sig_after vs $sig_before"
[ "$(psql_scalar "SELECT note FROM ws_backup_marker WHERE id = 1")" = "备份标识-原始" ] || fail "标识数据没有回来"
[ "$(user_count)" = "$users_before" ] || fail "users 行数不对"
pass "标识数据回来,users 行数与迁移版本一致"
assert_healthz
assert_login_ok
assert_services_up
[ "$(refresh_code "$TMP/rt.txt")" = "401" ] || fail "恢复后旧 refresh 令牌应返回 401"
pass "服务健康、可登录、恢复前的 refresh 令牌失效(401)"
[ "$(root_ca_fp)" = "$fp_before" ] || fail "恢复后 Caddy 根证书指纹变了(没有写回或被重新生成)"
pass "Caddy 根证书指纹不变(数据经容器写回)"
cmp -s "$DEPLOY/.env" "$TMP/env.same" || fail ".env 相同时不应被改动"
[ -z "$(find "$DEPLOY" -maxdepth 1 -name '.env.before-restore-*')" ] || fail ".env 相同时不应另存旧文件"
assert_no_residue

echo "== 4/6 --keep 保留份数与 backup-last.json"
for i in 1 2 3; do
  rc=0
  ( cd "$DEPLOY" && ./scripts/backup.sh --keep 2 ) >"$TMP/backup-keep$i.log" 2>&1 || rc=$?
  [ "$rc" -eq 0 ] || { tail -n 20 "$TMP/backup-keep$i.log" >&2; fail "第 $i 次 backup.sh --keep 2 退出码 $rc"; }
done
[ "$(ls -1 "$DEPLOY"/backups/ws-backup-*.tar.gz | wc -l | tr -d ' ')" = "2" ] || fail "--keep 2 后应只剩 2 份"
[ ! -e "$B1" ] || fail "最旧的备份应已被删除"
NEWEST="$(ls -1 "$DEPLOY"/backups/ws-backup-*.tar.gz | tail -n 1)"
grep -q "\"file\": *\"$(basename "$NEWEST")\"" "$LAST" || fail "backup-last.json 没有指向最新备份"
grep -q "\"size_bytes\": *$(wc -c <"$NEWEST" | tr -d ' ')" "$LAST" || fail "backup-last.json 的 size_bytes 与最新备份不符"
rc=0; ( cd "$DEPLOY" && ./scripts/backup.sh --keep 0 ) >"$TMP/keep0.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "--keep 0 应被拒绝"
pass "连备三次 --keep 2 只剩 2 份,backup-last.json 指向最新,--keep 0 被拒绝"
assert_no_residue

echo "== 4b 互斥锁、失败降级"
mkdir "$DEPLOY/backups/.lock"
sleep 300 &
HOLDER=$!
printf '%s\n' "$HOLDER" >"$DEPLOY/backups/.lock/pid"
rc=0; ( cd "$DEPLOY" && ./scripts/backup.sh ) >"$TMP/lock-busy.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "锁被活进程持有时 backup.sh 应当拒绝"
grep -q '正在进行' "$TMP/lock-busy.log" || fail "锁冲突时的提示不对"
rc=0; ( cd "$DEPLOY" && ./scripts/restore.sh "$NEWEST" --yes ) <&- >"$TMP/lock-busy2.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "锁被活进程持有时 restore.sh 应当拒绝"
grep -q '正在进行' "$TMP/lock-busy2.log" || fail "restore 锁冲突时的提示不对"
kill "$HOLDER" 2>/dev/null || true
wait "$HOLDER" 2>/dev/null || true
rc=0; ( cd "$DEPLOY" && ./scripts/backup.sh --keep 2 ) >"$TMP/lock-stale.log" 2>&1 || rc=$?
[ "$rc" -eq 0 ] || { tail -n 20 "$TMP/lock-stale.log" >&2; fail "持有者已死的陈旧锁应被接管并完成备份"; }
grep -q '接管' "$TMP/lock-stale.log" || fail "接管陈旧锁时没有提示"
[ ! -e "$DEPLOY/backups/.lock" ] || fail "备份结束后锁目录没有清除"
[ -z "$(find "$DEPLOY/backups" -maxdepth 1 -name '.lock*')" ] || fail "接管后 backups/ 下残留了 .lock* 目录"
# 锁目录与 pid 文件的权限不随调用者的 umask:022 的环境里建出来也应是 700 / 600
# shellcheck source=/dev/null
lock_modes="$( umask 022; . "$DEPLOY/scripts/lib.sh"; acquire_lock; printf '%s %s' "$(ls -ld "$DEPLOY/backups/.lock" | cut -c1-10)" "$(ls -l "$DEPLOY/backups/.lock/pid" | cut -c1-10)"; release_lock )"
[ "$lock_modes" = "drwx------ -rw-------" ] || fail "锁目录 / pid 文件权限应为 700 / 600,实际:$lock_modes"
[ ! -e "$DEPLOY/backups/.lock" ] || fail "release_lock 后锁目录仍在"
# 持有者是"存在但不属于当前用户"的进程(pid 1):kill -0 返回 EPERM,必须当作存活,不能被接管
mkdir "$DEPLOY/backups/.lock"
printf '1\n' >"$DEPLOY/backups/.lock/pid"
rc=0; ( cd "$DEPLOY" && ./scripts/backup.sh ) >"$TMP/lock-eperm.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "持有者是他人进程(kill -0 返回 EPERM)时锁不应被接管"
grep -q '正在进行' "$TMP/lock-eperm.log" || fail "EPERM 持有者:提示不对"
[ -d "$DEPLOY/backups/.lock" ] || fail "EPERM 持有者的锁被删掉了"
rm -rf "$DEPLOY/backups/.lock"
pass "活进程持锁时 backup / restore 拒绝;他人进程(EPERM)持锁同样拒绝;持有者已死则接管且不留 .lock.*;锁目录 700;结束后锁清除"
# backup-last.json 写失败 → 降级为警告,备份仍成功并保留文件
mv "$LAST" "$TMP/backup-last.saved"
mkdir "$LAST"
rc=0; ( cd "$DEPLOY" && ./scripts/backup.sh --keep 2 ) >"$TMP/last-fail.log" 2>&1 || rc=$?
[ "$rc" -eq 0 ] || { tail -n 20 "$TMP/last-fail.log" >&2; fail "backup-last.json 写失败不应让备份失败(退出码 $rc)"; }
grep -q '备份文件已保留' "$TMP/last-fail.log" || fail "降级警告里没有\"备份文件已保留\""
NEWEST="$(ls -1 "$DEPLOY"/backups/ws-backup-*.tar.gz | tail -n 1)"
[ -s "$NEWEST" ] || fail "降级时备份文件应当存在"
rmdir "$LAST"
mv "$TMP/backup-last.saved" "$LAST"
pass "backup-last.json 写失败 → 警告并退出 0,备份文件保留"
assert_no_residue

echo "== 5/6 恢复 .env:与数据绑定的值取备份的,其余保留当前机器的,旧文件另存 600"
# 先在 .env 里放一个"只有备份里有"的键并备份;然后把当前 .env 改成:JWT 密钥换掉、冲突键 ACME 邮箱改掉、去掉那个键
printf 'WS_TEST_EXTRA=from-backup\n' >>"$DEPLOY/.env"
rc=0; ( cd "$DEPLOY" && ./scripts/backup.sh --keep 5 ) >"$TMP/backup5.log" 2>&1 || rc=$?
[ "$rc" -eq 0 ] || { tail -n 20 "$TMP/backup5.log" >&2; fail "第 5 节备份失败"; }
B5="$(ls -1 "$DEPLOY"/backups/ws-backup-*.tar.gz | tail -n 1)"
BK_JWT="$(env_value WS_JWT_SECRET)"
BK_MASTER="$(env_value WS_MASTER_KEY)"
KEEP_PGPW="$(env_value POSTGRES_PASSWORD)"
KEEP_DBURL="$(env_value WS_DATABASE_URL)"
NEW_JWT="$(openssl rand -hex 24)"
awk -v nj="$NEW_JWT" '
  /^WS_TEST_EXTRA=/ { next }
  /^WS_JWT_SECRET=/ { print "WS_JWT_SECRET=" nj; next }
  /^WS_ACME_EMAIL=/ { print "WS_ACME_EMAIL=keep@example.test"; next }
  { print }' "$DEPLOY/.env" >"$TMP/env.edit"
cat "$TMP/env.edit" >"$DEPLOY/.env"
rm -f "$TMP/env.edit"
[ "$(env_value WS_JWT_SECRET)" = "$NEW_JWT" ] || fail "测试自身问题:当前 .env 的 WS_JWT_SECRET 没改成功"
rc=0
( cd "$DEPLOY" && ./scripts/restore.sh "$B5" --yes ) >"$TMP/restore2.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/restore2.log" >&2; fail "第二次 restore.sh 退出码 $rc"; fi
[ "$(env_value WS_JWT_SECRET)" = "$BK_JWT" ] || fail "恢复后 WS_JWT_SECRET 应来自备份"
[ "$(env_value WS_MASTER_KEY)" = "$BK_MASTER" ] || fail "恢复后 WS_MASTER_KEY 应来自备份"
[ "$(env_value POSTGRES_PASSWORD)" = "$KEEP_PGPW" ] || fail "恢复后 POSTGRES_PASSWORD 应保持当前机器的值"
[ "$(env_value WS_DATABASE_URL)" = "$KEEP_DBURL" ] || fail "恢复后 WS_DATABASE_URL 应保持当前机器的值"
[ "$(env_value WS_ACME_EMAIL)" = "keep@example.test" ] || fail "恢复后冲突键 WS_ACME_EMAIL 应保持当前机器的值"
[ "$(env_value WS_VERSION)" = "$VERSION" ] || fail "恢复后 WS_VERSION 应保持当前值"
[ "$(env_value WS_TEST_EXTRA)" = "from-backup" ] || fail "备份里有而当前没有的键应被追加"
SAVED="$(find "$DEPLOY" -maxdepth 1 -name '.env.before-restore-*')"
[ "$(printf '%s\n' "$SAVED" | grep -c .)" = "1" ] || fail "应恰有一个 .env.before-restore-* 文件"
[ "$(ls -l "$SAVED" | cut -c1-10)" = "-rw-------" ] || fail "另存的旧 .env 权限应为 600"
grep -q "^WS_JWT_SECRET=$NEW_JWT\$" "$SAVED" || fail "另存的旧 .env 内容不对(应是恢复前的 JWT 密钥)"
[ "$(ls -l "$DEPLOY/.env" | cut -c1-10)" = "-rw-------" ] || fail "恢复后 .env 权限应为 600"
rm -f "$SAVED"
assert_healthz
assert_login_ok
assert_services_up
pass "数据绑定的值(主密钥、JWT 密钥)取备份的;数据库密码与连接串、站点类键保持当前;缺失键追加;旧 .env 另存 600;应用健康"
assert_no_residue

echo "== 6/6 diagnose.sh 与密钥出口"
selftest_scanner
# 在 app 容器的标准输出里造一行含密钥、手机号、Bearer、JWT 形状串的日志,再验证诊断包把它们全部打码
dump_logs "$TMP/compose.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
dc exec -T app sh -c 'echo "CANARY-DIAG $WS_JWT_SECRET $WS_MASTER_KEY $WS_DATABASE_URL 13800000012 Bearer abc123.def456 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig_nature-1" > /proc/1/fd/1' \
  || fail "造诊断金丝雀日志失败"
dc exec -T app sh -c 'echo "CANARY-SHAPES +86 138-0000-0013 86 13800000014 bearer lowerTok99xyz Authorization: Token tokVal7788zz password=Sup3rS3cret1 ?token=tok-abc-123456 Set-Cookie: sid=cookieval999 {\"refresh_token\": \"rtVal5566qq\"}" > /proc/1/fd/1' \
  || fail "造打码形状金丝雀日志失败"
# S-5:往 .env 里临时加两个"未来才会有"的密钥键(键名含 KEY;连接串里带密码),诊断包与终端输出里都不得出现它们的值
FUT1="$(openssl rand -hex 12)"
FUT2="$(openssl rand -hex 12)"
cp -p "$DEPLOY/.env" "$TMP/env.prefuture"
printf 'WS_FUTURE_API_KEY=%s\nWS_FUTURE_CACHE_URL=redis://cache:%s@cache.example.test:6379/1\n' "$FUT1" "$FUT2" >>"$DEPLOY/.env"
printf 'CANARY-FUTURE api-key-is %s and cache-pw-is %s\n' "$FUT1" "$FUT2" | dc exec -T app sh -c 'cat > /proc/1/fd/1' \
  || fail "造新增密钥键的金丝雀日志失败"
mkdir -p "$TMP/diag-out" "$TMP/diag-tmp"
rc=0
( cd "$DEPLOY" && TMPDIR="$TMP/diag-tmp" ./scripts/diagnose.sh --out "$TMP/diag-out" ) >"$TMP/diagnose.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/diagnose.log" >&2; fail "diagnose.sh 退出码 $rc"; fi
DIAG="$(ls -1 "$TMP"/diag-out/ws-host-diagnostics-*.tar.gz)"
[ "$(printf '%s\n' "$DIAG" | grep -c .)" = "1" ] || fail "应恰好生成一个诊断包"
[ "$(ls -l "$DIAG" | cut -c1-10)" = "-rw-------" ] || fail "诊断包权限应为 600"
mkdir -p "$TMP/diag-x"
tar -xzf "$DIAG" -C "$TMP/diag-x"
for f in compose-ps.txt docker-version.txt df.txt free.txt uname.txt logs-app.txt logs-postgres.txt logs-web.txt; do
  [ -s "$(find "$TMP/diag-x" -name "$f" | head -n 1)" ] || fail "诊断包里缺少 $f 或为空"
done
[ -z "$(find "$TMP/diag-x" -name '.env*' -o -name 'env')" ] || fail "诊断包里不应含 .env"
grep -rq 'CANARY-DIAG' "$TMP/diag-x" || fail "金丝雀日志没有进诊断包(测试无效)"
grep -rq '1\*\*\*\*\*\*\*\*\*\*' "$TMP/diag-x" || fail "手机号没有被打码成 1**********"
grep -rq '13800000012' "$TMP/diag-x" && fail "诊断包里出现了手机号"
grep -rq 'abc123.def456' "$TMP/diag-x" && fail "诊断包里出现了 Bearer 令牌"
grep -rq 'eyJhbGciOiJIUzI1NiJ9' "$TMP/diag-x" && fail "诊断包里出现了 JWT"
grep -rq 'CANARY-SHAPES' "$TMP/diag-x" || fail "形状金丝雀日志没有进诊断包(测试无效)"
for leak in '138-0000-0013' '13800000014' 'lowerTok99xyz' 'tokVal7788zz' 'Sup3rS3cret1' 'tok-abc-123456' 'cookieval999' 'rtVal5566qq'; do
  grep -rqF -- "$leak" "$TMP/diag-x" && fail "诊断包里出现了应被打码的内容:$leak"
done
while IFS= read -r f; do
  assert_no_secrets "诊断包文件 $(basename "$f")" "$f"
done < <(find "$TMP/diag-x" -type f)
assert_no_secrets "diagnose 终端输出" "$TMP/diagnose.log"
grep -rq 'CANARY-FUTURE' "$TMP/diag-x" || fail "新增密钥键的金丝雀日志没有进诊断包(测试无效)"
while IFS= read -r f; do
  rc=0; scan_file "$f" "$FUT1" "$FUT2" || rc=$?
  [ "$rc" -eq 0 ] || fail "诊断包文件 $(basename "$f") 里出现了 .env 新增键(WS_FUTURE_API_KEY / 连接串密码)的值"
done < <(find "$TMP/diag-x" -type f)
rc=0; scan_file "$TMP/diagnose.log" "$FUT1" "$FUT2" || rc=$?
[ "$rc" -eq 0 ] || fail "diagnose 终端输出里出现了 .env 新增键的值"
# lib.sh 的 redact(安装 / 恢复 / 升级回显容器输出前用的)同样按键名规则覆盖新增键
# shellcheck source=/dev/null
red="$( . "$DEPLOY/scripts/lib.sh"; printf 'a %s b %s c\n' "$FUT1" "$FUT2" | redact )"
case "$red" in *"$FUT1"*|*"$FUT2"*) fail "redact 没有遮住 .env 新增键的值" ;; esac
case "$red" in *'a *** b *** c'*) ;; *) fail "redact 输出不符合预期:$red" ;; esac
# 正向对照:换成没有这两个键的 .env 后,同样的输入不会被遮(证明上面是键名规则起作用,不是别的原因)
cat "$TMP/env.prefuture" >"$DEPLOY/.env"
# shellcheck source=/dev/null
red2="$( . "$DEPLOY/scripts/lib.sh"; printf 'a %s b\n' "$FUT1" | redact )"
case "$red2" in *"$FUT1"*) ;; *) fail "对照失败:没有这个键时值不该被遮" ;; esac
unset FUT1 FUT2 red red2
pass "新增的 WS_FUTURE_API_KEY 与连接串密码:诊断包与终端输出里没有;redact 同样遮住;去掉键后不再遮(规则按键名生效)"
[ -z "$(ls -A "$TMP/diag-tmp")" ] || fail "diagnose 在 TMPDIR 里留下了临时物"
# .env 里的主密钥写成带引号的形式:读取时去引号,诊断包与终端输出里(容器里是不带引号的值)仍不得出现密钥
cp -p "$DEPLOY/.env" "$TMP/env.orig"
sed 's/^WS_MASTER_KEY=\(.*\)$/WS_MASTER_KEY="\1"/' "$TMP/env.orig" >"$TMP/env.quoted"
cat "$TMP/env.quoted" >"$DEPLOY/.env"
grep -q '^WS_MASTER_KEY="' "$DEPLOY/.env" || fail "测试自身问题:WS_MASTER_KEY 没有改成带引号的形式"
mkdir -p "$TMP/diag-out2" "$TMP/diag-x2"
rc=0
( cd "$DEPLOY" && TMPDIR="$TMP/diag-tmp" ./scripts/diagnose.sh --out "$TMP/diag-out2" ) >"$TMP/diagnose2.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/diagnose2.log" >&2; fail "带引号的 .env 下 diagnose.sh 退出码 $rc"; fi
tar -xzf "$(ls -1 "$TMP"/diag-out2/ws-host-diagnostics-*.tar.gz)" -C "$TMP/diag-x2"
grep -rq 'CANARY-DIAG' "$TMP/diag-x2" || fail "带引号场景:金丝雀日志没有进诊断包(测试无效)"
while IFS= read -r f; do
  assert_no_secrets "带引号 .env 的诊断包文件 $(basename "$f")" "$f"
done < <(find "$TMP/diag-x2" -type f)
assert_no_secrets "带引号 .env 的 diagnose 终端输出" "$TMP/diagnose2.log"
cat "$TMP/env.orig" >"$DEPLOY/.env"
rm -f "$TMP/env.orig" "$TMP/env.quoted"
[ -z "$(ls -A "$TMP/diag-tmp")" ] || fail "diagnose 在 TMPDIR 里留下了临时物"
pass "诊断包:文件齐全、600、不含 .env、金丝雀日志里的密钥/手机号/Bearer/JWT 全部打码"

echo "-- 6b 以 xtrace 方式运行 backup.sh / diagnose.sh:输出里不得有密钥(S-3)"
# 脚本第一条命令就是 set +x(并 unset BASH_XTRACEFD),所以即使调用者设了 SHELLOPTS=xtrace 或 bash -x,
# 只有 "+ set +x" 这样的开头几行会被回显,这几行不含密钥;之后全部静默。
# (用 env 传 SHELLOPTS:bash 里 SHELLOPTS 是只读变量,写成 `SHELLOPTS=xtrace cmd` 会报错,而且 bash 3.2 下会让脚本悄悄以 0 退出。)
# 先做正向对照:同样的环境变量下,一个没有 set +x 的脚本确实会把密钥回显到 stderr(扫描器抓得到),证明下面的"干净"有意义。
env WS_XT_CTRL="$(env_value WS_JWT_SECRET)" SHELLOPTS=xtrace bash -c ': "$WS_XT_CTRL"' 2>"$TMP/xt-ctrl.err" || fail "xtrace 对照脚本运行失败"
rc=0; scan_file "$TMP/xt-ctrl.err" || rc=$?
[ "$rc" -eq 1 ] || fail "xtrace 对照:没开 set +x 的脚本在 SHELLOPTS=xtrace 下应当泄露密钥(rc=$rc),说明测试方法无效"
rm -f "$TMP/xt-ctrl.err"
mkdir -p "$TMP/diag-out3"
rc=0
( cd "$DEPLOY" && env SHELLOPTS=xtrace ./scripts/backup.sh --keep 5 ) >"$TMP/xt-backup.out" 2>"$TMP/xt-backup.err" || rc=$?
[ "$rc" -eq 0 ] || { tail -n 10 "$TMP/xt-backup.err" >&2; fail "SHELLOPTS=xtrace 下 backup.sh 退出码 $rc"; }
rc=0
( cd "$DEPLOY" && env SHELLOPTS=xtrace TMPDIR="$TMP/diag-tmp" ./scripts/diagnose.sh --out "$TMP/diag-out3" ) >"$TMP/xt-diag.out" 2>"$TMP/xt-diag.err" || rc=$?
[ "$rc" -eq 0 ] || { tail -n 10 "$TMP/xt-diag.err" >&2; fail "SHELLOPTS=xtrace 下 diagnose.sh 退出码 $rc"; }
# BASH_XTRACEFD 指向文件的变体:trace 写进该文件(而不是 stderr),同样不得含密钥
rc=0
( cd "$DEPLOY" && env BASH_XTRACEFD=7 SHELLOPTS=xtrace ./scripts/backup.sh --keep 5 7>"$TMP/xt-fd.txt" ) >"$TMP/xt-fd.out" 2>"$TMP/xt-fd.err" || rc=$?
[ "$rc" -eq 0 ] || { tail -n 10 "$TMP/xt-fd.err" >&2; fail "BASH_XTRACEFD + xtrace 下 backup.sh 退出码 $rc"; }
for n in xt-backup.out xt-backup.err xt-diag.out xt-diag.err xt-fd.out xt-fd.err xt-fd.txt; do
  assert_no_secrets "xtrace 方式运行的输出 $n" "$TMP/$n"
done
for n in xt-backup.err xt-diag.err xt-fd.err; do
  [ "$(grep -c '^+' "$TMP/$n" || true)" -le 3 ] || fail "$n 里 xtrace 行数超过开头的几行(set +x 没有让脚本静默?)"
done
rm -f "$TMP/xt-"* ; rm -rf "$TMP/diag-out3"
pass "SHELLOPTS=xtrace / BASH_XTRACEFD 下运行 backup.sh、diagnose.sh:stdout、stderr、trace 文件里都没有密钥,xtrace 只回显开头几行"
for n in backup1 backup-keep1 backup-keep2 backup-keep3 backup5 restore1 restore2 lock-busy lock-busy2 lock-stale lock-eperm last-fail install; do
  assert_no_secrets "输出 $n.log" "$TMP/$n.log"
done
assert_logs_dir_clean
pass "backup / restore 终端输出、data/logs 全部文件里没有密钥与管理员密码"
assert_ps_clean
assert_deploy_hygiene
assert_no_residue
assert_no_xtrace
assert_static_safe

echo "backup_restore 全部通过"
