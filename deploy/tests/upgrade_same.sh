#!/usr/bin/env bash
# 升级到"不同版本号"的离线包(同一镜像的另一个标签):先强制备份,WS_VERSION 随之改变,服务保持健康,
# 登录仍可用,配置(除 WS_VERSION)与数据不被覆盖。
set -euo pipefail
# shellcheck source-path=SCRIPTDIR
# shellcheck source=_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

[ -x "$DEPLOY_SRC/scripts/backup.sh" ] \
  || fail "scripts/backup.sh 不存在(由 Task 7 提供);upgrade.sh 的强制备份依赖它,本测试在 Task 7 完成前无法通过"

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
  cp -R "$DEPLOY_SRC/." "$pkg/"
  printf '%s\n' "$NEWV" >"$pkg/VERSION"
  printf '# upgraded-marker\n' >>"$pkg/docker-compose.yml"
  # L198:新包的 Caddyfile.internal 多发一个响应头,升级后生效的 Caddyfile 应被替换、web 重读配置后浏览器能看到它
  awk '{ print } /^\theader [{]$/ { print "\t\tX-Ws-Upgrade-Marker \"1\"" }' "$DEPLOY_SRC/Caddyfile.internal" >"$pkg/Caddyfile.internal"
  grep -q 'X-Ws-Upgrade-Marker' "$pkg/Caddyfile.internal" || fail "测试自身问题:没能把标记头加进 Caddyfile.internal"
  tar -C "$TMP/pkgsrc" -czf "$1" "workstation-deploy-$NEWV"
}
PKG="$TMP/workstation-deploy-$NEWV.tar.gz"
make_package "$PKG"
# 校验和文件用"去掉 .tar.gz 的主干名"命名(upgrade.sh 两种命名都接受;全名那种在 upgrade_precheck_fail 里覆盖)
printf '%s  %s\n' "$(sha256_of "$PKG")" "$(basename "$PKG")" >"$TMP/workstation-deploy-$NEWV.sha256"
# L186:模拟 1.0.0 之前安装的 .env(没有 WS_SUBNET),升级后应按当前网络的子网补上
grep -v '^WS_SUBNET=' "$DEPLOY/.env" >"$TMP/env.nosubnet"
cat "$TMP/env.nosubnet" >"$DEPLOY/.env"
rm -f "$TMP/env.nosubnet"
! grep -q '^WS_SUBNET=' "$DEPLOY/.env" || fail "测试自身问题:WS_SUBNET 没有从 .env 里去掉"
env_sha="$(sha256_of "$DEPLOY/.env")"
env_rest_sha="$(grep -v -e '^WS_VERSION=' -e '^WS_SUBNET=' "$DEPLOY/.env" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; })"
caddy_sha="$(sha256_of "$DEPLOY/Caddyfile")"
users_before="$(user_count)"
backups_before="$(find "$DEPLOY/backups" -name 'ws-backup-*.tar.gz' | wc -l | tr -d ' ')"
pass "旧版本已安装,离线包已生成"

echo "== 2/3 升级"
rc=0
( cd "$DEPLOY" && ./scripts/upgrade.sh "$PKG" ) >"$TMP/upgrade.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/upgrade.log" >&2; fail "upgrade.sh 退出码 $rc(期望 0)"; fi
grep -q '校验和通过' "$TMP/upgrade.log" || fail "升级输出里没有「校验和通过」(主干名命名的 .sha256 没被采用?)"
pass "主干名命名的 .sha256 被识别并核对通过"
backups_after="$(find "$DEPLOY/backups" -name 'ws-backup-*.tar.gz' | wc -l | tr -d ' ')"
[ "$backups_after" -gt "$backups_before" ] || fail "升级前没有生成备份"
newest="$(ls -1t "$DEPLOY"/backups/ws-backup-*.tar.gz | head -n 1)"
[ -s "$newest" ] || fail "备份文件为空"
pass "升级前已生成备份"
grep -q 'upgraded-marker' "$DEPLOY/docker-compose.yml" || fail "docker-compose.yml 没有被新包覆盖"
[ "$(env_value WS_VERSION)" = "$NEWV" ] || fail "升级后 .env 的 WS_VERSION 应为 $NEWV,实际 $(env_value WS_VERSION)"
[ "$(sha256_of "$DEPLOY/.env")" != "$env_sha" ] || fail "WS_VERSION 变了,.env 的哈希却没变,不合理"
[ "$(grep -v -e '^WS_VERSION=' -e '^WS_SUBNET=' "$DEPLOY/.env" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; })" = "$env_rest_sha" ] \
  || fail "升级改动了 .env 里 WS_VERSION / WS_SUBNET 以外的内容"
# L186:老 .env 升级后多出 WS_SUBNET,值等于现网络的子网(不是随便抄 .env.example),且输出里提示了
net_subnet="$(docker network inspect "${PROJECT}_ws-net" -f '{{range .IPAM.Config}}{{.Subnet}}{{end}}')"
[ "$(env_value WS_SUBNET)" = "$net_subnet" ] || fail "升级后 .env 应补上 WS_SUBNET=$net_subnet(当前网络子网),实际「$(env_value WS_SUBNET)」"
grep -q 'WS_SUBNET' "$TMP/upgrade.log" || fail "升级输出里没有提示补上了 WS_SUBNET"
[ "$(tr -d '[:space:]' <"$DEPLOY/VERSION")" = "$NEWV" ] || fail "部署目录的 VERSION 没有更新"
# L198:生效的 Caddyfile 被替换成新包的模板,升级前的那份在快照里,输出有提示
[ "$(sha256_of "$DEPLOY/Caddyfile")" != "$caddy_sha" ] || fail "新包的 Caddyfile.internal 变了,生效的 Caddyfile 却没有更新"
cmp -s "$DEPLOY/Caddyfile" "$DEPLOY/Caddyfile.internal" || fail "升级后生效的 Caddyfile 应等于新包的 Caddyfile.internal"
grep -q 'Caddyfile 已更新' "$TMP/upgrade.log" || fail "升级输出里没有 Caddyfile 更新的提示"
snap_dir="$(find "$DEPLOY/backups" -maxdepth 1 -name "pre-upgrade-$VERSION-*" -type d | head -n 1)"
[ -n "$snap_dir" ] && [ "$(sha256_of "$snap_dir/Caddyfile")" = "$caddy_sha" ] || fail "快照里应保存升级前的 Caddyfile"
pass "compose 文件已覆盖;.env 只有 WS_VERSION 变为新版本、补上 WS_SUBNET=$net_subnet;Caddyfile 更新为新模板,旧的在快照里"

echo "== 3/3 升级后可用性与密钥出口"
assert_healthz
assert_login_ok
assert_services_up
# L198:新 Caddyfile 真的生效(web 重读了配置):响应里有新包加的标记头
hdrs="$(curl -ksS --max-time 10 -o /dev/null -D - "https://localhost:$HTTPS_PORT/")" || fail "取响应头失败"
grep -qi '^x-ws-upgrade-marker: 1' <<<"$hdrs" || fail "升级后响应里没有新 Caddyfile 加的 X-Ws-Upgrade-Marker 头(web 没有重读配置?)"
pass "新 Caddyfile 已生效(响应含 X-Ws-Upgrade-Marker)"
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q app)")" = "workstation-app:$NEWV" ] \
  || fail "升级后 app 容器没有用新版本标签的镜像"
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q scheduler)")" = "workstation-app:$NEWV" ] \
  || fail "升级后 scheduler 容器没有用新版本标签的镜像"
[ "$(docker inspect -f '{{.Config.Image}}' "$(dc ps -q stream-worker)")" = "workstation-stream:$NEWV" ] \
  || fail "升级后 stream-worker 容器没有用新版本标签的镜像"
[ "$(user_count)" = "$users_before" ] || fail "升级后 users 行数变了"
# L199:成功后给出旧镜像的清理命令(不自动删);L179:给出快照目录且状态文件已清
grep -q "docker image rm workstation-app:$VERSION workstation-web:$VERSION workstation-stream:$VERSION" "$TMP/upgrade.log" \
  || fail "升级输出里没有旧镜像清理命令(docker image rm …:$VERSION)"
docker image inspect "workstation-app:$VERSION" >/dev/null 2>&1 || fail "升级不应删除旧版本镜像"
[ -n "$(find "$DEPLOY/backups" -maxdepth 1 -name "pre-upgrade-$VERSION-*" -type d)" ] || fail "没有生成升级前快照 backups/pre-upgrade-$VERSION-*"
[ ! -e "$DEPLOY/backups/.ws-upgrade-state" ] || fail "升级成功后状态文件应被清除"
pass "输出含旧镜像清理命令且旧镜像仍在;升级前快照已保存,状态文件已清除"

echo "== 3b I-1 / L184:root 安装的 systemd 定时器在升级成功后被按新模板与 TZ 重写(需要 systemd 与免密 sudo,没有则跳过)"
# 部署测试不以 root 运行,上面那次升级走的是"非 root 不碰 systemd"分支(/etc/systemd/system 里也不该出现任何东西)。
# 这里分两步证明:(1) upgrade.sh 确实在启动确认(start_and_verify)之后调用 refresh_backup_timer_if_installed;
# (2) 用 sudo 以 root 身份、对同一个部署目录执行该函数:预先放一份"1.0.0 之前写入"的单元(指向本部署目录、OnCalendar 不带时区),
#     执行后单元应被重写为带时区的 02:30 并处于 enabled;指向别的部署目录的单元不被碰。
awk '/start_and_verify "\$HEALTH_TIMEOUT"/ { seen = 1 } seen && /^ *refresh_backup_timer_if_installed/ { found = 1 } END { exit !found }' "$DEPLOY/scripts/upgrade.sh" \
  || fail "upgrade.sh 没有在 start_and_verify 之后调用 refresh_backup_timer_if_installed"
UNIT_DIR=/etc/systemd/system
# 本机已有真实安装的单元时不碰它(开发机上跑测试的情形),只做上面的静态检查
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && sudo -n true 2>/dev/null \
  && [ ! -e "$UNIT_DIR/workstation-backup.timer" ] && [ ! -e "$UNIT_DIR/workstation-backup.service" ]; then
  expect_tz="$(env_value TZ 2>/dev/null || true)"; [ -n "$expect_tz" ] || expect_tz="Asia/Shanghai"
  write_old_units() {  # $1=单元里指向的部署目录
    printf '[Unit]\nDescription=old\n[Service]\nType=oneshot\nWorkingDirectory=%s\nExecStart="%s/scripts/backup.sh"\n' "$1" "$1" \
      | sudo -n tee "$UNIT_DIR/workstation-backup.service" >/dev/null
    printf '[Unit]\nDescription=old timer\n[Timer]\nOnCalendar=*-*-* 02:30:00\nPersistent=true\nUnit=workstation-backup.service\n[Install]\nWantedBy=timers.target\n' \
      | sudo -n tee "$UNIT_DIR/workstation-backup.timer" >/dev/null
  }
  remove_units() {
    sudo -n systemctl disable --now workstation-backup.timer >/dev/null 2>&1 || true
    sudo -n rm -f "$UNIT_DIR/workstation-backup.service" "$UNIT_DIR/workstation-backup.timer"
    sudo -n systemctl daemon-reload >/dev/null 2>&1 || true
  }
  run_refresh() {  # 以 root 在部署目录里 source lib.sh 并调用升级成功后那一步;输出到 $1(日志文件是测试用户的,重定向就该在 sudo 外面)
    # shellcheck disable=SC2024
    sudo -n env WS_COMPOSE_PROJECT="$PROJECT" bash -c 'cd "$1" && . scripts/lib.sh && refresh_backup_timer_if_installed' _ "$DEPLOY" >"$1" 2>&1
  }
  err=""
  # (a) 指向别的部署目录的单元:不动
  write_old_units "/opt/some-other-deploy"
  other_sha="$(sudo -n cat "$UNIT_DIR/workstation-backup.timer" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; })"
  run_refresh "$TMP/timer-refresh-other.log" || err="别的部署的单元存在时函数应静默返回 0"
  [ "$(sudo -n cat "$UNIT_DIR/workstation-backup.timer" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; })" = "$other_sha" ] \
    || err="${err:-指向别的部署目录的单元不应被重写}"
  # (b) 指向本部署目录、不带时区的旧单元:重写为带时区并启用
  if [ -z "$err" ]; then
    write_old_units "$DEPLOY"
    rc=0; run_refresh "$TMP/timer-refresh.log" || rc=$?
    [ "$rc" -eq 0 ] || err="refresh_backup_timer_if_installed 退出码 $rc"
    [ -n "$err" ] || grep -q '重写 systemd 定时备份单元' "$TMP/timer-refresh.log" || err="输出里没有「重写 systemd 定时备份单元」"
    [ -n "$err" ] || sudo -n grep -q "^OnCalendar=\*-\*-\* 02:30:00 $expect_tz\$" "$UNIT_DIR/workstation-backup.timer" \
      || err="重写后的 timer 应含 OnCalendar=*-*-* 02:30:00 $expect_tz,实际:$(sudo -n grep OnCalendar "$UNIT_DIR/workstation-backup.timer" || true)"
    [ -n "$err" ] || sudo -n grep -q "^WorkingDirectory=$DEPLOY\$" "$UNIT_DIR/workstation-backup.service" || err="重写后的 service 应指向本部署目录"
    [ -n "$err" ] || [ "$(systemctl is-enabled workstation-backup.timer 2>/dev/null || true)" = "enabled" ] || err="重写后 workstation-backup.timer 应为 enabled"
  fi
  remove_units
  [ -z "$err" ] || { cat "$TMP/timer-refresh.log" "$TMP/timer-refresh-other.log" 2>/dev/null | tail -n 10 >&2; fail "$err"; }
  pass "root 下升级成功后的定时器重写:本部署的旧单元被改为 OnCalendar 带 $expect_tz 并 enabled;别的部署的单元未动"
else
  echo "  跳过:本机没有 systemd / 免密 sudo,或已有真实的 workstation-backup 单元;只验证了 upgrade.sh 的调用位置"
fi
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
assert_static_safe

echo "upgrade_same 全部通过"
