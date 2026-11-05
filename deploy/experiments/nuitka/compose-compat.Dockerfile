# syntax=docker/dockerfile:1
# 段 G 补测(D-1 / D-8):生产形态的运行镜像,但 app 包换成 Nuitka --module 编译出的 .so。
# 与 deploy/docker/app.Dockerfile 的运行阶段保持一致(同入口脚本、非 root、HEALTHCHECK),
# 这样生产 compose 与 compose_smoke.sh 可以原样使用。仅供评估,不进交付链。
# 构建上下文 = 仓库根目录。
ARG NUITKA_VERSION=4.3.1
ARG NUITKA_JOBS=2

FROM python:3.12-slim AS deps
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy PIP_NO_CACHE_DIR=1
RUN pip install uv==0.13.4 >/dev/null
WORKDIR /src/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --locked --no-dev

FROM deps AS compile-module
ARG NUITKA_VERSION
ARG NUITKA_JOBS
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential patchelf ccache && rm -rf /var/lib/apt/lists/*
RUN uv pip install --python /opt/venv/bin/python "nuitka==${NUITKA_VERSION}" zstandard ordered-set
COPY server/app ./app
ENV PATH=/opt/venv/bin:$PATH PYTHONPATH=/src/server
RUN --mount=type=cache,target=/root/.cache/Nuitka \
    --mount=type=cache,target=/root/.cache/ccache \
    date +%s > /tmp/t0 && \
    python -m nuitka --module app --include-package=app --assume-yes-for-downloads \
      --jobs=${NUITKA_JOBS} --low-memory --output-dir=/out-mod && \
    echo "compile_seconds=$(( $(date +%s) - $(cat /tmp/t0) ))" > /out-mod/compile_time.txt && ls /out-mod

FROM python:3.12-slim
ARG WS_APP_VERSION=0.0.0-dev
ENV WS_APP_VERSION=${WS_APP_VERSION} \
    PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN groupadd --gid 10001 ws \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin ws \
    && mkdir -p /srv/server /var/log/workstation \
    && chown ws:ws /var/log/workstation
COPY --from=deps /opt/venv /opt/venv
WORKDIR /srv/server
# 只放编译后的 .so(没有任何 app 的 .py 源码);迁移脚本本身仍是明文(报告 ④)
COPY --from=compile-module /out-mod/app.*.so ./
COPY --from=compile-module /out-mod/compile_time.txt ./compile_time.txt
# 空目录 app/ 只为满足 compose_smoke.sh 的"镜像里有 /srv/server/app"断言;同一路径下 app.*.so 优先于不含 __init__.py 的目录,导入的仍是 .so
RUN mkdir app
COPY server/migrations ./migrations
COPY server/alembic.ini ./alembic.ini
COPY deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
# 编译成 .so 的 app 不能用 `python -m app.cli`(runpy 取不到 nuitka_module_loader 的代码对象,报告 D-7),
# 改用 python -c 调同一个 main();入口脚本里的调用点替换成这个垫片,其余原样
RUN printf '#!/bin/sh\nexec python -c "from app.cli import main; main()" "$@"\n' > /usr/local/bin/ws-cli \
    && sed -i 's#python -m app.cli#ws-cli#g' /usr/local/bin/entrypoint.sh \
    && chmod 755 /usr/local/bin/entrypoint.sh /usr/local/bin/ws-cli
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/v1/healthz', timeout=3).status == 200 else 1)"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["app"]
