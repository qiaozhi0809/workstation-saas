#!/usr/bin/env bash
# 应用镜像入口:entrypoint.sh <app|scheduler|cli> [参数...]
set -euo pipefail

role="${1:-app}"
[ "$#" -gt 0 ] && shift

case "$role" in
  app)
    # 先迁移(含预检),通过后再起服务;预检不通过时容器退出,不会起半迁移的服务。
    # --log-config(L315):多 worker 的父进程不加载应用,它的几行启动 / 停止日志也按 JSON 行写 stdout
    #(配置文件随 server/app 进镜像,formatter 是 app.logging.JsonLineFormatter;worker 的日志链由应用自己接管)
    python -m app.cli migrate
    exec uvicorn --factory app.main:create_app --host 0.0.0.0 --port 8080 --workers "${WS_WORKERS:-2}" \
      --log-config /srv/server/app/uvicorn-log.json
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
