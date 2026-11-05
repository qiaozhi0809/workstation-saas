#!/usr/bin/env bash
# 装两次(Review Focus 1)+ R9:第二次不能重新生成密钥、不能多建用户;缺 .env 但有数据目录时拒绝覆盖。
set -euo pipefail
# shellcheck source=deploy/tests/_common.sh
. "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "== 1/3 第一次安装"
prepare_deploy_dir
rc=0
run_install "$TMP/install1.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install1.log" >&2; fail "第一次安装退出码 $rc"; fi
env_sha="$(sha256_of "$DEPLOY/.env")"
users_before="$(user_count)"
[ "$users_before" = "1" ] || fail "第一次安装后 users 应为 1 行,实际 $users_before"
pass "第一次安装完成(users=1)"

echo "== 2/3 第二次安装"
rc=0
run_install "$TMP/install2.log" || rc=$?
if [ "$rc" -ne 0 ]; then tail -n 20 "$TMP/install2.log" >&2; fail "第二次安装退出码 $rc(期望 0)"; fi
[ "$(sha256_of "$DEPLOY/.env")" = "$env_sha" ] || fail "第二次安装改动了 .env(密钥被重新生成?)"
[ "$(user_count)" = "$users_before" ] || fail "第二次安装后 users 行数变了"
grep -q '已安装' "$TMP/install2.log" || fail "第二次安装的输出里没有「已安装」"
assert_healthz
assert_login_ok
dump_logs "$TMP/compose.log"
assert_no_secrets "第二次安装输出" "$TMP/install2.log"
assert_no_secrets "容器日志" "$TMP/compose.log"
pass ".env 的 sha256 与 users 行数不变,输出含「已安装」,仍可登录,无密钥泄露"

echo "== 3/3 R9:缺 .env 但已有 data/pg 时拒绝覆盖"
D2="$TMP/deploy-no-env"
prepare_deploy_dir "$D2"
mkdir -p "$D2/data/pg"
rc=0
(
  cd "$D2" || exit 1
  WS_COMPOSE_PROJECT="${PROJECT}-r9" \
  WS_INSTALL_SCHOOL_NAME="$SCHOOL_NAME" WS_INSTALL_ADMIN_LOGIN="$ADMIN_LOGIN" \
  WS_INSTALL_ADMIN_PASSWORD="$ADMIN_PW" WS_INSTALL_SITE=localhost WS_INSTALL_TLS=1 \
    ./scripts/install.sh --non-interactive --force
) >"$TMP/r9.log" 2>&1 || rc=$?
[ "$rc" -ne 0 ] || fail "缺 .env 但有 data/pg 时,install.sh 应以非 0 退出"
grep -q '缺少 .env' "$TMP/r9.log" || fail "R9 提示里没有「缺少 .env」"
[ ! -e "$D2/.env" ] || fail "R9 场景下不应生成 .env"
assert_no_secrets "R9 输出" "$TMP/r9.log"
pass "R9:拒绝覆盖,未生成 .env,退出码非 0"

echo "install_twice 全部通过"
