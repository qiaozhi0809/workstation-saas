# D13 试验:Nuitka 编译 `app` 包

**仅供评估,不在交付链里。** 结论与数据见
[`docs/superpowers/plans/2026-11-05-D13-源码保护评估.md`](../../../docs/superpowers/plans/2026-11-05-D13-源码保护评估.md)。

## 文件

| 文件 | 作用 |
|---|---|
| `build.sh` | 构建源码对照镜像 `workstation-app-baseline:<tag>` 与编译镜像 `workstation-app-nuitka:<tag>`(默认 tag `0.0.0-seg-d`) |
| `nuitka.Dockerfile` | 多阶段:`baseline`(源码版)、`nuitka`(`--standalone` 编译版)、`pytest-compiled`(把 `app` 编成 `--module` 的 `.so`,在不含 `app` 源码的容器里跑 pytest) |
| `nuitka.Dockerfile.dockerignore` | BuildKit 每个 Dockerfile 一个忽略文件(只放行构建需要的目录) |
| `run_app.py` | 两个镜像共用的入口:`serve`(默认)/ `migrate` / `seed` |
| `smoke.sh`、`smoke.compose.yml`、`bench.py` | 最小冒烟:postgres + redis + 待测镜像,查 `/healthz` 与登录,测启动时间与 p50 |

## 版本

Nuitka 写死 **4.3.1**(PyPI 发布 2026-10-17;2026-11-05 之前满两周的最新稳定版。4.3.3 于 10-29、4.3.4 于 11-01 发布,均不满两周)。
构建时 Nuitka 会提示"older than the latest stable release",属预期。

## 用法

```bash
# 1. 构建(一次只跑一个构建;--jobs 默认 2,可用 WS_NUITKA_JOBS 改)
deploy/experiments/nuitka/build.sh

# 2. 最小冒烟 + p50(端口 15514 / 16514 / 8254,结束时自动 down -v)
deploy/experiments/nuitka/smoke.sh workstation-app-nuitka:0.0.0-seg-d 200
deploy/experiments/nuitka/smoke.sh workstation-app-baseline:0.0.0-seg-d 200

# 3. 对编译后的 app 跑 pytest 冒烟子集(需要挂 docker.sock,testcontainers 要连宿主机端口)
docker build -f deploy/experiments/nuitka/nuitka.Dockerfile --target pytest-compiled \
  --build-arg NUITKA_JOBS=2 -t workstation-app-nuitka-pytest:0.0.0-seg-d .
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
  -e TESTCONTAINERS_HOST_OVERRIDE=host.docker.internal -e TESTCONTAINERS_RYUK_DISABLED=true \
  --add-host host.docker.internal:host-gateway \
  workstation-app-nuitka-pytest:0.0.0-seg-d tests/test_auth.py tests/test_classroom.py tests/test_notices.py -q

# 4. 清理
docker image rm workstation-app-nuitka:0.0.0-seg-d workstation-app-baseline:0.0.0-seg-d \
  workstation-app-nuitka-pytest:0.0.0-seg-d
```

冒烟只用开发种子(`WS_ENV=dev`,虚构数据与示例密码),不含任何真实密钥。
