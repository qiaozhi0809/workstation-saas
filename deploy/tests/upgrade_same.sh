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
  # L313:不复制 images/(镜像已在本机,WS_INSTALL_SKIP_LOAD=1;离线包里的镜像 tar 有上 GB,打进测试包白费 CI 时间)
  ( cd "$DEPLOY_SRC" && tar --exclude='./images' -cf - . ) | ( cd "$pkg" && tar -xf - ) || fail "复制部署源失败"
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
# L310:模拟"新版本去掉了某个服务":在已部署的 compose 里临时加一个服务并起容器,新包的 compose 里没有它,
# 升级重启后它的容器应被清理(start_and_verify 的 --remove-orphans),而不是留下来
awk '{ print } /^services:$/ { print "  ws-orphan-probe:"; print "    image: redis:7-alpine"; print "    command: [\"sleep\", \"3600\"]"; print "    networks: [ws-net]" }' \
  "$DEPLOY/docker-compose.yml" >"$TMP/compose.orphan"
grep -q 'ws-orphan-probe' "$TMP/compose.orphan" || fail "测试自身问题:没能把临时服务加进 compose 文件"
cat "$TMP/compose.orphan" >"$DEPLOY/docker-compose.yml"
rm -f "$TMP/compose.orphan"
dc up -d ws-orphan-probe >"$TMP/orphan-up.log" 2>&1 || { tail -n 10 "$TMP/orphan-up.log" >&2; fail "测试自身问题:起临时服务 ws-orphan-probe 失败"; }
orphan_filter=(--filter "label=com.docker.compose.project=$PROJECT" --filter "label=com.docker.compose.service=ws-orphan-probe")
[ -n "$(docker ps -q "${orphan_filter[@]}")" ] || fail "测试自身问题:临时服务 ws-orphan-probe 的容器没有在运行"
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
# L310:新包的 compose 里没有 ws-orphan-probe,升级重启后它的容器(含已停止的)应已被清理
[ -z "$(docker ps -a -q "${orphan_filter[@]}")" ] || fail "升级后仍残留不在新 compose 里的孤儿容器 ws-orphan-probe(start_and_verify 的 compose up 缺 --remove-orphans)"
pass "升级重启清掉了新 compose 里不存在的服务的容器(--remove-orphans)"
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
# 版本变了 → compose up 已重建 web 容器,新 Caddyfile 随之生效,不应再多重启一次(多一次中断)
! grep -q '重启 web 使其生效' "$TMP/upgrade.log" || fail "版本变化时 web 已被重建,不应再额外 restart web"
pass "新 Caddyfile 已生效(响应含 X-Ws-Upgrade-Marker),且没有多余的 web 重启"
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

echo "== 3b I-1 / L184 / L311:root 安装的 systemd 定时器在升级成功后被按新模板与 TZ 重写(需要 systemd 与免密 sudo,没有则跳过)"
# 部署测试不以 root 运行,上面那次升级走的是"非 root 不碰 systemd"分支(/etc/systemd/system 里也不该出现任何东西)。
# 这里分两步证明:(1) upgrade.sh 确实在启动确认(start_and_verify)之后调用 refresh_backup_timer_if_installed;
# (2) 用 sudo 以 root 身份、对同一个部署目录执行该函数:预先放一份"1.0.0 之前写入"的单元(指向本部署目录、OnCalendar 不带时区),
#     已启用的 → 重写为带时区的 02:30 并仍 enabled;管理员手动停用(disabled)的 → 只重写单元文件、保持 disabled 并提示(L311);
#     指向别的部署目录的单元不被碰。
awk '/start_and_verify "\$HEALTH_TIMEOUT"/ { seen = 1 } seen && /^ *refresh_backup_timer_if_installed/ { found = 1 } END { exit !found }' "$DEPLOY/scripts/upgrade.sh" \
  || fail "upgrade.sh 没有在 start_and_verify 之后调用 refresh_backup_timer_if_installed"
UNIT_DIR=/etc/systemd/system
# 本机已有真实安装的单元时不碰它(开发机上跑测试的情形),只做上面的静态检查
if command -v systemctl >/dev/null 2>&1 && [ -d /run/systemd/system ] && sudo -n true 2>/dev/null \
  && [ ! -e "$UNIT_DIR/workstation-backup.timer" ] && [ ! -e "$UNIT_DIR/workstation-backup.service" ]; then
  expect_tz="$(env_value TZ 2>/dev/null || true)"; [ -n "$expect_tz" ] || expect_tz="Asia/Shanghai"
  write_old_units() {  # $1=单元里指向的部署目录;$2=Description(可选)
    printf '[Unit]\nDescription=%s\n[Service]\nType=oneshot\nWorkingDirectory=%s\nExecStart="%s/scripts/backup.sh"\n' "${2:-old}" "$1" "$1" \
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
  # (a) 指向别的部署目录的单元:不动。Description 里故意写上本部署目录的 backup.sh 路径:识别"是不是本部署的单元"
  #     必须看 ExecStart= 行,不能全文子串匹配(L312)
  write_old_units "/opt/some-other-deploy" "old unit, migrated from $DEPLOY/scripts/backup.sh"
  other_sha="$(sudo -n cat "$UNIT_DIR/workstation-backup.timer" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; })"
  run_refresh "$TMP/timer-refresh-other.log" || err="别的部署的单元存在时函数应静默返回 0"
  [ "$(sudo -n cat "$UNIT_DIR/workstation-backup.timer" | { if command -v sha256sum >/dev/null 2>&1; then sha256sum; else shasum -a 256; fi; })" = "$other_sha" ] \
    || err="${err:-指向别的部署目录的单元不应被重写(即使 Description 里提到本部署目录)}"
  # (b) 指向本部署目录、不带时区、已启用的旧单元(1.0.0 之前的 install.sh 是 enable --now 写入的):重写为带时区并仍 enabled
  if [ -z "$err" ]; then
    write_old_units "$DEPLOY"
    sudo -n systemctl daemon-reload >/dev/null 2>&1 || true
    sudo -n systemctl enable --now workstation-backup.timer >/dev/null 2>&1 || err="测试自身问题:启用旧定时器失败"
    [ -n "$err" ] || [ "$(systemctl is-enabled workstation-backup.timer 2>/dev/null || true)" = "enabled" ] || err="测试自身问题:旧定时器没有处于 enabled"
    rc=0; run_refresh "$TMP/timer-refresh.log" || rc=$?
    [ "$rc" -eq 0 ] || err="refresh_backup_timer_if_installed 退出码 $rc"
    [ -n "$err" ] || grep -q '重写 systemd 定时备份单元' "$TMP/timer-refresh.log" || err="输出里没有「重写 systemd 定时备份单元」"
    [ -n "$err" ] || sudo -n grep -q "^OnCalendar=\*-\*-\* 02:30:00 $expect_tz\$" "$UNIT_DIR/workstation-backup.timer" \
      || err="重写后的 timer 应含 OnCalendar=*-*-* 02:30:00 $expect_tz,实际:$(sudo -n grep OnCalendar "$UNIT_DIR/workstation-backup.timer" || true)"
    [ -n "$err" ] || sudo -n grep -q "^WorkingDirectory=$DEPLOY\$" "$UNIT_DIR/workstation-backup.service" || err="重写后的 service 应指向本部署目录"
    [ -n "$err" ] || [ "$(systemctl is-enabled workstation-backup.timer 2>/dev/null || true)" = "enabled" ] || err="重写后 workstation-backup.timer 应为 enabled"
  fi
  # (b2) L312:.env 的 TZ 拼错(tzdata 里没有)时只告警一次,定时器按 Asia/Shanghai 渲染;之后把 .env 原样放回
  if [ -z "$err" ] && [ -d /usr/share/zoneinfo ]; then
    cp -p "$DEPLOY/.env" "$TMP/env.tzsaved"
    if grep -q '^TZ=' "$DEPLOY/.env"; then
      awk '/^TZ=/ { print "TZ=Asia/Shangai"; next } { print }' "$TMP/env.tzsaved" >"$TMP/env.tzbad"
    else
      { cat "$TMP/env.tzsaved"; printf 'TZ=Asia/Shangai\n'; } >"$TMP/env.tzbad"
    fi
    cat "$TMP/env.tzbad" >"$DEPLOY/.env"
    rc=0; run_refresh "$TMP/timer-refresh-badtz.log" || rc=$?
    cat "$TMP/env.tzsaved" >"$DEPLOY/.env"
    rm -f "$TMP/env.tzsaved" "$TMP/env.tzbad"
    [ "$rc" -eq 0 ] || err="TZ 拼错时 refresh_backup_timer_if_installed 退出码 $rc(应降级为告警并按 Asia/Shanghai 继续)"
    n_warn="$(grep -c 'Asia/Shangai' "$TMP/timer-refresh-badtz.log" || true)"
    [ -n "$err" ] || [ "$n_warn" = "1" ] || err="TZ 拼错的告警应只打一次,实际 $n_warn 次(L312)"
    [ -n "$err" ] || sudo -n grep -q '^OnCalendar=\*-\*-\* 02:30:00 Asia/Shanghai$' "$UNIT_DIR/workstation-backup.timer" \
      || err="TZ 拼错时 timer 应按 Asia/Shanghai 渲染,实际:$(sudo -n grep OnCalendar "$UNIT_DIR/workstation-backup.timer" || true)"
  fi
  # (c) L311:管理员手动停用(systemctl disable)的旧单元:只重写单元文件(时区补上),不 enable --now,输出提示怎样恢复
  if [ -z "$err" ]; then
    remove_units
    write_old_units "$DEPLOY"
    sudo -n systemctl daemon-reload >/dev/null 2>&1 || true
    sudo -n systemctl disable --now workstation-backup.timer >/dev/null 2>&1 || true
    [ "$(systemctl is-enabled workstation-backup.timer 2>/dev/null || true)" = "disabled" ] || err="测试自身问题:旧定时器没有处于 disabled(实际 $(systemctl is-enabled workstation-backup.timer 2>/dev/null || true))"
    rc=0; [ -n "$err" ] || run_refresh "$TMP/timer-refresh-disabled.log" || rc=$?
    [ -n "$err" ] || [ "$rc" -eq 0 ] || err="disabled 分支:refresh_backup_timer_if_installed 退出码 $rc"
    [ -n "$err" ] || grep -q '保持停用' "$TMP/timer-refresh-disabled.log" || err="disabled 分支:输出里没有「保持停用」的提示"
    [ -n "$err" ] || grep -q 'systemctl enable --now workstation-backup.timer' "$TMP/timer-refresh-disabled.log" || err="disabled 分支:输出里没有告诉管理员怎样重新启用"
    [ -n "$err" ] || sudo -n grep -q "^OnCalendar=\*-\*-\* 02:30:00 $expect_tz\$" "$UNIT_DIR/workstation-backup.timer" \
      || err="disabled 分支:单元文件仍应被重写(OnCalendar 带 $expect_tz),实际:$(sudo -n grep OnCalendar "$UNIT_DIR/workstation-backup.timer" || true)"
    [ -n "$err" ] || [ "$(systemctl is-enabled workstation-backup.timer 2>/dev/null || true)" = "disabled" ] \
      || err="disabled 分支:管理员停用的定时器不应被升级重新启用(实际 $(systemctl is-enabled workstation-backup.timer 2>/dev/null || true))"
  fi
  remove_units
  [ -z "$err" ] || { cat "$TMP/timer-refresh.log" "$TMP/timer-refresh-other.log" "$TMP/timer-refresh-badtz.log" "$TMP/timer-refresh-disabled.log" 2>/dev/null | tail -n 15 >&2; fail "$err"; }
  pass "root 下升级成功后的定时器重写:已启用的旧单元改为 OnCalendar 带 $expect_tz 并仍 enabled;TZ 拼错只告警一次;停用的只重写文件、保持 disabled 并提示;别的部署的单元(Description 提到本目录)未动"
else
  echo "  跳过:本机没有 systemd / 免密 sudo,或已有真实的 workstation-backup 单元;只验证了 upgrade.sh 的调用位置"
fi

echo "== 3c I-5 / L198:管理员手工改过的 Caddyfile 在升级时不被替换,新模板另存为 Caddyfile.internal 并提示合并"
# 上面那次升级替换 Caddyfile 的前提是"生效文件 == 升级前的模板"(没手改)。现在手改生效文件,再用模板又变了的新包升级一次
awk '{ print } /^\theader [{]$/ { print "\t\tX-Ws-Admin-Marker \"1\"" }' "$DEPLOY/Caddyfile" >"$TMP/Caddyfile.admin"
grep -q 'X-Ws-Admin-Marker' "$TMP/Caddyfile.admin" || fail "测试自身问题:没能把管理员标记头加进 Caddyfile"
cat "$TMP/Caddyfile.admin" >"$DEPLOY/Caddyfile"
admin_sha="$(sha256_of "$DEPLOY/Caddyfile")"
NEWV2="$VERSION-up2"
make_alias_tags "$NEWV2"
pkg2="$TMP/pkgsrc2/workstation-deploy-$NEWV2"
mkdir -p "$pkg2"
# L313:同上,不复制 images/
( cd "$DEPLOY_SRC" && tar --exclude='./images' -cf - . ) | ( cd "$pkg2" && tar -xf - ) || fail "复制部署源失败"
printf '%s\n' "$NEWV2" >"$pkg2/VERSION"
awk '{ print } /^\theader [{]$/ { print "\t\tX-Ws-Upgrade-Marker \"2\"" }' "$DEPLOY_SRC/Caddyfile.internal" >"$pkg2/Caddyfile.internal"
PKG2="$TMP/workstation-deploy-$NEWV2.tar.gz"
tar -C "$TMP/pkgsrc2" -czf "$PKG2" "workstation-deploy-$NEWV2"
tpl2_sha="$(sha256_of "$pkg2/Caddyfile.internal")"
rc=0
( cd "$DEPLOY" && ./scripts/upgrade.sh "$PKG2" ) >"$TMP/upgrade2.log" 2>&1 || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 30 "$TMP/upgrade2.log" >&2; fail "第二次升级退出码 $rc(期望 0)"; fi
[ "$(sha256_of "$DEPLOY/Caddyfile")" = "$admin_sha" ] || fail "手工改过的 Caddyfile 不应被升级替换"
[ "$(sha256_of "$DEPLOY/Caddyfile.internal")" = "$tpl2_sha" ] || fail "新模板应保存为部署目录的 Caddyfile.internal"
grep -q '手工改过' "$TMP/upgrade2.log" && grep -q '不替换' "$TMP/upgrade2.log" || fail "升级输出应说明 Caddyfile 手工改过、本次不替换"
grep -q 'Caddyfile.internal' "$TMP/upgrade2.log" || fail "升级输出应指出新模板保存在 Caddyfile.internal"
! grep -q 'Caddyfile 已更新' "$TMP/upgrade2.log" || fail "手工改过时不应出现「Caddyfile 已更新」"
[ "$(env_value WS_VERSION)" = "$NEWV2" ] || fail "第二次升级后 WS_VERSION 应为 $NEWV2"
assert_healthz
hdrs="$(curl -ksS --max-time 10 -o /dev/null -D - "https://localhost:$HTTPS_PORT/")" || fail "取响应头失败"
grep -qi '^x-ws-admin-marker: 1' <<<"$hdrs" || fail "升级后响应里应仍有管理员手改的 X-Ws-Admin-Marker 头(手改配置应继续生效)"
! grep -qi '^x-ws-upgrade-marker: 2' <<<"$hdrs" || fail "新模板未被采用,响应里不应出现 X-Ws-Upgrade-Marker: 2"
assert_no_secrets "第二次升级输出" "$TMP/upgrade2.log"
pass "手工改过的 Caddyfile 保持原样并继续生效;新模板另存为 Caddyfile.internal,输出提示手动合并"
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
