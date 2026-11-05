# syntax=docker/dockerfile:1
# D13 试验:Nuitka 编译 app 包。构建上下文 = 仓库根目录。
# 目标:baseline(源码版,对照组)/ nuitka(编译版)。仅为评估,不进交付链。
ARG NUITKA_VERSION=4.3.1
ARG NUITKA_JOBS=2

FROM python:3.12-slim AS deps
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy PIP_NO_CACHE_DIR=1
RUN pip install uv==0.9.* >/dev/null
WORKDIR /src/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --locked --no-dev

FROM deps AS compile
ARG NUITKA_VERSION
ARG NUITKA_JOBS
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential patchelf ccache && rm -rf /var/lib/apt/lists/*
RUN uv pip install --python /opt/venv/bin/python "nuitka==${NUITKA_VERSION}" zstandard ordered-set
COPY server/app ./app
COPY server/migrations ./migrations
COPY deploy/experiments/nuitka/run_app.py ./run_app.py
ENV PATH=/opt/venv/bin:$PATH PYTHONPATH=/src/server
RUN --mount=type=cache,target=/root/.cache/Nuitka \
    --mount=type=cache,target=/root/.cache/ccache \
    date +%s > /tmp/t0 && \
    python -m nuitka --standalone --follow-imports --assume-yes-for-downloads \
      --jobs=${NUITKA_JOBS} --low-memory \
      --include-package=app \
      --include-package=uvicorn \
      --include-package=alembic \
      --include-package=psycopg \
      --include-package=sqlalchemy.dialects.postgresql \
      --include-package=structlog \
      --include-package=tzdata \
      --include-package-data=tzdata \
      --include-raw-dir=migrations=migrations \
      --include-data-files=app/seed/dev_seed.sql=app/seed/dev_seed.sql \
      --output-dir=/out --output-filename=ws-app \
      run_app.py && \
    echo "compile_seconds=$(( $(date +%s) - $(cat /tmp/t0) ))" > /out/compile_time.txt

FROM python:3.12-slim AS baseline
ENV PATH=/opt/venv/bin:$PATH PYTHONPATH=/srv/server PYTHONDONTWRITEBYTECODE=1
COPY --from=deps /opt/venv /opt/venv
WORKDIR /srv/server
COPY server/app ./app
COPY server/migrations ./migrations
COPY deploy/experiments/nuitka/run_app.py ./run_app.py
ENTRYPOINT ["python", "/srv/server/run_app.py"]

FROM python:3.12-slim AS nuitka
COPY --from=compile /out/run_app.dist /srv/dist
COPY --from=compile /out/compile_time.txt /srv/compile_time.txt
WORKDIR /srv/dist
ENTRYPOINT ["/srv/dist/ws-app"]

# ---- pytest 冒烟子集:把 app 编成 --module(.so),在不含 app 源码的容器里跑测试 ----
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

FROM python:3.12-slim AS pytest-compiled
ENV UV_PROJECT_ENVIRONMENT=/opt/venv UV_LINK_MODE=copy PIP_NO_CACHE_DIR=1 \
    PATH=/opt/venv/bin:$PATH PYTHONDONTWRITEBYTECODE=1
RUN pip install uv==0.9.* >/dev/null
WORKDIR /w/server
COPY server/pyproject.toml server/uv.lock ./
RUN uv sync --locked
# 只放编译后的 .so、迁移脚本、测试;app/ 目录里只有种子 SQL(没有任何 .py)
COPY --from=compile-module /out-mod/app.*.so ./
COPY server/alembic.ini ./
COPY server/migrations ./migrations
COPY server/tests ./tests
COPY server/app/seed/dev_seed.sql ./app/seed/dev_seed.sql
ENV PYTHONPATH=/w/server
ENTRYPOINT ["python", "-m", "pytest", "-p", "no:cacheprovider"]
