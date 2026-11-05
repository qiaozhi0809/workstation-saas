#!/usr/bin/env bash
# 恢复前的拒绝(Review Focus 3):每种坏备份都必须在动数据库之前被拒绝,且每个用例只触发一个检查、
# 报错信息里是对应原因。每个"拒绝"用例都断言:退出码非 0、库签名(含库 oid,被 DROP 重建会变)不变、
# 服务仍健康且 app 容器没被重启、无 .env.before-restore 与临时物残留。
# 另有:校验和自洽但内容坏的备份(pg_restore 失败、caddy.tar 不是归档)、换库阶段失败(临时库被占用,验证旧库自动改回)。
# 最后用原始(未改动的)备份做正向对照:证明被拒绝是因为改动,而不是备份本身有问题。
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$DEPLOY_SRC/scripts/backup.sh" ] || fail "scripts/backup.sh 不存在或不可执行"
[ -x "$DEPLOY_SRC/scripts/restore.sh" ] || fail "scripts/restore.sh 不存在或不可执行"
command -v python3 >/dev/null 2>&1 || fail "本测试需要 python3 来改造备份包"

echo "== 1/3 安装、造数据、备份"
prepare_deploy_dir
start_ps_sampler
rc=0
run_install "$TMP/install.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install.log" >&2; fail "安装退出码 $rc"; fi
make_marker "原始"
# 压舱数据:让备份大一些,pg_restore 要几秒,换库失败用例与 TERM 用例才有足够宽的时间窗口(S-17)
psql_scalar "CREATE TABLE ws_ballast AS SELECT g AS id, md5(g::text) || md5((g * 7)::text) || md5((g * 13)::text) AS pad FROM generate_series(1, 300000) g" >/dev/null || fail "造压舱数据失败"
psql_scalar "ALTER TABLE ws_ballast ADD PRIMARY KEY (id)" >/dev/null || fail "给压舱数据加主键失败"
( cd "$DEPLOY" && ./scripts/backup.sh ) >"$TMP/backup.log" 2>&1 || { tail -n 20 "$TMP/backup.log" >&2; fail "backup.sh 失败"; }
GOOD="$(ls -1 "$DEPLOY"/backups/ws-backup-*.tar.gz | tail -n 1)"
[ -s "$GOOD" ] || fail "没有生成备份"
# 备份之后再改一下数据,这样"库没被恢复"可以和"库被恢复"区分开
make_marker "备份之后"
SIG="$(state_sig)"
APP_ID="$(dc ps -q app)"
APP_STARTED="$(docker inspect -f '{{.State.StartedAt}}' "$APP_ID")"
TREE0="$(tree_hash)"
ENV_SHA="$(sha256_of "$DEPLOY/.env")"
mkdir -p "$TMP/bad"
pass "已备份;库签名与 app 容器 ID 已记录"

# expect_reject <用例名> <备份路径> <期望出现在输出里的文字> [restore 其余参数...]
expect_reject() {
  local name="$1" pkg="$2" want="$3" rc=0 log="$TMP/reject-$1.log"
  shift 3
  ( cd "$DEPLOY" && ./scripts/restore.sh "$pkg" "$@" ) <&- >"$log" 2>&1 || rc=$?
  [ "$rc" -ne 0 ] || fail "$name:应当被拒绝,但退出码为 0"
  grep -q -- "$want" "$log" || { sed 's/^/    | /' "$log" >&2; fail "$name:报错信息里没有\"$want\""; }
  [ "$(state_sig)" = "$SIG" ] || fail "$name:被拒绝后库发生了变化(签名不同)"
  assert_healthz
  [ "$(dc ps -q app)" = "$APP_ID" ] || fail "$name:app 容器被重建或重启了"
  [ "$(docker inspect -f '{{.State.Running}}' "$APP_ID")" = "true" ] || fail "$name:app 没在运行"
  [ "$(docker inspect -f '{{.State.StartedAt}}' "$APP_ID")" = "$APP_STARTED" ] || fail "$name:app 被停过或重启过(服务应全程在线)"
  [ "$(tree_hash)" = "$TREE0" ] || fail "$name:部署目录(除 data/、backups/)的文件发生了变化"
  [ "$(sha256_of "$DEPLOY/.env")" = "$ENV_SHA" ] || fail "$name:.env 被改动"
  [ -z "$(find "$DEPLOY" -maxdepth 1 -name '.env.before-restore-*')" ] || fail "$name:出现了 .env.before-restore 文件"
  assert_no_residue
  assert_no_secrets "$name 的输出" "$log"
  pass "$name:被拒绝(信息含\"$want\"),库未动、服务健康"
}

echo "== 2/3 逐项拒绝"
expect_reject 不存在的文件 "$DEPLOY/backups/ws-backup-nope.tar.gz" "找不到" --yes

tamper_backup "$GOOD" "$TMP/bad/flip.tar.gz" flipgz
expect_reject 压缩流损坏 "$TMP/bad/flip.tar.gz" "无法读取" --yes

tamper_backup "$GOOD" "$TMP/bad/dbbyte.tar.gz" dbbyte
expect_reject 数据文件被改一个字节 "$TMP/bad/dbbyte.tar.gz" "校验和不符" --yes

tamper_backup "$GOOD" "$TMP/bad/nomani.tar.gz" nomanifest
expect_reject 缺少manifest "$TMP/bad/nomani.tar.gz" "没有 manifest.json" --yes

tamper_backup "$GOOD" "$TMP/bad/badjson.tar.gz" badjson
expect_reject manifest不是合法JSON "$TMP/bad/badjson.tar.gz" "不是本系统生成的格式" --yes

tamper_backup "$GOOD" "$TMP/bad/v9.tar.gz" version9
expect_reject 大版本不同 "$TMP/bad/v9.tar.gz" "大版本" --yes

tamper_backup "$GOOD" "$TMP/bad/mig.tar.gz" migration
expect_reject 迁移版本比镜像新 "$TMP/bad/mig.tar.gz" "请先用对应版本的离线包恢复" --yes

tamper_backup "$GOOD" "$TMP/bad/trav.tar.gz" traversal
expect_reject 路径穿越条目 "$TMP/bad/trav.tar.gz" "不安全的路径" --yes
[ ! -e "$DEPLOY/evil" ] || fail "路径穿越条目被解到了 $DEPLOY/evil(解包目录的上一级)"

tamper_backup "$GOOD" "$TMP/bad/sym.tar.gz" symlink
expect_reject 符号链接条目 "$TMP/bad/sym.tar.gz" "链接" --yes

# S-1:条目很多、第一个条目就是链接 / 路径穿越。若检查写成 `printf ... | grep -q`,pipefail 下 grep 提前退出会让
# printf 收到 SIGPIPE(141),管道失败,检查被悄悄绕过;这里断言走的就是该检查本身的报错(不是后面某个别的检查)
tamper_backup "$GOOD" "$TMP/bad/padlink.tar.gz" padlink
expect_reject 超长清单且首项是链接 "$TMP/bad/padlink.tar.gz" "含有链接、目录或特殊文件" --yes
tamper_backup "$GOOD" "$TMP/bad/padtrav.tar.gz" padtrav
expect_reject 超长清单且首项是路径穿越 "$TMP/bad/padtrav.tar.gz" "不安全的路径" --yes
tamper_backup "$GOOD" "$TMP/bad/caddypadlink.tar.gz" caddypadlink
expect_reject caddy清单超长且首项是链接 "$TMP/bad/caddypadlink.tar.gz" "caddy.tar 含有链接或设备文件" --yes
tamper_backup "$GOOD" "$TMP/bad/caddypadtrav.tar.gz" caddypadtrav
expect_reject caddy清单超长且首项是路径穿越 "$TMP/bad/caddypadtrav.tar.gz" "caddy.tar 含有不安全的路径" --yes

# 非交互且没有 --yes:标准输入关闭(<&-),既不是终端也读不到确认
expect_reject 非交互且无yes "$GOOD" "必须加 --yes"

tamper_backup "$GOOD" "$TMP/bad/symenv.tar.gz" symenv
expect_reject env指向etc-passwd的符号链接 "$TMP/bad/symenv.tar.gz" "链接" --yes

tamper_backup "$GOOD" "$TMP/bad/hardlink.tar.gz" hardlink
expect_reject 硬链接条目 "$TMP/bad/hardlink.tar.gz" "链接" --yes

tamper_backup "$GOOD" "$TMP/bad/dirent.tar.gz" dirent
expect_reject 目录条目 "$TMP/bad/dirent.tar.gz" "目录" --yes

tamper_backup "$GOOD" "$TMP/bad/dupdb.tar.gz" dupdb
expect_reject 重复db.dump "$TMP/bad/dupdb.tar.gz" "重复条目" --yes

tamper_backup "$GOOD" "$TMP/bad/nodb.tar.gz" nodb
expect_reject 缺少db.dump "$TMP/bad/nodb.tar.gz" "缺少 db.dump" --yes

tamper_backup "$GOOD" "$TMP/bad/mannosha.tar.gz" mannosha
expect_reject manifest缺env的sha "$TMP/bad/mannosha.tar.gz" "不是本系统生成的格式" --yes

tamper_backup "$GOOD" "$TMP/bad/manextra.tar.gz" manextra
expect_reject manifest多出文件键 "$TMP/bad/manextra.tar.gz" "不是本系统生成的格式" --yes

tamper_backup "$GOOD" "$TMP/bad/caddygarbage.tar.gz" caddygarbage
expect_reject caddy数据是垃圾但sha自洽 "$TMP/bad/caddygarbage.tar.gz" "caddy.tar 不是有效的归档" --yes

# 校验阶段全过、pg_restore 才失败:报错原因与"校验和不符"不同;临时库被清;服务全程在线(expect_reject 里查 app 的 StartedAt)
tamper_backup "$GOOD" "$TMP/bad/dbcorrupt.tar.gz" dbcorrupt
expect_reject db数据损坏但sha自洽 "$TMP/bad/dbcorrupt.tar.gz" "pg_restore 失败" --yes
grep -q '校验和不符' "$TMP/reject-db数据损坏但sha自洽.log" && fail "db数据损坏但sha自洽:不应报校验和不符(原因应是 pg_restore 失败)"

echo "== 2b 换库阶段失败:临时库被占用,旧库必须自动改回"
# 后台等 ws_restore_tmp 出现就占一个长连接,使"临时库改名为正式库"失败;此时正式库已改名为 ws_restore_old,
# restore.sh 必须把它改回来、清掉临时库、重启服务。
# 压舱数据让 pg_restore 要几秒,时间窗口远大于轮询间隔;万一还是没抢到(restore 成功了),就把库重置回"备份之后"的状态再试一次。
swap_attempt() {
  (
    n=0
    while [ "$n" -lt 1200 ]; do
      if [ "$(dc exec -T postgres psql -U workstation -d postgres -tA -c "SELECT count(*) FROM pg_database WHERE datname = 'ws_restore_tmp'" 2>/dev/null | tr -d '[:space:]')" = "1" ]; then
        dc exec -T postgres psql -U workstation -d ws_restore_tmp -c 'SELECT pg_sleep(120)' >/dev/null 2>&1 || true
        exit 0
      fi
      n=$((n + 1))
      sleep 0.05
    done
  ) &
  HOLD_PID=$!
  rc=0
  ( cd "$DEPLOY" && ./scripts/restore.sh "$GOOD" --yes ) <&- >"$TMP/reject-swapfail.log" 2>&1 || rc=$?
  kill "$HOLD_PID" 2>/dev/null || true
  wait "$HOLD_PID" 2>/dev/null || true
}
swap_attempt
if [ "$rc" -eq 0 ]; then
  echo "  (第一次没抢到占连接的时机,restore 成功了;重置数据后重试一次)"
  make_marker "备份之后"
  SIG="$(state_sig)"
  APP_ID="$(dc ps -q app)"
  APP_STARTED="$(docker inspect -f '{{.State.StartedAt}}' "$APP_ID")"
  swap_attempt
fi
[ "$rc" -ne 0 ] || fail "换库失败用例:连试两次 restore 都成功了(测试自身问题:占连接没抢在改名之前,请检查本机负载后重跑)"
grep -q '把临时库改名为正式库时出错' "$TMP/reject-swapfail.log" || { sed 's/^/    | /' "$TMP/reject-swapfail.log" >&2; fail "换库失败用例:报错里没有失败步骤的说明"; }
grep -q '正式数据库已还原' "$TMP/reject-swapfail.log" || fail "换库失败用例:没有提示\"正式数据库已还原\""
w=0
until curl -ksS --max-time 5 "https://localhost:$HTTPS_PORT/api/v1/healthz" 2>/dev/null | tr -d ' ' | grep -q '{"ok":true}'; do
  w=$((w + 3)); [ "$w" -lt 180 ] || fail "换库失败后服务没有自动恢复在线"; sleep 3
done
[ "$(state_sig)" = "$SIG" ] || fail "换库失败后正式库签名变了(旧库没有原样改回)"
assert_login_ok
assert_no_residue
assert_no_secrets "换库失败用例的输出" "$TMP/reject-swapfail.log"
APP_STARTED="$(docker inspect -f '{{.State.StartedAt}}' "$(dc ps -q app)")"
APP_ID="$(dc ps -q app)"
pass "换库阶段失败:旧库原样改回(oid 与内容签名不变)、临时库与旧库名都不残留、服务自动重启恢复"

echo "== 2c 恢复 / 备份运行中被 TERM 打断:不留临时目录、临时库、锁、.partial"
# backup.sh:等 .stage.* 出现就发 TERM(脚本在前台子进程结束后处理 TERM,经 EXIT trap 清理)
"$DEPLOY/scripts/backup.sh" >"$TMP/term-backup.log" 2>&1 &
bpid=$!
w=0
until [ -n "$(find "$DEPLOY/backups" -maxdepth 1 -name '.stage.*' | head -n 1)" ]; do
  kill -0 "$bpid" 2>/dev/null || break
  w=$((w + 1)); [ "$w" -lt 1200 ] || break
  sleep 0.05
done
kill -TERM "$bpid" 2>/dev/null || true
rc=0; wait "$bpid" || rc=$?
[ "$rc" -eq 143 ] || { tail -n 10 "$TMP/term-backup.log" >&2; fail "backup.sh 被 TERM 后退出码应为 143,实际 $rc(测试自身问题:TERM 没有赶在备份结束之前?)"; }
assert_no_residue
assert_no_secrets "被 TERM 打断的备份输出" "$TMP/term-backup.log"
pass "backup.sh 被 TERM 打断:退出码 143,无 .stage.* / .partial / 锁残留"
# restore.sh:等临时库 ws_restore_tmp 出现(正在 pg_restore)就发 TERM;此时正式库没动,清理必须删掉临时库
"$DEPLOY/scripts/restore.sh" "$GOOD" --yes <&- >"$TMP/term-restore.log" 2>&1 &
rpid=$!
w=0
until [ "$(dc exec -T postgres psql -U workstation -d postgres -tA -c "SELECT count(*) FROM pg_database WHERE datname = 'ws_restore_tmp'" 2>/dev/null | tr -d '[:space:]')" = "1" ]; do
  kill -0 "$rpid" 2>/dev/null || break
  w=$((w + 1)); [ "$w" -lt 1200 ] || break
  sleep 0.05
done
kill -TERM "$rpid" 2>/dev/null || true
rc=0; wait "$rpid" || rc=$?
[ "$rc" -eq 143 ] || { tail -n 10 "$TMP/term-restore.log" >&2; fail "restore.sh 被 TERM 后退出码应为 143,实际 $rc(测试自身问题:TERM 没有赶在恢复结束之前?)"; }
assert_no_residue
[ "$(state_sig)" = "$SIG" ] || fail "restore 被 TERM 打断后正式库变了"
assert_healthz
[ "$(dc ps -q app)" = "$APP_ID" ] || fail "restore 在换库之前被 TERM,app 容器不该被重建"
assert_no_secrets "被 TERM 打断的恢复输出" "$TMP/term-restore.log"
pass "restore.sh 被 TERM 打断:退出码 143,临时库 / .ws-restore.* / 锁都已清理,正式库未变、服务在线"

echo "== 3/3 正向对照:未改动的备份可以恢复"
[ "$(psql_scalar "SELECT note FROM ws_backup_marker WHERE id = 1")" = "备份标识-备份之后" ] || fail "测试自身问题:库里应是备份之后的数据"
rc=0
( cd "$DEPLOY" && ./scripts/restore.sh "$GOOD" --yes ) >"$TMP/restore-good.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/restore-good.log" >&2; fail "未改动的备份应当可以恢复,退出码 $rc"; fi
[ "$(psql_scalar "SELECT note FROM ws_backup_marker WHERE id = 1")" = "备份标识-原始" ] || fail "正向对照:数据没有恢复到备份时的状态"
assert_healthz
assert_login_ok
pass "正向对照通过:同一个备份在未被改动时可以恢复(上面的拒绝确实来自改动)"

selftest_scanner
assert_no_secrets "restore 正向输出" "$TMP/restore-good.log"
assert_no_secrets "backup 输出" "$TMP/backup.log"
assert_logs_dir_clean
assert_ps_clean
assert_deploy_hygiene
assert_no_residue
assert_no_xtrace
assert_static_safe

echo "restore_rejects 全部通过"
