# 前端 + Caddy 镜像。构建上下文:仓库根目录。
#   docker build -f deploy/docker/web.Dockerfile -t workstation-web:0.7.0 .
# 只有构建阶段联网(npm ci);VITE_API_BASE 不设,前端走同源的 /api/v1。

FROM node:20-alpine AS build
WORKDIR /app/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build

FROM caddy:2.8-alpine
COPY --from=build /app/apps/web/dist /srv/www
