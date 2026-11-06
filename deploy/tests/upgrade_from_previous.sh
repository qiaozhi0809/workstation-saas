#!/usr/bin/env bash
# 跨版本真实包升级(L117 / R14):用上一个发布 tag 打出的旧离线包装一套,再用本提交的离线包升级。
#   安装旧版(旧包自己的 install.sh)→ 造旧结构下的数据(班级、学生、家长通知)→ 按手册第 9 节的做法先把新包的 scripts/
#   覆盖进部署目录 → 新 upgrade.sh 升级 → 断言 alembic_version 到了新镜像的 head、0013 的 notice_students.class_name 已回填、
#   用户数与数据不变、登录可用、.env 补上了 WS_SUBNET、快照目录在。
# 需要的环境变量:
#   WS_PREVIOUS_DEPLOY_SRC  解开的旧离线包目录(含 images/);为空或未设置 → 打印 ::warning 并以 0 退出(tag 还没打时)
#   WS_PREVIOUS_VERSION     旧包版本号(如 0.7.2-ci)
#   WS_TEST_DEPLOY_SRC      解开的新离线包目录;WS_BUNDLE_PKG 新离线包 tar.gz(旁边有 .sha256);WS_TEST_VERSION 新版本号
#   WS_EXPECTED_MIGRATION   可选,升级后 alembic_version 必须等于它(不设则只要求等于新镜像的 head)
# 旧包的镜像在这里 docker load(install 用 WS_INSTALL_SKIP_LOAD=1);升级真走 docker load 新包的镜像。
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

if [ -z "${WS_PREVIOUS_DEPLOY_SRC:-}" ]; then
  echo "::warning::WS_PREVIOUS_DEPLOY_SRC 未设置(上一个发布 tag 还没打或旧包没构建),跳过跨版本升级测试"
  exit 0
fi
PREV_SRC="$(cd "$WS_PREVIOUS_DEPLOY_SRC" && pwd)" || fail "WS_PREVIOUS_DEPLOY_SRC 不是目录:$WS_PREVIOUS_DEPLOY_SRC"
PREV_VERSION="${WS_PREVIOUS_VERSION:-}"
[ -n "$PREV_VERSION" ] || fail "需要设置 WS_PREVIOUS_VERSION(旧包版本号)"
[ "$(tr -d '[:space:]' <"$PREV_SRC/VERSION")" = "$PREV_VERSION" ] || fail "旧包目录的 VERSION 与 WS_PREVIOUS_VERSION($PREV_VERSION)不一致"
[ -n "${WS_TEST_DEPLOY_SRC:-}" ] || fail "需要设置 WS_TEST_DEPLOY_SRC(新离线包解开的目录)"
[ -f "${WS_BUNDLE_PKG:-}" ] || fail "需要设置 WS_BUNDLE_PKG(新离线包 tar.gz 路径)"
[ -f "$WS_BUNDLE_PKG.sha256" ] || fail "新离线包旁边没有 .sha256"
[ "$(tr -d '[:space:]' <"$DEPLOY_SRC/VERSION")" = "$VERSION" ] || fail "新包目录的 VERSION 与 WS_TEST_VERSION($VERSION)不一致"
PREV_IMAGES="$PREV_SRC/images/workstation-images-$PREV_VERSION.tar"
[ -f "$PREV_IMAGES" ] || fail "旧包里没有 $PREV_IMAGES"

echo "== 1/4 载入旧版镜像,用旧包自己的 install.sh 安装 $PREV_VERSION"
docker load -i "$PREV_IMAGES" >/dev/null || fail "docker load 旧包镜像失败"
for img in workstation-app workstation-web workstation-stream; do
  docker image inspect "$img:$PREV_VERSION" >/dev/null 2>&1 || fail "旧包镜像里没有 $img:$PREV_VERSION"
  ALIAS_TAGS="$ALIAS_TAGS $img:$PREV_VERSION"
done
mkdir -p "$DEPLOY"
# 镜像已载入,部署目录里不复制 1 GB 的 images/
( cd "$PREV_SRC" && tar --exclude='./images' -cf - . ) | ( cd "$DEPLOY" && tar -xf - ) || fail "复制旧包目录失败"
[ "$(tr -d '[:space:]' <"$DEPLOY/VERSION")" = "$PREV_VERSION" ] || fail "测试自身问题:部署目录的 VERSION 不是旧版"
start_ps_sampler
rc=0
run_install "$TMP/install.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/install.log" >&2; fail "旧版安装退出码 $rc"; fi
assert_healthz
assert_login_ok
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q app)")" = "workstation-app:$PREV_VERSION" ] || fail "旧版 app 容器没有用 $PREV_VERSION 镜像"
old_rev="$(psql_scalar 'SELECT version_num FROM alembic_version')"
[ -n "$old_rev" ] || fail "读不到旧版的 alembic_version"
pass "旧版 $PREV_VERSION 已安装并可登录,迁移版本 $old_rev"

echo "== 2/4 造旧结构下的数据:年级、班级、学生、在读注册、一条发给家长的通知"
# 0013 会给 notice_students 加 class_id / class_name 并按在读注册回填;这里先在旧结构里放一条
psql_scalar "
WITH s AS (SELECT id FROM schools LIMIT 1),
 y AS (SELECT id FROM academic_years WHERE is_active LIMIT 1),
 u AS (SELECT id FROM users LIMIT 1),
 g AS (INSERT INTO grades (school_id, academic_year_id, name) SELECT s.id, y.id, '一年级' FROM s, y RETURNING id, school_id, academic_year_id),
 c AS (INSERT INTO classes (school_id, academic_year_id, grade_id, name) SELECT school_id, academic_year_id, id, '一年二班' FROM g RETURNING id, school_id, academic_year_id),
 st AS (INSERT INTO students (school_id, mk, name) SELECT school_id, 'U9001', '升级测试学生' FROM c RETURNING id, school_id),
 e AS (INSERT INTO enrollments (student_id, class_id, academic_year_id) SELECT st.id, c.id, c.academic_year_id FROM st, c RETURNING id),
 n AS (INSERT INTO notices (school_id, from_user_id, title, content, target, target_label, audience, class_id)
       SELECT c.school_id, u.id, '升级测试通知', '跨版本升级前写入', '{}'::jsonb, '一年二班', 'parents', c.id FROM c, u RETURNING id)
INSERT INTO notice_students (notice_id, student_id, parent_user_id) SELECT n.id, st.id, u.id FROM n, st, u" >/dev/null \
  || fail "造旧结构数据失败"
[ "$(psql_scalar "SELECT count(*) FROM notice_students")" = "1" ] || fail "notice_students 应有 1 行"
make_marker "跨版本"
users_before="$(user_count)"
students_before="$(psql_scalar 'SELECT count(*) FROM students')"
pass "数据就绪:users=$users_before、students=$students_before、notice_students=1"

echo "== 3/4 先把新包的 scripts/ 覆盖进部署目录(手册第 9 节的做法),再用新包 upgrade.sh 升级到 $VERSION"
cp "$DEPLOY_SRC"/scripts/*.sh "$DEPLOY/scripts/"
chmod 755 "$DEPLOY"/scripts/*.sh
[ -x "$DEPLOY/scripts/rollback.sh" ] || fail "新包的 scripts/ 没有复制进部署目录"
! grep -q '^WS_SUBNET=' "$DEPLOY/.env" || fail "测试自身问题:旧版 .env 不应已有 WS_SUBNET(旧包版本太新?)"
rc=0
( cd "$DEPLOY" && WS_INSTALL_SKIP_LOAD=0 ./scripts/upgrade.sh "$WS_BUNDLE_PKG" ) >"$TMP/upgrade.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 40 "$TMP/upgrade.log" >&2; fail "跨版本 upgrade.sh 退出码 $rc(期望 0)"; fi
grep -q '离线包校验和通过' "$TMP/upgrade.log" || fail "输出里没有「离线包校验和通过」"
grep -q '载入新镜像' "$TMP/upgrade.log" || fail "升级没有走 docker load 新包里的镜像"
grep -q "升级 $PREV_VERSION → $VERSION" "$TMP/upgrade.log" || fail "输出里没有「升级 $PREV_VERSION → $VERSION」"
pass "upgrade.sh 退出码 0"

echo "== 4/4 升级后:迁移到新 head、0013 回填、数据与登录、.env 与快照"
new_rev="$(psql_scalar 'SELECT version_num FROM alembic_version')"
head="$(dc run --rm -T --no-deps --entrypoint python app -c '
from alembic.config import Config
from alembic.script import ScriptDirectory
print(ScriptDirectory.from_config(Config("alembic.ini")).get_current_head())
' </dev/null 2>/dev/null | tr -d '[:space:]')"
[ -n "$head" ] || fail "读不到新镜像的迁移 head"
[ "$new_rev" = "$head" ] || fail "升级后 alembic_version 应为新镜像的 head $head,实际 $new_rev"
if [ -n "${WS_EXPECTED_MIGRATION:-}" ]; then
  [ "$new_rev" = "$WS_EXPECTED_MIGRATION" ] || fail "升级后 alembic_version 应为 $WS_EXPECTED_MIGRATION,实际 $new_rev"
fi
echo "  迁移:$old_rev → $new_rev(新镜像 head $head)"
has_class_name="$(psql_scalar "SELECT count(*) FROM information_schema.columns WHERE table_name = 'notice_students' AND column_name = 'class_name'")"
if [ "$has_class_name" = "1" ]; then
  [ "$(psql_scalar "SELECT class_name FROM notice_students LIMIT 1")" = "一年二班" ] || fail "0013 没有把 notice_students.class_name 回填成在读班级"
  [ "$(psql_scalar "SELECT count(*) FROM notice_students WHERE class_id IS NULL")" = "0" ] || fail "0013 没有回填 notice_students.class_id"
  pass "0013 回填:notice_students.class_name = 一年二班,class_id 非空"
else
  echo "::warning::新镜像的 notice_students 没有 class_name 列(迁移 0013 尚未并入),跳过回填断言"
fi
[ "$(user_count)" = "$users_before" ] || fail "升级后 users 行数变了"
[ "$(psql_scalar 'SELECT count(*) FROM students')" = "$students_before" ] || fail "升级后 students 行数变了"
[ "$(psql_scalar "SELECT note FROM ws_backup_marker WHERE id = 1")" = "备份标识-跨版本" ] || fail "升级后标识数据不在"
assert_healthz
assert_login_ok
assert_services_up
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q app)")" = "workstation-app:$VERSION" ] || fail "升级后 app 容器没有用 $VERSION 镜像"
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q stream-worker)")" = "workstation-stream:$VERSION" ] || fail "升级后 stream-worker 没有用 $VERSION 镜像"
[ "$(tr -d '[:space:]' <"$DEPLOY/VERSION")" = "$VERSION" ] || fail "升级后 VERSION 不对"
[ "$(env_value WS_VERSION)" = "$VERSION" ] || fail "升级后 .env 的 WS_VERSION 不对"
net_subnet="$(docker network inspect "${PROJECT}_ws-net" -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}')"
[ "$(env_value WS_SUBNET)" = "$net_subnet" ] || fail "升级后 .env 应补上 WS_SUBNET=$net_subnet,实际「$(env_value WS_SUBNET)」"
[ -n "$(find "$DEPLOY/backups" -maxdepth 1 -name "pre-upgrade-$PREV_VERSION-*" -type d)" ] || fail "没有生成升级前快照 backups/pre-upgrade-$PREV_VERSION-*"
[ ! -e "$DEPLOY/backups/.ws-upgrade-state" ] || fail "升级成功后状态文件应被清除"
cmp -s "$DEPLOY/docker-compose.yml" "$DEPLOY_SRC/docker-compose.yml" || fail "升级后 compose 文件应与新包一致"
pass "迁移 $old_rev → $new_rev;数据与登录正常;新镜像在跑;.env 补上 WS_SUBNET;快照在、状态文件已清"

echo "== 出口检查"
selftest_scanner
dump_logs "$TMP/compose.log"
assert_no_secrets "升级输出" "$TMP/upgrade.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
assert_no_secrets "安装输出" "$TMP/install.log"
assert_logs_dir_clean
assert_ps_clean
assert_deploy_hygiene
assert_no_xtrace
assert_static_safe

echo "upgrade_from_previous 全部通过"
