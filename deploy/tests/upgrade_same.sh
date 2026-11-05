#!/usr/bin/env bash
# 升级到"不同版本号"的离线包(同一镜像的另一个标签):先强制备份,WS_VERSION 随之改变,服务保持健康,
# 登录仍可用,配置(除 WS_VERSION)与数据不被覆盖。
set -euo pipefail
# shellcheck source=deploy/tests/_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$ROOT/deploy/prod/scripts/backup.sh" ] \
  || fail "deploy/prod/scripts/backup.sh 不存在(由 Task 7 提供);upgrade.sh 的强制备份依赖它,本测试在 Task 7 完成前无法通过"

echo "== 1/3 安装旧版本并打离线包"
prepare_deploy_dir
start_ps_sampler
NEWV="$VERSION-up"
make_alias_tags "$NEWV"
rc=0
run_install "$TMP/install.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install.log" >&2; fail "安装退出码 $rc"; fi
make_package() {  # $1=输出 tar.gz;包里的 compose 文件末尾加一行注释,用来验证"确实覆盖了"
  local pkg="$TMP/pkgsrc/workstation-deploy-$NEWV"
  rm -rf "$TMP/pkgsrc"
  mkdir -p "$pkg"
  cp -R "$ROOT/deploy/prod/." "$pkg/"
  printf '%s\n' "$NEWV" >"$pkg/VERSION"
  printf '# upgraded-marker\n' >>"$pkg/docker-compose.yml"
  tar -C "$TMP/pkgsrc" -czf "$1" "workstation-deploy-$NEWV"
}
PKG="$TMP/workstation-deploy-$NEWV.tar.gz"
make_package "$PKG"
env_sha="$(sha256_of "$DEPLOY/.env")"
env_rest_sha="$(grep -v '^WS_VERSION=' "$DEPLOY/.env" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; })"
caddy_sha="$(sha256_of "$DEPLOY/Caddyfile")"
users_before="$(user_count)"
backups_before="$(find "$DEPLOY/backups" -name 'ws-backup-*.tar.gz' | wc -l | tr -d ' ')"
pass "旧版本已安装,离线包已生成"

echo "== 2/3 升级"
rc=0
( cd "$DEPLOY" && ./scripts/upgrade.sh "$PKG" ) >"$TMP/upgrade.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/upgrade.log" >&2; fail "upgrade.sh 退出码 $rc(期望 0)"; fi
backups_after="$(find "$DEPLOY/backups" -name 'ws-backup-*.tar.gz' | wc -l | tr -d ' ')"
[ "$backups_after" -gt "$backups_before" ] || fail "升级前没有生成备份"
newest="$(ls -1t "$DEPLOY"/backups/ws-backup-*.tar.gz | head -n 1)"
[ -s "$newest" ] || fail "备份文件为空"
pass "升级前已生成备份"
grep -q 'upgraded-marker' "$DEPLOY/docker-compose.yml" || fail "docker-compose.yml 没有被新包覆盖"
[ "$(env_value WS_VERSION)" = "$NEWV" ] || fail "升级后 .env 的 WS_VERSION 应为 $NEWV,实际 $(env_value WS_VERSION)"
[ "$(sha256_of "$DEPLOY/.env")" != "$env_sha" ] || fail "WS_VERSION 变了,.env 的哈希却没变,不合理"
[ "$(grep -v '^WS_VERSION=' "$DEPLOY/.env" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; })" = "$env_rest_sha" ] \
  || fail "升级改动了 .env 里 WS_VERSION 以外的内容"
[ "$(tr -d '[:space:]' <"$DEPLOY/VERSION")" = "$NEWV" ] || fail "部署目录的 VERSION 没有更新"
[ "$(sha256_of "$DEPLOY/Caddyfile")" = "$caddy_sha" ] || fail "升级改动了 Caddyfile"
pass "compose 文件已覆盖;.env 只有 WS_VERSION 变为新版本;Caddyfile 未动"

echo "== 3/3 升级后可用性与密钥出口"
assert_healthz
assert_login_ok
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q app)")" = "workstation-app:$NEWV" ] \
  || fail "升级后 app 容器没有用新版本标签的镜像"
[ "$(user_count)" = "$users_before" ] || fail "升级后 users 行数变了"
dump_logs "$TMP/compose.log"
assert_no_secrets "升级输出" "$TMP/upgrade.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
assert_no_secrets "安装输出" "$TMP/install.log"
assert_logs_dir_clean
pass "服务健康(新标签镜像)、登录可用、数据未变、无密钥泄露"
selftest_scanner
assert_ps_clean
assert_deploy_hygiene
assert_no_xtrace

echo "upgrade_same 全部通过"
