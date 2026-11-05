#!/usr/bin/env bash
# 备份与恢复主流程:安装 → 建标识数据 → 备份 → 删数据 → 恢复 → 数据回来;--keep 保留份数;
# backup-last.json;旧 refresh 令牌失效;Caddy 根证书不变;.env 不同时的另存;密钥出口(规则 15)。
set -euo pipefail
# shellcheck source=deploy/tests/_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$ROOT/deploy/prod/scripts/backup.sh" ] || fail "deploy/prod/scripts/backup.sh 不存在或不可执行"
[ -x "$ROOT/deploy/prod/scripts/restore.sh" ] || fail "deploy/prod/scripts/restore.sh 不存在或不可执行"

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
tar -tf "$X/caddy.tar" | grep -q 'pki/authorities/local/root.crt' || fail "caddy.tar 里没有根证书"
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

echo "== 5/6 .env 与当前不同时:用备份里的,旧的另存 600"
printf '# 测试标记-恢复前\n' >>"$DEPLOY/.env"
rc=0
( cd "$DEPLOY" && ./scripts/restore.sh "$NEWEST" --yes ) >"$TMP/restore2.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/restore2.log" >&2; fail "第二次 restore.sh 退出码 $rc"; fi
grep -q '测试标记-恢复前' "$DEPLOY/.env" && fail "恢复后 .env 应为备份里的内容"
SAVED="$(find "$DEPLOY" -maxdepth 1 -name '.env.before-restore-*')"
[ "$(printf '%s\n' "$SAVED" | grep -c .)" = "1" ] || fail "应恰有一个 .env.before-restore-* 文件"
[ "$(ls -l "$SAVED" | cut -c1-10)" = "-rw-------" ] || fail "另存的旧 .env 权限应为 600"
grep -q '测试标记-恢复前' "$SAVED" || fail "另存的旧 .env 内容不对"
[ "$(ls -l "$DEPLOY/.env" | cut -c1-10)" = "-rw-------" ] || fail "恢复后 .env 权限应为 600"
rm -f "$SAVED"
assert_healthz
assert_login_ok
pass ".env 用备份里的、旧文件另存且权限 600、服务恢复"
assert_no_residue

echo "== 6/6 diagnose.sh 与密钥出口"
selftest_scanner
# 在 app 容器的标准输出里造一行含密钥、手机号、Bearer、JWT 形状串的日志,再验证诊断包把它们全部打码
dump_logs "$TMP/compose.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
dc exec -T app sh -c 'echo "CANARY-DIAG $WS_JWT_SECRET $WS_MASTER_KEY $WS_DATABASE_URL 13800000012 Bearer abc123.def456 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.sig_nature-1" > /proc/1/fd/1' \
  || fail "造诊断金丝雀日志失败"
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
while IFS= read -r f; do
  assert_no_secrets "诊断包文件 $(basename "$f")" "$f"
done < <(find "$TMP/diag-x" -type f)
assert_no_secrets "diagnose 终端输出" "$TMP/diagnose.log"
[ -z "$(ls -A "$TMP/diag-tmp")" ] || fail "diagnose 在 TMPDIR 里留下了临时物"
pass "诊断包:文件齐全、600、不含 .env、金丝雀日志里的密钥/手机号/Bearer/JWT 全部打码"
for n in backup1 backup-keep1 backup-keep2 backup-keep3 restore1 restore2 install; do
  assert_no_secrets "输出 $n.log" "$TMP/$n.log"
done
assert_logs_dir_clean
pass "backup / restore 终端输出、data/logs 全部文件里没有密钥与管理员密码"
assert_ps_clean
assert_deploy_hygiene
assert_no_residue
assert_no_xtrace

echo "backup_restore 全部通过"
