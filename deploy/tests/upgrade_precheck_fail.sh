#!/usr/bin/env bash
# 升级预检不通过(Review Focus 2 / R11):必须退出 2、停在旧版本、旧服务继续可用、不覆盖任何文件。
# 同时覆盖几类"在动任何东西之前就被拒绝"的离线包(路径穿越、符号链接、大版本 0→2、备份失败),
# 以及 0.x → 1.x 这唯一放行的大版本跳跃确实能通过版本检查(守卫 upgrade.sh 的放行逻辑),
# 并用带不同版本号的包验证 WS_VERSION 覆盖确实让预检跑在新镜像上。
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$DEPLOY_SRC/scripts/backup.sh" ] \
  || fail "scripts/backup.sh 不存在(由 Task 7 提供);upgrade.sh 的强制备份依赖它,本测试在 Task 7 完成前无法通过"

echo "== 1/5 安装并制造脏数据"
prepare_deploy_dir
start_ps_sampler
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

NEWV="$VERSION-pre"
make_alias_tags "$NEWV" distinct
# 每次造包:$1=输出路径 $2=版本号;包内容 = deploy/prod + 新 VERSION + compose 末尾标记
build_pkg() {
  local out="$1" ver="$2" src="$TMP/pkgsrc/workstation-deploy-$2"
  rm -rf "$TMP/pkgsrc"
  mkdir -p "$src"
  cp -R "$DEPLOY_SRC/." "$src/"
  printf '%s\n' "$ver" >"$src/VERSION"
  printf '# upgraded-marker\n' >>"$src/docker-compose.yml"
  tar -C "$TMP/pkgsrc" -czf "$out" "workstation-deploy-$ver"
}
# 用 python 造含恶意条目的包($1=输出 $2=kind)
build_evil_pkg() {
  python3 -I - "$1" "$2" "$DEPLOY_SRC" "$VERSION" <<'PY'
import io, os, sys, tarfile
out, kind, src, ver = sys.argv[1:5]
top = "workstation-deploy-" + ver
with tarfile.open(out, "w:gz") as tf:
    for name in ("docker-compose.yml",):
        tf.add(os.path.join(src, name), arcname=top + "/" + name)
    data = (ver + "\n").encode()
    ti = tarfile.TarInfo(top + "/VERSION"); ti.size = len(data); tf.addfile(ti, io.BytesIO(data))
    ti = tarfile.TarInfo(top + "/scripts/x.sh"); ti.size = 0; tf.addfile(ti, io.BytesIO(b""))
    if kind == "traversal":
        data = b"evil"
        ti = tarfile.TarInfo(top + "/../../evil-marker.txt"); ti.size = len(data); tf.addfile(ti, io.BytesIO(data))
    elif kind == "symlink":
        ti = tarfile.TarInfo(top + "/scripts/link"); ti.type = tarfile.SYMTYPE; ti.linkname = "/etc/passwd"; tf.addfile(ti)
    elif kind == "absolute":
        data = b"evil"
        ti = tarfile.TarInfo("/tmp/ws-evil-abs-marker"); ti.size = len(data); tf.addfile(ti, io.BytesIO(data))
PY
}

PKG="$TMP/pkg.tar.gz"
build_pkg "$PKG" "$NEWV"
tree_before="$(tree_hash)"
compose_sha="$(sha256_of "$DEPLOY/docker-compose.yml")"
env_sha="$(sha256_of "$DEPLOY/.env")"
app_cid="$(dc ps -q app)"
backups_n() { find "$DEPLOY/backups" -name 'ws-backup-*.tar.gz' | wc -l | tr -d ' '; }
backups_before="$(backups_n)"

echo "== 2/5 被拒绝的离线包:都应在动任何文件之前停下"
# expect_rejected <说明> <包> <输出里应有的关键词>
expect_rejected() {
  local what="$1" pkg="$2" kw="$3" rc=0
  ( cd "$DEPLOY" && ./scripts/upgrade.sh "$pkg" ) >"$TMP/reject.log" 2>&1 || rc=$?
  [ "$rc" -ne 0 ] || fail "$what:应被拒绝,实际退出码 0"
  [ "$rc" -ne 2 ] || fail "$what:退出码 2 是预检不通过专用,这里应是别的非 0"
  grep -q -- "$kw" "$TMP/reject.log" || { tail -n 8 "$TMP/reject.log" >&2; fail "$what:输出里没有「$kw」"; }
  [ "$(tree_hash)" = "$tree_before" ] || fail "$what:部署目录被改动了"
  [ "$(backups_n)" = "$backups_before" ] || fail "$what:不应在拒绝前做备份"
  assert_no_secrets "$what 的输出" "$TMP/reject.log"
  pass "$what:被拒绝(退出码 $rc),部署目录整树哈希不变"
}
build_evil_pkg "$TMP/evil-traversal.tar.gz" traversal
expect_rejected "路径穿越包(..)" "$TMP/evil-traversal.tar.gz" '不安全的路径'
[ ! -e "$TMP/evil-marker.txt" ] && [ ! -e "$TMP/deploy/evil-marker.txt" ] || fail "路径穿越包写出了文件"
build_evil_pkg "$TMP/evil-absolute.tar.gz" absolute
expect_rejected "绝对路径包" "$TMP/evil-absolute.tar.gz" '不安全的路径'
[ ! -e /tmp/ws-evil-abs-marker ] || { rm -f /tmp/ws-evil-abs-marker; fail "绝对路径包写出了文件"; }
build_evil_pkg "$TMP/evil-symlink.tar.gz" symlink
expect_rejected "含符号链接的包" "$TMP/evil-symlink.tar.gz" '链接或特殊文件'
# 大版本跳跃:当前版本是 0.x($VERSION),0.x → 1.x 是 upgrade.sh 唯一放行的一跳(README 第 9 节),所以"被拒"要用 0 → 2
build_pkg "$TMP/major.tar.gz" "2.0.0"
expect_rejected "大版本升级包(0 → 2)" "$TMP/major.tar.gz" '大版本升级'
# 0 → 1 放行的守卫:同样不带镜像的 1.0.0 包必须通过大版本检查、走到强制备份,再停在"缺少镜像"(WS_INSTALL_SKIP_LOAD=1 不 docker load)。
# 没有这条,放行逻辑被误改回"一律拒绝"时 CI 不会发现,0.7.2 用户将无法升到 1.0.0。
# 它不能复用 expect_rejected:版本检查之后、镜像检查之前有一次强制备份,backups/ 会多一个文件(整树哈希不含 backups/,仍应不变)。
build_pkg "$TMP/major-ok.tar.gz" "1.0.0"
rc=0
( cd "$DEPLOY" && ./scripts/upgrade.sh "$TMP/major-ok.tar.gz" ) >"$TMP/reject.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] && [ "$rc" -ne 2 ] || fail "0 → 1 包(无镜像):应在镜像检查处以非 0(非 2)停下,实际退出码 $rc"
if grep -q '大版本升级' "$TMP/reject.log"; then tail -n 8 "$TMP/reject.log" >&2; fail "0 → 1 包被大版本检查拒绝了:upgrade.sh 应放行 0.x → 1.x"; fi
grep -q '缺少镜像 workstation-app:1.0.0' "$TMP/reject.log" || { tail -n 8 "$TMP/reject.log" >&2; fail "0 → 1 包:输出里没有「缺少镜像 workstation-app:1.0.0」"; }
grep -q '备份完成' "$TMP/reject.log" || fail "0 → 1 包:没有走到强制备份(版本检查之后的步骤没执行?)"
[ "$(backups_n)" = "$((backups_before + 1))" ] || fail "0 → 1 包:强制备份应恰好多出一个备份文件,实际 $(backups_n)(之前 $backups_before)"
[ "$(tree_hash)" = "$tree_before" ] || fail "0 → 1 包:部署目录被改动了(镜像检查失败不应覆盖任何文件)"
[ "$(psql_scalar "SELECT version_num FROM alembic_version")" = "0001" ] || fail "0 → 1 包:数据库被动过"
assert_no_residue
assert_no_secrets "0 → 1 包的输出" "$TMP/reject.log"
backups_before="$(backups_n)"   # 后续"拒绝前不做备份"的断言以此为基准
pass "0 → 1 包(无镜像):通过大版本检查、完成强制备份、停在「缺少镜像」(退出码 $rc),部署目录整树哈希不变"
# 备份失败即停:临时换成一个退出 1 的 backup.sh,测完换回
cp -p "$DEPLOY/scripts/backup.sh" "$TMP/backup.sh.orig"
printf '#!/usr/bin/env bash\nexit 1\n' >"$DEPLOY/scripts/backup.sh"
chmod 755 "$DEPLOY/scripts/backup.sh"
rc=0
tb0="$(date +%s)"
( cd "$DEPLOY" && ./scripts/upgrade.sh "$PKG" ) >"$TMP/reject.log" 2>&1 || rc=$?
sleep 1
tb1="$(date +%s)"
cp -p "$TMP/backup.sh.orig" "$DEPLOY/scripts/backup.sh"
[ "$rc" -ne 0 ] && [ "$rc" -ne 2 ] || fail "备份失败时应以非 0(非 2)退出,实际 $rc"
grep -q '备份失败' "$TMP/reject.log" || fail "备份失败时输出里没有「备份失败」"
[ "$(tree_hash)" = "$tree_before" ] || fail "备份失败后部署目录被改动了"
[ "$(psql_scalar "SELECT version_num FROM alembic_version")" = "0001" ] || fail "备份失败时数据库被动过"
# "没有进入预检"的证据:预检要用 workstation-app 镜像 compose run 起一个一次性容器;这段时间内不应有这样的容器被创建
bcreated="$(docker events --since "$tb0" --until "$tb1" --filter type=container --filter event=create \
  --format '{{.Actor.Attributes.image}}' 2>/dev/null || true)"
if grep -q '^workstation-app:' <<<"$bcreated"; then fail "备份失败后仍创建了 workstation-app 容器(进入了预检?)"; fi
assert_no_secrets "备份失败用例的升级输出" "$TMP/reject.log"
pass "备份失败:升级立即停止,没有覆盖任何文件,没有进入预检(期间没有创建 workstation-app 容器),输出无密钥"

# 校验和不符:两种命名都要生效;都在动任何东西之前被拒绝
mkdir -p "$TMP/cs"
cp "$PKG" "$TMP/cs/workstation-deploy-bad.tar.gz"
BADSUM="$(printf '%064d' 0)"
printf '%s  workstation-deploy-bad.tar.gz\n' "$BADSUM" >"$TMP/cs/workstation-deploy-bad.tar.gz.sha256"
expect_rejected "校验和不符(<包全名>.sha256)" "$TMP/cs/workstation-deploy-bad.tar.gz" '校验和不符'
rm -f "$TMP/cs/workstation-deploy-bad.tar.gz.sha256"
printf '%s  workstation-deploy-bad.tar.gz\n' "$BADSUM" >"$TMP/cs/workstation-deploy-bad.sha256"
expect_rejected "校验和不符(<包名主干>.sha256)" "$TMP/cs/workstation-deploy-bad.tar.gz" '校验和不符'
rm -rf "$TMP/cs"

echo "== 2b 升级运行中被 TERM 打断:不留 .ws-upgrade.* / .stage.* / 锁,部署目录不变"
# 直接后台运行脚本($! 就是脚本进程);等解包临时目录出现(此时正在做强制备份)就发 TERM。
# 脚本在前台子进程(备份)结束后才处理 TERM,随后经 EXIT trap 清理。
"$DEPLOY/scripts/upgrade.sh" "$PKG" >"$TMP/term-upgrade.log" 2>&1 &
upid=$!
w=0
until [ -n "$(find "$DEPLOY" -maxdepth 1 -name '.ws-upgrade.*' | head -n 1)" ]; do
  kill -0 "$upid" 2>/dev/null || break
  w=$((w + 1)); [ "$w" -lt 1200 ] || break
  sleep 0.05
done
kill -TERM "$upid" 2>/dev/null || true
rc=0; wait "$upid" || rc=$?
[ "$rc" -eq 143 ] || { tail -n 10 "$TMP/term-upgrade.log" >&2; fail "升级被 TERM 后退出码应为 143,实际 $rc(测试自身问题:TERM 没有赶在升级结束之前?)"; }
assert_no_residue
[ "$(tree_hash)" = "$tree_before" ] || fail "升级被 TERM 打断后部署目录被改动了"
assert_healthz
assert_no_secrets "被 TERM 打断的升级输出" "$TMP/term-upgrade.log"
pass "升级被 TERM 打断:退出码 143,无临时目录 / 锁残留,部署目录整树哈希不变,服务仍健康"

echo "== 3/5 升级(预期被预检拦下;包的版本号 $NEWV 不同于当前 $VERSION)"
# 全名命名的校验和文件(正确的):应被采用并通过
printf '%s  %s\n' "$(sha256_of "$PKG")" "$(basename "$PKG")" >"$PKG.sha256"
t0="$(date +%s)"
rc=0
( cd "$DEPLOY" && ./scripts/upgrade.sh "$PKG" ) >"$TMP/upgrade.log" 2>&1 || rc=$?
sleep 1
t1="$(date +%s)"
[ "$rc" -eq 2 ] || { tail -n 30 "$TMP/upgrade.log" >&2; fail "upgrade.sh 退出码应为 2,实际 $rc"; }
grep -q '不通过' "$TMP/upgrade.log" || fail "输出里没有预检报告(「不通过」)"
grep -q 'classes_seat_dims\|座位' "$TMP/upgrade.log" || fail "预检报告里没有定位到 classes 座位约束"
grep -q '仍在旧版本' "$TMP/upgrade.log" || fail "输出里没有「系统仍在旧版本」提示"
grep -q '校验和通过' "$TMP/upgrade.log" || fail "输出里没有「校验和通过」(<包全名>.sha256 没被采用?)"
pass "退出码 2,预检报告与旧版本提示都在,<包全名>.sha256 被核对通过"
created="$(docker events --since "$t0" --until "$t1" --filter type=container --filter event=create \
  --format '{{.Actor.Attributes.image}}' 2>/dev/null || true)"
grep -qxF "workstation-app:$NEWV" <<<"$created" \
  || fail "预检的一次性容器没有用新版本镜像 workstation-app:$NEWV(WS_VERSION 覆盖失效?)"
if grep -qxF "workstation-app:$VERSION" <<<"$created"; then
  fail "升级过程中出现了用旧标签 workstation-app:$VERSION 新建的容器"
fi
pass "WS_VERSION 覆盖生效:预检容器用的是 workstation-app:$NEWV"

echo "== 4/5 旧服务继续可用、整个部署目录未被覆盖、数据库仍在 0001"
[ "$(dc ps -q app)" = "$app_cid" ] || fail "app 容器被重建了"
[ "$(docker inspect -f '{{.State.Running}}' "$app_cid")" = "true" ] || fail "app 容器没在运行"
assert_healthz
[ "$(psql_scalar "SELECT version_num FROM alembic_version")" = "0001" ] || fail "alembic_version 不再是 0001:预检失败后数据库被迁移了"
[ "$(sha256_of "$DEPLOY/docker-compose.yml")" = "$compose_sha" ] || fail "docker-compose.yml 被覆盖了"
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail ".env 被改动了"
if grep -q 'upgraded-marker' "$DEPLOY/docker-compose.yml"; then fail "新包的 compose 文件被写进了部署目录"; fi
[ "$(cat "$DEPLOY/VERSION")" = "$VERSION" ] || fail "VERSION 被改动了"
[ "$(tree_hash)" = "$tree_before" ] || fail "部署目录(不含 data/、backups/)整树哈希变了"
pass "app 容器未被重建且在运行、健康;alembic_version=0001;部署目录整树哈希不变"

echo "== 5/5 密钥出口"
selftest_scanner
dump_logs "$TMP/compose.log"
assert_no_secrets "升级输出" "$TMP/upgrade.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
assert_no_secrets "安装输出" "$TMP/install.log"
assert_logs_dir_clean
pass "升级输出与容器日志、data/logs 里没有密钥"
assert_ps_clean
assert_deploy_hygiene
assert_no_xtrace
assert_static_safe

echo "upgrade_precheck_fail 全部通过"
