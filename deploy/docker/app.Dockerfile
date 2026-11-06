# 应用镜像(后端 API 与 scheduler 共用)。构建上下文:仓库根目录。
#   docker build -f deploy/docker/app.Dockerfile --build-arg WS_APP_VERSION=0.7.0 -t workstation-app:0.7.0 .
# 只有构建阶段联网(uv sync);运行阶段不需要外网。

# 基础镜像钉在 Debian 12(bookworm):stream.Dockerfile 在它上面装 Debian 源的 ffmpeg(5.1),
# 转流用到的 -timeout 语义(RTSP 套接字 I/O 超时,微秒)按这个版本校过;不随 python:3.12-slim 的
# 默认发行版漂移(trixie 的 ffmpeg 是 7.x)
# ---- 构建阶段:安装锁定的运行依赖 ----
FROM python:3.12-slim-bookworm AS builder
# 为 1 时走 Nuitka 编译(由 M5a Task 8 实现),默认不走
ARG WS_BUILD_NUITKA=0
ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never \
    PIP_DISABLE_PIP_VERSION_CHECK=1
# uv 固定为 0.13.4(2026-10-20 发布,距 2026-11-05 已满两周的最新版;升级时同样取发布满两周的版本)
RUN pip install --no-cache-dir uv==0.13.4
WORKDIR /build
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --locked --no-dev

# ---- 运行阶段 ----
FROM python:3.12-slim-bookworm
ARG WS_APP_VERSION=0.0.0-dev
ENV WS_APP_VERSION=${WS_APP_VERSION} \
    PATH="/opt/venv/bin:${PATH}" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1
RUN groupadd --gid 10001 ws \
    && useradd --uid 10001 --gid 10001 --no-create-home --shell /usr/sbin/nologin ws \
    && mkdir -p /srv/server /var/log/workstation \
    && chown ws:ws /var/log/workstation
COPY --from=builder /opt/venv /opt/venv
WORKDIR /srv/server
COPY server/app ./app
COPY server/migrations ./migrations
COPY server/alembic.ini ./alembic.ini
COPY deploy/docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod 755 /usr/local/bin/entrypoint.sh
USER 10001:10001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=5s --start-period=60s --retries=5 \
    CMD ["python", "-c", "import urllib.request,sys; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8080/api/v1/healthz', timeout=3).status == 200 else 1)"]
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["app"]
