#!/usr/bin/env bash
# CI 用:在后台周期性抓取某个 compose 项目各容器的日志,写到 <输出目录>/<服务名>-<容器短id>.log。
# 部署测试脚本退出时会 `compose down -v` 把容器删掉,测试失败后就取不到日志了,所以边跑边抓,
# 容器消失后保留最后一次抓到的内容。
# 用法:bundle_collect_logs.sh <compose 项目名> <输出目录> <停止标记文件>
#   标记文件出现后做最后一轮抓取并退出。
# 日志里不应含密钥(这本身是部署测试的断言对象);本脚本不做额外处理。
set -uo pipefail

[ "$#" -eq 3 ] || { echo "用法:$0 <项目名> <输出目录> <停止标记文件>" >&2; exit 1; }
PROJECT="$1" OUT="$2" STOP="$3"
mkdir -p "$OUT"

grab() {
  local id svc tmp
  for id in $(docker ps -a -q --filter "label=com.docker.compose.project=$PROJECT" 2>/dev/null); do
    svc="$(docker inspect -f '{{ index .Config.Labels "com.docker.compose.service" }}' "$id" 2>/dev/null)" || continue
    [ -n "$svc" ] || continue
    # 文件名带容器短 id:`compose run --rm` 的一次性容器(迁移预检)与主容器同属一个服务,不能互相覆盖
    tmp="$OUT/.$svc-${id:0:12}.tmp"
    if docker logs --timestamps "$id" >"$tmp" 2>&1 && [ -s "$tmp" ]; then
      mv "$tmp" "$OUT/$svc-${id:0:12}.log"
    else
      rm -f "$tmp"
    fi
  done
}

while [ ! -e "$STOP" ]; do
  grab
  sleep 2
done
grab
