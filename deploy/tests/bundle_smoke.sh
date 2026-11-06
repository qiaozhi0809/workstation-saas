#!/usr/bin/env bash
# 离线包冒烟:校验 dist/workstation-deploy-<版本>.tar.gz 的完整性与内容(不起任何容器)。
# 用法:deploy/tests/bundle_smoke.sh <版本> [离线包路径]
#   版本     如 0.7.0 / 0.7.0-rc.1 / 0.0.0-ci
#   路径     默认 <仓库>/dist/workstation-deploy-<版本>.tar.gz;同目录要有同名 .sha256
# 兼容 macOS(bash 3.2、BSD 工具)与 Ubuntu。
set -euo pipefail

fail() { echo "  失败:$1" >&2; exit 1; }
pass() { echo "  通过:$1"; }

[ "$#" -ge 1 ] || { echo "用法:$0 <版本> [离线包路径]" >&2; exit 1; }
VERSION="$1"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PKG="${2:-$ROOT/dist/workstation-deploy-$VERSION.tar.gz}"
NAME="workstation-deploy-$VERSION"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

TMP="$(mktemp -d "${TMPDIR:-/tmp}/ws-bundlesmoke.XXXXXX")"
trap 'rm -rf "$TMP"' EXIT

echo "== 1/5 校验和"
[ -f "$PKG" ] || fail "找不到离线包 $PKG"
[ -f "$PKG.sha256" ] || fail "找不到 $(basename "$PKG").sha256"
want="$(awk 'NR==1 {print $1}' "$PKG.sha256")"
[ "$want" = "$(sha256_of "$PKG")" ] || fail "sha256 与离线包不符"
[ "$(awk 'NR==1 {print $2}' "$PKG.sha256")" = "$(basename "$PKG")" ] || fail ".sha256 里的文件名应为 $(basename "$PKG")"
pass "sha256 与文件名都对"

echo "== 2/5 归档结构(与 upgrade.sh 的安全检查一致)"
# 先把清单读进变量再检查:tar 失败要能发现,管道里 grep -q 提前退出也不会让检查静默通过
list="$(tar -tzf "$PKG")" || fail "离线包无法读取"
vlist="$(tar -tvzf "$PKG")" || fail "离线包无法读取(-tv)"
if printf '%s\n' "$list" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then fail "含绝对路径或 .."; fi
if printf '%s\n' "$vlist" | grep -Evq '^[-d]'; then fail "含符号链接、硬链接或特殊文件"; fi
tops="$(printf '%s\n' "$list" | sed 's#^\./##' | awk -F/ 'NF > 0 && $1 != "" { print $1 }' | sort -u)"
[ "$tops" = "$NAME" ] || fail "顶层应只有目录 $NAME,实际:$tops"
if printf '%s\n' "$list" | grep -Eq '(^|/)\._'; then fail "含 macOS 的 ._ 元数据文件"; fi
pass "顶层只有 $NAME,无链接、无 ._ 文件"

echo "== 3/5 解包并核对契约里的全部文件"
tar -xzf "$PKG" -C "$TMP"
D="$TMP/$NAME"
for f in VERSION docker-compose.yml .env.example Caddyfile.internal Caddyfile.custom Caddyfile.acme README.md \
  "images/workstation-images-$VERSION.tar" \
  scripts/lib.sh scripts/install.sh scripts/backup.sh scripts/restore.sh scripts/upgrade.sh scripts/diagnose.sh \
  systemd/workstation-backup.service systemd/workstation-backup.timer; do
  [ -s "$D/$f" ] || fail "缺少或为空:$f"
done
[ "$(tr -d '[:space:]' <"$D/VERSION")" = "$VERSION" ] || fail "VERSION 文件内容不是 $VERSION"
for f in scripts/install.sh scripts/backup.sh scripts/restore.sh scripts/upgrade.sh scripts/diagnose.sh; do
  [ -x "$D/$f" ] || fail "$f 没有可执行权限"
  bash -n "$D/$f" || fail "$f 语法检查失败"
done
bash -n "$D/scripts/lib.sh" || fail "lib.sh 语法检查失败"
# 内容必须与仓库源文件逐个一致(防止拷错来源、拷了旧文件)
cmp -s "$D/README.md" "$ROOT/deploy/README.md" || fail "README.md 与 deploy/README.md 不一致"
for f in docker-compose.yml .env.example Caddyfile.internal Caddyfile.custom Caddyfile.acme; do
  cmp -s "$D/$f" "$ROOT/deploy/prod/$f" || fail "$f 与 deploy/prod/$f 不一致"
done
for f in "$ROOT"/deploy/prod/scripts/*.sh "$ROOT"/deploy/prod/systemd/*; do
  rel="${f#"$ROOT"/deploy/prod/}"
  cmp -s "$D/$rel" "$f" || fail "$rel 与 deploy/prod/$rel 不一致"
done
# 文件清单与契约完全相等,不许多出文件
actual="$(cd "$D" && find . -type f | LC_ALL=C sort)"
expected="$(printf '%s\n' ./VERSION ./docker-compose.yml ./.env.example ./Caddyfile.internal ./Caddyfile.custom ./Caddyfile.acme ./README.md \
  "./images/workstation-images-$VERSION.tar" ./scripts/lib.sh ./scripts/install.sh ./scripts/backup.sh ./scripts/restore.sh \
  ./scripts/upgrade.sh ./scripts/diagnose.sh ./systemd/workstation-backup.service ./systemd/workstation-backup.timer | LC_ALL=C sort)"
[ "$actual" = "$expected" ] || fail "文件清单与契约不一致:$(printf '%s\n' "$actual" | LC_ALL=C comm -3 - <(printf '%s\n' "$expected") | tr '\n' ' ')"
pass "契约文件齐全且无多余文件,内容与仓库一致,VERSION 对,脚本可执行且语法正确"

echo "== 4/5 不含密钥与运行时产物"
extra="$(cd "$D" && find . \( -name '.env' -o -name 'Caddyfile' -o -path './data' -o -path './backups' -o -path './certs' -o -path './dist' -o -name '.git' \) -print)"
[ -z "$extra" ] || fail "离线包里不该有这些运行时文件:$extra"
if grep -E '^(WS_JWT_SECRET|WS_MASTER_KEY|POSTGRES_PASSWORD)=.+' "$D/.env.example" >/dev/null; then
  fail ".env.example 里的密钥必须留空"
fi
pass "没有 .env / data / backups / certs,.env.example 密钥为空"

echo "== 5/5 镜像包里的五个镜像"
imgtar="$D/images/workstation-images-$VERSION.tar"
manifest="$TMP/image-manifest.json"
tar -xOf "$imgtar" manifest.json >"$manifest" || fail "镜像包里没有 manifest.json(不是 docker save 的产物?)"
for tag in "workstation-app:$VERSION" "workstation-web:$VERSION" "workstation-stream:$VERSION" "postgres:16-alpine" "redis:7-alpine"; do
  grep -qF "\"$tag\"" "$manifest" || fail "镜像包里没有 $tag"
done
# compose 里引用的镜像必须都在包里
for img in postgres:16-alpine redis:7-alpine; do
  grep -qE "image: $img\$" "$D/docker-compose.yml" || fail "compose 里没有引用 $img,镜像清单需要同步"
done
# 学校服务器是 x86_64:五个镜像的 config 都必须是目标架构(默认 amd64),在 Apple 芯片上打包最容易打错
ARCH="${WS_BUNDLE_ARCH:-amd64}"
tar -xf "$imgtar" -C "$TMP" manifest.json
python3 -I - "$imgtar" "$ARCH" <<'PY' || fail "镜像架构不是 $ARCH"
import json, sys, tarfile
path, want = sys.argv[1:3]
with tarfile.open(path) as tf:
    manifest = json.load(tf.extractfile("manifest.json"))
    for entry in manifest:
        cfg = json.load(tf.extractfile(entry["Config"]))
        if cfg.get("architecture") != want or cfg.get("os") != "linux":
            print("镜像 %s 是 %s/%s" % (entry.get("RepoTags"), cfg.get("os"), cfg.get("architecture")), file=sys.stderr)
            sys.exit(1)
    if not manifest:
        sys.exit(1)
PY
pass "镜像包含 workstation-app / workstation-web / workstation-stream / postgres:16-alpine / redis:7-alpine,且都是 linux/$ARCH"

echo "bundle_smoke 全部通过"
