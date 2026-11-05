#!/usr/bin/env bash
# D13 试验构建:用 Nuitka 编译 app 包,产出 workstation-app-nuitka:<tag>(及源码对照镜像)。
# 仅供评估(deploy/experiments),不属于交付链。需要本机有 docker。
set -euo pipefail

NUITKA_VERSION="4.3.1"   # PyPI 发布 2026-10-17;2026-11-05 前满两周的最新稳定版(4.3.3/4.3.4 不满两周)
TAG="${WS_TRIAL_TAG:-0.0.0-seg-d}"
JOBS="${WS_NUITKA_JOBS:-2}"   # 同一时刻只跑一个构建,限制编译并行度

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
dockerfile="${root}/deploy/experiments/nuitka/nuitka.Dockerfile"

build() {
  local target="$1" image="$2"
  echo "==> 构建 ${image}(target=${target})"
  docker build --progress=plain \
    -f "${dockerfile}" --target "${target}" \
    --build-arg "NUITKA_VERSION=${NUITKA_VERSION}" \
    --build-arg "NUITKA_JOBS=${JOBS}" \
    -t "${image}" "${root}"
}

build baseline "workstation-app-baseline:${TAG}"
start=$(date +%s)
build nuitka "workstation-app-nuitka:${TAG}"
echo "==> Nuitka 镜像构建总耗时:$(( $(date +%s) - start )) 秒"
