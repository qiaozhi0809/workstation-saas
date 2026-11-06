#!/usr/bin/env bash
# 升级失败后的回退路径(L179 / L117 / L190):
#   1) 装旧版 → 用"app 起不来"的新版离线包升级 → 覆盖文件后健康检查失败 → 输出里给出 rollback.sh 的回退办法;
#   2) 照着执行 rollback.sh:程序文件、VERSION、.env 的 WS_VERSION 回到旧版,数据库未动则直接起旧版,/healthz 200、用户数不变;
#   3) 再按提示用升级前备份 restore.sh 也能成功(数据库被新版迁移时就得走这一步);
#   4) 升级进行到覆盖阶段时 kill -9(模拟断电)→ 状态文件留下 → 换别的包升级被拒绝并提示 → 不带参数的 rollback.sh 按状态文件回退
#      → 之后正常升级成功、状态文件清除、输出含旧镜像清理提示(L199)。
# 放在 CI 的 deploy-upgrade-path job(只在 main / tag 上跑)。
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$DEPLOY_SRC/scripts/rollback.sh" ] || fail "scripts/rollback.sh 不存在或不可执行"
STATE="$DEPLOY/backups/.ws-upgrade-state"

echo "== 1/6 安装旧版本,造两个新版本包:坏的(app 起不来)与好的"
prepare_deploy_dir
start_ps_sampler
rc=0
run_install "$TMP/install.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install.log" >&2; fail "安装退出码 $rc"; fi
make_marker "回退前"
users_before="$(user_count)"
cp -R "$DEPLOY/scripts" "$TMP/scripts.orig"
compose_sha="$(sha256_of "$DEPLOY/docker-compose.yml")"
caddy_sha="$(sha256_of "$DEPLOY/Caddyfile")"

BADV="$VERSION-rbad"
GOODV="$VERSION-rgood"
make_alias_tags "$BADV"
make_alias_tags "$GOODV"
# 坏镜像:换入口脚本,角色 app 直接退出 1(容器反复重启、健康检查永远不过);cli / scheduler 角色原样转交真正的入口,
# 所以迁移预检照常通过——失败发生在覆盖文件之后的启动阶段,正是回退要覆盖的场景
mkdir -p "$TMP/broken"
cat >"$TMP/broken/entry.sh" <<'SH'
#!/bin/sh
if [ "${1:-app}" = "app" ]; then
  echo "broken-app-for-rollback-test" >&2
  exit 1
fi
exec /usr/local/bin/entrypoint.sh "$@"
SH
printf 'FROM workstation-app:%s\nUSER root\nCOPY entry.sh /usr/local/bin/ws-broken-entry.sh\nRUN chmod 755 /usr/local/bin/ws-broken-entry.sh\nUSER 10001:10001\nENTRYPOINT ["/usr/local/bin/ws-broken-entry.sh"]\nCMD ["app"]\n' "$VERSION" >"$TMP/broken/Dockerfile"
docker build -q -t "workstation-app:$BADV" "$TMP/broken" >/dev/null || fail "造坏的 app 镜像失败"
# make_package <输出 tar.gz> <版本> <标记>:包 = 部署源(不含 images/,镜像已在本机)+ 新 VERSION
# + compose 与 lib.sh 末尾各加一行标记(验证"覆盖了"与"还原了")
make_package() {
  local out="$1" ver="$2" mark="$3" src="$TMP/pkgsrc/workstation-deploy-$2"
  rm -rf "$TMP/pkgsrc"
  mkdir -p "$src"
  ( cd "$DEPLOY_SRC" && tar --exclude='./images' -cf - . ) | ( cd "$src" && tar -xf - ) || fail "复制部署源失败"
  printf '%s\n' "$ver" >"$src/VERSION"
  printf '# %s\n' "$mark" >>"$src/docker-compose.yml"
  printf '# %s\n' "$mark" >>"$src/scripts/lib.sh"
  tar -C "$TMP/pkgsrc" -czf "$out" "workstation-deploy-$ver"
}
PKG_BAD="$TMP/workstation-deploy-$BADV.tar.gz"
PKG_GOOD="$TMP/workstation-deploy-$GOODV.tar.gz"
make_package "$PKG_BAD" "$BADV" "bad-marker"
make_package "$PKG_GOOD" "$GOODV" "good-marker"
pass "旧版本已安装;坏包 $BADV(app 必起不来)与好包 $GOODV 已生成"

echo "== 2/6 用坏包升级:覆盖文件后失败,输出回退办法,快照与状态文件在"
rc=0
( cd "$DEPLOY" && WS_UPGRADE_HEALTH_TIMEOUT=30 ./scripts/upgrade.sh "$PKG_BAD" ) >"$TMP/upgrade-bad.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "坏包升级应失败,实际退出码 0"
[ "$rc" -ne 2 ] || fail "坏包升级不应在预检阶段失败(退出码 2),应在启动阶段"
grep -q '覆盖程序文件之后失败' "$TMP/upgrade-bad.log" || { tail -n 15 "$TMP/upgrade-bad.log" >&2; fail "输出里没有「覆盖程序文件之后失败」"; }
grep -q 'rollback.sh' "$TMP/upgrade-bad.log" || fail "回退办法里没有 rollback.sh"
grep -q 'restore.sh' "$TMP/upgrade-bad.log" || fail "回退办法里没有 restore.sh"
SNAP="$(sed -n 's/^ *1) \.\/scripts\/rollback\.sh \(.*\)$/\1/p' "$TMP/upgrade-bad.log" | head -n 1)"
[ -n "$SNAP" ] && [ -d "$SNAP" ] || fail "没能从输出里取到存在的快照目录(得到「$SNAP」)"
case "$SNAP" in "$DEPLOY"/backups/pre-upgrade-"$VERSION"-*) ;; *) fail "快照目录名应为 backups/pre-upgrade-$VERSION-<时间>,实际 $SNAP" ;; esac
BACKUP="$(sed -n 's/.*\.\/scripts\/restore\.sh \([^ ]*\).*/\1/p' "$TMP/upgrade-bad.log" | head -n 1)"
[ -n "$BACKUP" ] && [ -s "$BACKUP" ] || fail "没能从输出里取到升级前备份文件(得到「$BACKUP」)"
[ -f "$STATE" ] || fail "失败后应留下状态文件 backups/.ws-upgrade-state"
grep -q "^OLD_VERSION=$VERSION\$" "$STATE" || fail "状态文件里的 OLD_VERSION 不对"
grep -q "^NEW_VERSION=$BADV\$" "$STATE" || fail "状态文件里的 NEW_VERSION 不对"
[ "$(ls -ld "$SNAP" | cut -c1-10)" = "drwx------" ] || fail "快照目录权限应为 700"
[ "$(tr -d '[:space:]' <"$SNAP/VERSION")" = "$VERSION" ] || fail "快照里的 VERSION 应是旧版 $VERSION"
grep -q 'bad-marker' "$SNAP/docker-compose.yml" && fail "快照里的 compose 不应是新包的"
cmp -s "$SNAP/scripts/lib.sh" "$TMP/scripts.orig/lib.sh" || fail "快照里的 lib.sh 应与升级前一致"
[ "$(sha256_of "$SNAP/Caddyfile")" = "$caddy_sha" ] || fail "快照里应含升级前生效的 Caddyfile"
# 此刻部署目录已是新版文件
grep -q 'bad-marker' "$DEPLOY/docker-compose.yml" || fail "测试自身问题:部署目录的 compose 没有被坏包覆盖"
[ "$(env_value WS_VERSION)" = "$BADV" ] || fail "测试自身问题:.env 的 WS_VERSION 没有变成 $BADV"
assert_no_secrets "坏包升级输出" "$TMP/upgrade-bad.log"
pass "坏包升级在启动阶段失败(退出码 $rc),回退办法指向快照 $(basename "$SNAP") 与备份 $(basename "$BACKUP"),快照内容是旧版"

echo "== 3/6 照输出执行 rollback.sh:文件与 WS_VERSION 回到旧版,数据库未动,直接起旧版"
rc=0
( cd "$DEPLOY" && ./scripts/rollback.sh "$SNAP" ) >"$TMP/rollback1.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/rollback1.log" >&2; fail "rollback.sh 退出码 $rc(期望 0)"; fi
grep -q '数据库结构未变' "$TMP/rollback1.log" || fail "回退输出里没有「数据库结构未变」"
grep -q '回退完成' "$TMP/rollback1.log" || fail "回退输出里没有「回退完成」"
[ "$(sha256_of "$DEPLOY/docker-compose.yml")" = "$compose_sha" ] || fail "回退后 compose 文件应与升级前一致"
cmp -s "$DEPLOY/scripts/lib.sh" "$TMP/scripts.orig/lib.sh" || fail "回退后 lib.sh 应与升级前一致"
[ "$(tr -d '[:space:]' <"$DEPLOY/VERSION")" = "$VERSION" ] || fail "回退后 VERSION 应为 $VERSION"
[ "$(env_value WS_VERSION)" = "$VERSION" ] || fail "回退后 .env 的 WS_VERSION 应为 $VERSION"
[ ! -e "$STATE" ] || fail "回退后状态文件应被清除"
[ -d "$SNAP" ] || fail "回退不应删除快照目录"
assert_healthz
assert_login_ok
assert_services_up
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q app)")" = "workstation-app:$VERSION" ] || fail "回退后 app 容器应用旧版镜像"
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q web)")" = "workstation-web:$VERSION" ] || fail "回退后 web 容器应用旧版镜像"
[ "$(user_count)" = "$users_before" ] || fail "回退后 users 行数变了"
[ "$(psql_scalar "SELECT note FROM ws_backup_marker WHERE id = 1")" = "备份标识-回退前" ] || fail "回退后标识数据不在"
assert_no_secrets "rollback 输出" "$TMP/rollback1.log"
pass "rollback.sh:文件、VERSION、WS_VERSION 回到 $VERSION,旧版镜像在跑,/healthz 200,用户数与数据不变"

echo "== 4/6 回退办法的第 2 步也能走:用升级前备份 restore.sh"
rc=0
( cd "$DEPLOY" && ./scripts/restore.sh "$BACKUP" --yes ) >"$TMP/restore1.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/restore1.log" >&2; fail "restore.sh 退出码 $rc(期望 0)"; fi
assert_healthz
assert_login_ok
[ "$(user_count)" = "$users_before" ] || fail "恢复后 users 行数变了"
[ "$(psql_scalar "SELECT note FROM ws_backup_marker WHERE id = 1")" = "备份标识-回退前" ] || fail "恢复后标识数据不在"
assert_no_secrets "restore 输出" "$TMP/restore1.log"
pass "升级前备份可用 restore.sh 恢复,服务健康、数据在"

echo "== 5/6 升级进行到覆盖阶段时 kill -9(断电):状态文件留下,换包升级被拒并提示,不带参数的 rollback.sh 回退"
# 用 setsid 起成独立进程组,kill -9 整组:连同它正在跑的 docker compose 子进程一起杀,像断电一样;
# 否则残留的 compose up 会和后面的 rollback.sh 抢同一批容器(没有 setsid 的系统只杀脚本本身)
if command -v setsid >/dev/null 2>&1; then
  setsid "$DEPLOY/scripts/upgrade.sh" "$PKG_BAD" >"$TMP/upgrade-k9.log" 2>&1 &
  upid=$!
  sleep 1
  pgid="$(ps -o pgid= -p "$upid" 2>/dev/null | tr -d ' ')"
  kill_target="-${pgid:-$upid}"
else
  "$DEPLOY/scripts/upgrade.sh" "$PKG_BAD" >"$TMP/upgrade-k9.log" 2>&1 &
  upid=$!
  kill_target="$upid"
fi
w=0
until [ -f "$STATE" ]; do
  kill -0 "$upid" 2>/dev/null || break
  w=$((w + 1)); [ "$w" -lt 3000 ] || break
  sleep 0.2
done
[ -f "$STATE" ] || { tail -n 15 "$TMP/upgrade-k9.log" >&2; fail "测试自身问题:状态文件一直没出现(升级没进入覆盖阶段?)"; }
sleep 2
kill -9 -- "$kill_target" 2>/dev/null || true
wait "$upid" 2>/dev/null || true
[ -f "$STATE" ] || fail "kill -9 之后状态文件应还在(EXIT trap 不会执行)"
[ -d "$DEPLOY/backups/.lock" ] || fail "kill -9 之后锁目录应还在(由下一个脚本接管)"
SNAP2="$(grep '^SNAPSHOT=' "$STATE" | cut -d= -f2-)"
[ -d "$SNAP2" ] || fail "状态文件里的快照目录不存在:$SNAP2"
[ "$SNAP2" != "$SNAP" ] || fail "第二次升级应生成新的快照目录"
# 换一个版本不同的好包:应拒绝,并提示先 rollback.sh 或重跑同一个包;部署目录保持中断时的样子
rc=0
( cd "$DEPLOY" && ./scripts/upgrade.sh "$PKG_GOOD" ) >"$TMP/upgrade-after-k9.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "上次升级中断未处理时,换包升级应被拒绝"
grep -q '上次升级' "$TMP/upgrade-after-k9.log" || { tail -n 10 "$TMP/upgrade-after-k9.log" >&2; fail "输出里没有「上次升级」中断提示"; }
grep -q 'rollback.sh' "$TMP/upgrade-after-k9.log" || fail "中断提示里没有 rollback.sh"
grep -q '接管' "$TMP/upgrade-after-k9.log" || fail "应接管 kill -9 留下的锁(输出里没有「接管」)"
[ -f "$STATE" ] || fail "被拒绝的升级不应清除状态文件"
grep -q 'bad-marker' "$DEPLOY/docker-compose.yml" || fail "被拒绝的升级不应改动部署目录(compose 应仍是坏包的)"
grep -q 'good-marker' "$DEPLOY/docker-compose.yml" && fail "被拒绝的升级把好包的 compose 写进去了"
[ -z "$(find "$DEPLOY" -maxdepth 1 -name '.ws-upgrade.*')" ] || fail "被拒绝的升级应清理掉中断留下的解包目录"
assert_no_secrets "中断后换包升级的输出" "$TMP/upgrade-after-k9.log"
pass "kill -9 后:状态文件与锁留下;换包升级被拒(提示先 rollback.sh),部署目录未动,解包残留被清理"
rc=0
( cd "$DEPLOY" && ./scripts/rollback.sh ) >"$TMP/rollback2.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/rollback2.log" >&2; fail "不带参数的 rollback.sh 退出码 $rc(期望 0)"; fi
grep -q '按状态文件回退' "$TMP/rollback2.log" || fail "不带参数时应按状态文件回退"
[ ! -e "$STATE" ] || fail "回退后状态文件应被清除"
[ "$(sha256_of "$DEPLOY/docker-compose.yml")" = "$compose_sha" ] || fail "回退后 compose 文件应与升级前一致"
[ "$(tr -d '[:space:]' <"$DEPLOY/VERSION")" = "$VERSION" ] || fail "回退后 VERSION 应为 $VERSION"
[ "$(env_value WS_VERSION)" = "$VERSION" ] || fail "回退后 .env 的 WS_VERSION 应为 $VERSION"
assert_healthz
assert_login_ok
assert_services_up
[ "$(user_count)" = "$users_before" ] || fail "回退后 users 行数变了"
assert_no_secrets "rollback(无参数)输出" "$TMP/rollback2.log"
pass "不带参数的 rollback.sh 按状态文件回到 $VERSION,服务健康"

echo "== 6/6 中断处置之后正常升级成功;状态文件清除;输出含旧镜像清理提示"
rc=0
( cd "$DEPLOY" && ./scripts/upgrade.sh "$PKG_GOOD" ) >"$TMP/upgrade-good.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/upgrade-good.log" >&2; fail "好包升级退出码 $rc(期望 0)"; fi
[ ! -e "$STATE" ] || fail "升级成功后状态文件应被清除"
grep -q 'good-marker' "$DEPLOY/docker-compose.yml" || fail "好包的 compose 没有生效"
grep -q 'good-marker' "$DEPLOY/scripts/lib.sh" || fail "好包的 lib.sh 没有生效"
[ "$(env_value WS_VERSION)" = "$GOODV" ] || fail "升级后 .env 的 WS_VERSION 应为 $GOODV"
grep -q '升级前快照' "$TMP/upgrade-good.log" || fail "成功输出里没有「升级前快照」"
grep -q "docker image rm workstation-app:$VERSION" "$TMP/upgrade-good.log" || fail "成功输出里没有旧镜像清理命令(L199)"
[ "$(find "$DEPLOY/backups" -maxdepth 1 -name "pre-upgrade-$VERSION-*" -type d | wc -l | tr -d ' ')" = "3" ] \
  || fail "应有 3 个旧版快照目录(两次失败 + 一次成功),实际 $(find "$DEPLOY/backups" -maxdepth 1 -name 'pre-upgrade-*' -type d | wc -l | tr -d ' ')"
assert_healthz
assert_login_ok
assert_services_up
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q app)")" = "workstation-app:$GOODV" ] || fail "升级后 app 容器应用 $GOODV 镜像"
[ "$(user_count)" = "$users_before" ] || fail "升级后 users 行数变了"
pass "中断处置后正常升级到 $GOODV 成功,状态文件已清除,3 个快照目录保留"

echo "== 出口检查"
selftest_scanner
dump_logs "$TMP/compose.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
assert_no_secrets "好包升级输出" "$TMP/upgrade-good.log"
assert_no_secrets "安装输出" "$TMP/install.log"
assert_logs_dir_clean
assert_ps_clean
assert_deploy_hygiene
assert_no_xtrace
assert_static_safe

echo "upgrade_rollback 全部通过"
