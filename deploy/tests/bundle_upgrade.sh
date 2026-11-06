#!/usr/bin/env bash
# 真实离线包走一遍 upgrade.sh:用 build-bundle.sh 打出的 tar.gz(含 .sha256)升级到"同一版本"。
# B 的 upgrade 测试用仓库源码自己重新打包、没有 .sha256,验证不到真实包的归档格式与校验和。
# 需要:WS_TEST_DEPLOY_SRC(解开的离线包目录)、WS_BUNDLE_PKG(同一个包的 tar.gz,旁边有 .sha256)、WS_TEST_VERSION。
# 这个脚本负责"真走离线包里的 docker load":本机不能已有 workstation-app / workstation-web / workstation-stream 镜像,
# 所以 CI 里它必须排在第一个跑(装好后镜像留在本机,后面的测试沿用 WS_INSTALL_SKIP_LOAD=1)。
set -euo pipefail
# shellcheck source=deploy/tests/_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -n "${WS_TEST_DEPLOY_SRC:-}" ] || fail "需要设置 WS_TEST_DEPLOY_SRC(离线包解开的目录)"
[ "$(tr -d '[:space:]' <"$DEPLOY_SRC/VERSION")" = "$VERSION" ] || fail "离线包 VERSION 与 WS_TEST_VERSION($VERSION)不一致"
for img in workstation-app workstation-web workstation-stream; do
  if docker image inspect "$img:$VERSION" >/dev/null 2>&1; then
    fail "本机已有镜像 $img:$VERSION,无法证明是 docker load 载入的;请先 docker image rm 它"
  fi
done
export WS_INSTALL_SKIP_LOAD=0   # 覆盖 _common.sh 的测试开关:install 与 upgrade 都真的 docker load 包里的镜像
[ -f "${WS_BUNDLE_PKG:-}" ] || fail "需要设置 WS_BUNDLE_PKG(离线包 tar.gz 路径)"
[ -f "$WS_BUNDLE_PKG.sha256" ] || fail "离线包旁边没有 .sha256"

echo "== 1/3 从离线包安装"
prepare_deploy_dir
rc=0
run_install "$TMP/install.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install.log" >&2; fail "安装退出码 $rc"; fi
assert_healthz
pass "已安装并健康"

echo "== 2/3 用真实离线包升级(同版本)"
users_before="$(user_count)"
env_sha="$(sha256_of "$DEPLOY/.env")"
rc=0
( cd "$DEPLOY" && WS_INSTALL_SKIP_LOAD=0 ./scripts/upgrade.sh "$WS_BUNDLE_PKG" ) >"$TMP/upgrade.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/upgrade.log" >&2; fail "upgrade.sh 退出码 $rc(期望 0)"; fi
grep -q '离线包校验和通过' "$TMP/upgrade.log" || fail "输出里没有「离线包校验和通过」(.sha256 没被用上?)"
grep -q '载入新镜像' "$TMP/upgrade.log" || fail "升级没有走 docker load 离线包里的镜像"
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "同版本升级不应改动 .env"
[ "$(tr -d '[:space:]' <"$DEPLOY/VERSION")" = "$VERSION" ] || fail "升级后 VERSION 不对"
pass "校验和通过、镜像从包里载入、.env 未变"

echo "== 3/3 升级后可用性与密钥出口"
assert_healthz
assert_login_ok
[ "$(user_count)" = "$users_before" ] || fail "升级后 users 行数变了"
dump_logs "$TMP/compose.log"
assert_no_secrets "升级输出" "$TMP/upgrade.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
assert_deploy_hygiene
echo "bundle_upgrade 全部通过"
