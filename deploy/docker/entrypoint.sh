#!/usr/bin/env bash
# 应用镜像入口:entrypoint.sh <app|scheduler|cli> [参数...]
set -euo pipefail

role="${1:-app}"
[ "$#" -gt 0 ] && shift

case "$role" in
  app)
    # 先迁移(含预检),通过后再起服务;预检不通过时容器退出,不会起半迁移的服务
    python -m app.cli migrate
    exec uvicorn --factory app.main:create_app --host 0.0.0.0 --port 8080 --workers "${WS_WORKERS:-2}"
    ;;
  scheduler)
    exec python -m app.cli scheduler
    ;;
  cli)
    exec python -m app.cli "$@"
    ;;
  *)
    echo "未知角色:$role(可用:app、scheduler、cli)" >&2
    exit 64
    ;;
esac
