#!/usr/bin/env bash
# D13 试验最小冒烟(复核 R12):postgres + redis + 待测镜像,检查 /healthz 与登录,
# 并测启动时间与 p50。用法:smoke.sh <镜像> [请求数]
# 端口:postgres 15514、redis 16514、后端 8254。结束时 down -v。
set -euo pipefail

image="${1:?用法:smoke.sh <镜像> [请求数]}"
n="${2:-200}"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export WS_TRIAL_IMAGE="$image"
dc() { docker compose -f "${here}/smoke.compose.yml" "$@"; }
trap 'dc --profile app down -v >/dev/null 2>&1 || true' EXIT

dc up -d --wait postgres redis
dc --profile app run --rm --no-deps app migrate
dc --profile app run --rm --no-deps app seed

start=$(python3 -c 'import time; print(time.time())')
dc --profile app up -d --no-deps app
ready=0
for _ in $(seq 1 600); do
  if curl -fs http://127.0.0.1:8254/api/v1/healthz >/dev/null 2>&1; then ready=1; break; fi
  sleep 0.05
done
if [ "$ready" != 1 ]; then echo "应用 30 秒内未就绪" >&2; exit 1; fi
end=$(python3 -c 'import time; print(time.time())')
python3 -c "print(f'startup_seconds={$end - $start:.2f}')"

curl -fs http://127.0.0.1:8254/api/v1/healthz; echo
curl -fs -X POST http://127.0.0.1:8254/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"login_name":"teacher01","password":"dev123"}' | python3 -c \
  'import json,sys; d=json.load(sys.stdin); print("login ok, keys:", sorted(d))'
python3 "${here}/bench.py" 8254 "$n"
