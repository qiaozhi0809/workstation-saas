# 转流 worker 镜像 = 应用镜像 + ffmpeg。构建上下文:仓库根目录(与 app.Dockerfile 相同)。
#   docker build -f deploy/docker/app.Dockerfile --build-arg WS_APP_VERSION=0.7.2 -t workstation-app:0.7.2 .
#   docker build -f deploy/docker/stream.Dockerfile --build-arg APP_IMAGE=workstation-app:0.7.2 -t workstation-stream:0.7.2 .
# 基于应用镜像:代码、依赖、UID 10001 与 app 完全一致(共享 ws-hls 卷读写没有权限问题),
# 离线包只多 ffmpeg 那一层。只有构建阶段联网(apt-get);运行阶段不需要外网。
ARG APP_IMAGE
FROM ${APP_IMAGE}
USER root
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
USER 10001:10001
# worker 不监听端口:每轮循环刷新心跳文件,15 秒没动说明循环卡住了
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import os,sys,time; sys.exit(0 if time.time() - os.stat('/tmp/ws-stream-alive').st_mtime < 15 else 1)"]
ENTRYPOINT ["python", "-m", "app.stream"]
CMD []
