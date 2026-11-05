#!/usr/bin/env bash
# 恢复前的拒绝(Review Focus 3):每种坏备份都必须在动数据库之前被拒绝,且每个用例只触发一个检查、
# 报错信息里是对应原因。每个"拒绝"用例都断言:退出码非 0、库签名(含库 oid,被 DROP 重建会变)不变、
# 服务仍健康且 app 容器没被重启、无 .env.before-restore 与临时物残留。
# 最后用原始(未改动的)备份做正向对照:证明被拒绝是因为改动,而不是备份本身有问题。
set -euo pipefail
# shellcheck source=deploy/tests/_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$ROOT/deploy/prod/scripts/backup.sh" ] || fail "deploy/prod/scripts/backup.sh 不存在或不可执行"
[ -x "$ROOT/deploy/prod/scripts/restore.sh" ] || fail "deploy/prod/scripts/restore.sh 不存在或不可执行"
command -v python3 >/dev/null 2>&1 || fail "本测试需要 python3 来改造备份包"

echo "== 1/3 安装、造数据、备份"
prepare_deploy_dir
start_ps_sampler
rc=0
run_install "$TMP/install.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install.log" >&2; fail "安装退出码 $rc"; fi
make_marker "原始"
( cd "$DEPLOY" && ./scripts/backup.sh ) >"$TMP/backup.log" 2>&1 || { tail -n 20 "$TMP/backup.log" >&2; fail "backup.sh 失败"; }
GOOD="$(ls -1 "$DEPLOY"/backups/ws-backup-*.tar.gz | tail -n 1)"
[ -s "$GOOD" ] || fail "没有生成备份"
# 备份之后再改一下数据,这样"库没被恢复"可以和"库被恢复"区分开
make_marker "备份之后"
SIG="$(state_sig)"
APP_ID="$(dc ps -q app)"
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
expect_reject 数据文件被改一个字节 "$TMP/bad/dbbyte.tar.gz" "校验和" --yes

tamper_backup "$GOOD" "$TMP/bad/nomani.tar.gz" nomanifest
expect_reject 缺少manifest "$TMP/bad/nomani.tar.gz" "没有 manifest.json" --yes

tamper_backup "$GOOD" "$TMP/bad/badjson.tar.gz" badjson
expect_reject manifest不是合法JSON "$TMP/bad/badjson.tar.gz" "不是合法的 JSON" --yes

tamper_backup "$GOOD" "$TMP/bad/v9.tar.gz" version9
expect_reject 大版本不同 "$TMP/bad/v9.tar.gz" "大版本" --yes

tamper_backup "$GOOD" "$TMP/bad/mig.tar.gz" migration
expect_reject 迁移版本比镜像新 "$TMP/bad/mig.tar.gz" "请先用对应版本的离线包恢复" --yes

tamper_backup "$GOOD" "$TMP/bad/trav.tar.gz" traversal
expect_reject 路径穿越条目 "$TMP/bad/trav.tar.gz" "不安全的路径" --yes
[ ! -e "$TMP/evil" ] && [ ! -e "$DEPLOY/../evil" ] || fail "路径穿越条目被解到了部署目录之外"

tamper_backup "$GOOD" "$TMP/bad/sym.tar.gz" symlink
expect_reject 符号链接条目 "$TMP/bad/sym.tar.gz" "链接" --yes

# 非交互且没有 --yes:标准输入关闭(<&-),既不是终端也读不到确认
expect_reject 非交互且无yes "$GOOD" "--yes"

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

echo "restore_rejects 全部通过"
