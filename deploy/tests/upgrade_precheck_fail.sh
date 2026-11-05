#!/usr/bin/env bash
# 升级预检不通过(Review Focus 2 / R11):必须退出 2、停在旧版本、旧服务继续可用、不覆盖任何文件。
set -euo pipefail
# shellcheck source=deploy/tests/_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$ROOT/deploy/prod/scripts/backup.sh" ] \
  || fail "deploy/prod/scripts/backup.sh 不存在(由 Task 7 提供);upgrade.sh 的强制备份依赖它,本测试在 Task 7 完成前无法通过"

echo "== 1/4 安装并制造脏数据"
prepare_deploy_dir
rc=0
run_install "$TMP/install.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install.log" >&2; fail "安装退出码 $rc"; fi
# R11:库已在 head,先删掉约束才能插脏数据,再把 alembic_version 改回 0001 模拟旧库
psql_scalar "ALTER TABLE classes DROP CONSTRAINT classes_seat_dims" >/dev/null || fail "删除约束失败"
psql_scalar "
WITH s AS (SELECT id FROM schools LIMIT 1),
 y AS (INSERT INTO academic_years (school_id, name, start_date, end_date) SELECT id, '2026-2027', '2026-09-01', '2027-07-01' FROM s RETURNING id, school_id),
 g AS (INSERT INTO grades (school_id, academic_year_id, name) SELECT school_id, id, '七年级' FROM y RETURNING id, school_id, academic_year_id)
INSERT INTO classes (school_id, academic_year_id, grade_id, name, seat_rows, seat_cols)
SELECT school_id, academic_year_id, id, '脏数据班', 13, 4 FROM g" >/dev/null || fail "插入脏数据失败"
psql_scalar "UPDATE alembic_version SET version_num = '0001'" >/dev/null || fail "改写 alembic_version 失败"
pass "已制造 seat_rows=13 的班,并把库版本改回 0001"

PKG="$TMP/pkg.tar.gz"
rm -rf "$TMP/pkgsrc"
mkdir -p "$TMP/pkgsrc/workstation-deploy-$VERSION"
cp -R "$ROOT/deploy/prod/." "$TMP/pkgsrc/workstation-deploy-$VERSION/"
printf '%s\n' "$VERSION" >"$TMP/pkgsrc/workstation-deploy-$VERSION/VERSION"
printf '# upgraded-marker\n' >>"$TMP/pkgsrc/workstation-deploy-$VERSION/docker-compose.yml"
tar -C "$TMP/pkgsrc" -czf "$PKG" "workstation-deploy-$VERSION"
compose_sha="$(sha256_of "$DEPLOY/docker-compose.yml")"
env_sha="$(sha256_of "$DEPLOY/.env")"
app_cid="$(dc ps -q app)"
app_image="$(docker inspect -f '{{.Image}}' "$app_cid")"

echo "== 2/4 升级(预期被预检拦下)"
rc=0
( cd "$DEPLOY" && ./scripts/upgrade.sh "$PKG" ) >"$TMP/upgrade.log" 2>&1 || rc=$?
[ "$rc" -eq 2 ] || { tail -n 30 "$TMP/upgrade.log" >&2; fail "upgrade.sh 退出码应为 2,实际 $rc"; }
grep -q '不通过' "$TMP/upgrade.log" || fail "输出里没有预检报告(「不通过」)"
grep -q 'classes_seat_dims\|座位' "$TMP/upgrade.log" || fail "预检报告里没有定位到 classes 座位约束"
grep -q '仍在旧版本' "$TMP/upgrade.log" || fail "输出里没有「系统仍在旧版本」提示"
pass "退出码 2,预检报告与旧版本提示都在"

echo "== 3/4 旧服务继续可用、文件未被覆盖"
[ "$(dc ps -q app)" = "$app_cid" ] || fail "app 容器被重建了"
[ "$(docker inspect -f '{{.Image}}' "$app_cid")" = "$app_image" ] || fail "app 容器的镜像 ID 变了"
[ "$(docker inspect -f '{{.State.Running}}' "$app_cid")" = "true" ] || fail "app 容器没在运行"
assert_healthz
[ "$(sha256_of "$DEPLOY/docker-compose.yml")" = "$compose_sha" ] || fail "docker-compose.yml 被覆盖了"
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail ".env 被改动了"
if grep -q 'upgraded-marker' "$DEPLOY/docker-compose.yml"; then fail "新包的 compose 文件被写进了部署目录"; fi
[ "$(cat "$DEPLOY/VERSION")" = "$VERSION" ] || fail "VERSION 被改动了"
pass "app 容器与镜像 ID 不变且健康;compose、.env、VERSION 未被覆盖"

echo "== 4/4 密钥出口"
dump_logs "$TMP/compose.log"
assert_no_secrets "升级输出" "$TMP/upgrade.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
pass "升级输出与容器日志里没有密钥"

echo "upgrade_precheck_fail 全部通过"
