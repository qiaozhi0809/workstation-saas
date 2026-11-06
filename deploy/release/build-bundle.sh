#!/usr/bin/env bash
# 构建离线部署包:
#   deploy/release/build-bundle.sh <版本> [--allow-dirty]      例:0.7.0 / 0.7.0-rc.1 / 0.0.0-ci
# 产物:dist/workstation-deploy-<版本>.tar.gz 与同名 .sha256
# 步骤:构建 app / web / stream 镜像 → 拉取 postgres / redis → docker save 五个镜像 → 按契约组装部署目录 → 打包。
# 需要联网(拉基础镜像、npm ci、uv sync);产物本身安装时不需要联网。
# 包里的 BUILD_INFO 记录 VERSION、COMMIT(40 位 git sha)、BUILT_AT(L122 / L189):正式打包要求工作区干净(没有未提交改动),
# 否则拒绝;--allow-dirty 只给本机试验用,会在 BUILD_INFO 里记 DIRTY=1。
# 可用环境变量:
#   WS_BUNDLE_SKIP_PULL=1  不 docker pull postgres / redis(要求它们已在本机;只用于本机重复构建)
#   WS_BUNDLE_PLATFORM     目标平台,默认 linux/amd64(学校服务器是 x86_64 Ubuntu;在 Apple 芯片的 Mac 上打包时
#                          靠模拟构建,较慢,但不会打出 arm64 的包)
# 兼容 macOS(bash 3.2、BSD tar)与 Ubuntu(GNU tar)。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# 新增第三方镜像时:在这里追加一行,并同步 compose 与 bundle_smoke.sh
THIRD_PARTY_IMAGES="postgres:16-alpine redis:7-alpine"

die() { echo "错误:$1" >&2; exit 1; }
info() { echo "== $1"; }

VERSION=""
ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --allow-dirty) ALLOW_DIRTY=1 ;;
    -h|--help) echo "用法:$0 <版本> [--allow-dirty](如 0.7.0、0.7.0-rc.1、0.0.0-ci)"; exit 0 ;;
    -*) die "不认识的参数:$arg(用法:$0 <版本> [--allow-dirty])" ;;
    *) [ -z "$VERSION" ] || die "只能给一个版本号"; VERSION="$arg" ;;
  esac
done
[ -n "$VERSION" ] || die "用法:$0 <版本> [--allow-dirty](如 0.7.0、0.7.0-rc.1)"
# 用 [[ =~ ]] 而不是 grep:grep 按行匹配,带换行的参数会蒙混过关
VERSION_RE='^[0-9]+\.[0-9]+\.[0-9]+(-(rc\.[0-9]+|ci))?$'
[[ "$VERSION" =~ $VERSION_RE ]] || die "版本号格式不对:$VERSION(应为 1.2.3、1.2.3-rc.1 或 1.2.3-ci)"
command -v docker >/dev/null 2>&1 || die "找不到 docker"
docker info >/dev/null 2>&1 || die "docker 没有运行或当前用户无权使用"

# L122:正式包必须能追溯到一个提交。不是 git 仓库或有未提交改动 → 拒绝(--allow-dirty 放行并记录)
COMMIT="unknown"
DIRTY=0
if git -C "$ROOT" rev-parse --verify HEAD >/dev/null 2>&1; then
  COMMIT="$(git -C "$ROOT" rev-parse --verify HEAD)"
  if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=no 2>/dev/null)" ]; then
    DIRTY=1
    [ "$ALLOW_DIRTY" -eq 1 ] || die "工作区有未提交的改动,正式打包必须基于一个提交(git status 查看);本机试验可加 --allow-dirty"
    echo "警告:工作区不干净,按 --allow-dirty 继续,BUILD_INFO 里记 DIRTY=1" >&2
  fi
else
  [ "$ALLOW_DIRTY" -eq 1 ] || die "$ROOT 不是 git 仓库,无法记录提交号;本机试验可加 --allow-dirty"
  echo "警告:不是 git 仓库,BUILD_INFO 里 COMMIT=unknown" >&2
fi

# docker save --platform 需要服务端 API 1.48(Docker 28)以上,Ubuntu 仓库的 docker.io 可能没有(L189):
# 客户端认识该参数且服务端够新才带上;否则不带——bundle_smoke.sh 会核对包里五个镜像的架构,打错平台照样会被拦下
api_ge() {  # <实际 API 版本> <要求的版本>:实际 ≥ 要求 返回 0
  local a1 a2 b1 b2
  a1="${1%%.*}"; a2="${1#*.}"; b1="${2%%.*}"; b2="${2#*.}"
  case "$a1$a2" in ''|*[!0-9]*) return 1 ;; esac
  [ "$a1" -gt "$b1" ] || { [ "$a1" -eq "$b1" ] && [ "$a2" -ge "$b2" ]; }
}
SAVE_ARGS=()
if docker save --help 2>/dev/null | grep -q -- '--platform' && api_ge "$(docker version --format '{{.Server.APIVersion}}' 2>/dev/null || true)" 1.48; then
  SAVE_ARGS=(--platform "${WS_BUNDLE_PLATFORM:-linux/amd64}")
else
  echo "提示:本机 docker 不支持 docker save --platform,按镜像本身保存(bundle_smoke 会核对架构)" >&2
fi

NAME="workstation-deploy-$VERSION"
DIST="$ROOT/dist"
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/ws-bundle.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
D="$STAGE/$NAME"
PLATFORM="${WS_BUNDLE_PLATFORM:-linux/amd64}"
APP_IMG="workstation-app:$VERSION"
WEB_IMG="workstation-web:$VERSION"
STREAM_IMG="workstation-stream:$VERSION"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi
}

info "1/5 构建镜像 $APP_IMG、$WEB_IMG、$STREAM_IMG"
docker build --platform "$PLATFORM" -f "$ROOT/deploy/docker/app.Dockerfile" --build-arg "WS_APP_VERSION=$VERSION" -t "$APP_IMG" "$ROOT"
docker build --platform "$PLATFORM" -f "$ROOT/deploy/docker/web.Dockerfile" -t "$WEB_IMG" "$ROOT"
# 转流镜像 = 刚构建的应用镜像 + ffmpeg(同一平台)
docker build --platform "$PLATFORM" -f "$ROOT/deploy/docker/stream.Dockerfile" --build-arg "APP_IMAGE=$APP_IMG" -t "$STREAM_IMG" "$ROOT"

info "2/5 准备第三方镜像:$THIRD_PARTY_IMAGES"
for img in $THIRD_PARTY_IMAGES; do
  if [ "${WS_BUNDLE_SKIP_PULL:-0}" = "1" ]; then
    docker image inspect "$img" >/dev/null 2>&1 || die "WS_BUNDLE_SKIP_PULL=1 但本机没有 $img"
    [ "$(docker image inspect -f '{{.Architecture}}' "$img")" = "${PLATFORM#*/}" ] || die "本机的 $img 不是 $PLATFORM,请去掉 WS_BUNDLE_SKIP_PULL 重新拉取"
  else
    docker pull --platform "$PLATFORM" "$img"
  fi
done

info "3/5 组装部署目录 $NAME"
mkdir -p "$D/images" "$D/scripts" "$D/systemd"
printf '%s\n' "$VERSION" >"$D/VERSION"
{
  printf 'VERSION=%s\n' "$VERSION"
  printf 'COMMIT=%s\n' "$COMMIT"
  printf 'BUILT_AT=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  [ "$DIRTY" -eq 0 ] || printf 'DIRTY=1\n'
} >"$D/BUILD_INFO"
cp "$ROOT/deploy/prod/docker-compose.yml" "$ROOT/deploy/prod/.env.example" "$D/"
cp "$ROOT"/deploy/prod/Caddyfile.internal "$ROOT"/deploy/prod/Caddyfile.custom "$ROOT"/deploy/prod/Caddyfile.acme "$D/"
cp "$ROOT"/deploy/prod/scripts/*.sh "$D/scripts/"
cp "$ROOT"/deploy/prod/systemd/workstation-backup.service "$ROOT"/deploy/prod/systemd/workstation-backup.timer "$D/systemd/"
cp "$ROOT/deploy/README.md" "$D/README.md"
chmod 755 "$D"/scripts/*.sh
chmod 644 "$D/VERSION" "$D/BUILD_INFO" "$D/docker-compose.yml" "$D/.env.example" "$D"/Caddyfile.* "$D/README.md" "$D"/systemd/*

info "4/5 docker save(可能需要几分钟)"
# shellcheck disable=SC2086  # THIRD_PARTY_IMAGES 是空格分隔的镜像名,需要拆开
docker save ${SAVE_ARGS[@]+"${SAVE_ARGS[@]}"} -o "$D/images/workstation-images-$VERSION.tar" "$APP_IMG" "$WEB_IMG" "$STREAM_IMG" $THIRD_PARTY_IMAGES
chmod 644 "$D/images/workstation-images-$VERSION.tar"

info "5/5 打包并生成 sha256"
mkdir -p "$DIST"
OUT="$DIST/$NAME.tar.gz"
rm -f "$OUT" "$OUT.sha256"
# macOS 的 tar 会塞 ._ 元数据文件,关掉;GNU tar 额外固定顺序与属主,让同一份输入尽量得到同一份目录结构
export COPYFILE_DISABLE=1
# 不用 `tar --version | grep -q`:管道里 grep 提前退出会让 tar 收到 SIGPIPE
TAR_VER="$(tar --version 2>/dev/null || true)"
case "$TAR_VER" in
  *"GNU tar"*) tar -C "$STAGE" --sort=name --owner=0 --group=0 --numeric-owner -cf - "$NAME" | gzip -n >"$OUT" ;;
  # bsdtar:不带 xattr / ACL / macOS 元数据(否则 Ubuntu 解包会警告 unknown extended header)
  *) tar -C "$STAGE" --uid 0 --gid 0 --no-xattrs --no-acls --no-mac-metadata -cf - "$NAME" | gzip -n >"$OUT" ;;
esac
printf '%s  %s\n' "$(sha256_of "$OUT")" "$NAME.tar.gz" >"$OUT.sha256"

echo "完成:$OUT"
echo "      $OUT.sha256"
