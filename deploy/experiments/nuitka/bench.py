"""对 /healthz 与登录接口各发 N 次请求(串行、长连接),输出 p50/p95(毫秒)。仅用标准库。"""

import http.client
import json
import statistics
import sys
import time


def run(host: str, port: int, n: int, method: str, path: str, body: dict | None) -> list[float]:
    conn = http.client.HTTPConnection(host, port, timeout=10)
    payload = json.dumps(body) if body is not None else None
    headers = {"Content-Type": "application/json"} if body is not None else {}
    out: list[float] = []
    for _ in range(n):
        t = time.perf_counter()
        conn.request(method, path, body=payload, headers=headers)
        r = conn.getresponse()
        r.read()
        if r.status != 200:
            raise SystemExit(f"{path} 返回 {r.status}")
        out.append((time.perf_counter() - t) * 1000)
    conn.close()
    return out


def main() -> None:
    port = int(sys.argv[1])
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 200
    run("127.0.0.1", port, 20, "GET", "/api/v1/healthz", None)  # 预热
    cases = {
        "healthz": ("GET", "/api/v1/healthz", None),
        "login": ("POST", "/api/v1/auth/login", {"login_name": "teacher01", "password": "dev123"}),
    }
    for name, (m, p, b) in cases.items():
        xs = sorted(run("127.0.0.1", port, n, m, p, b))
        print(
            f"{name}: n={n} p50={statistics.median(xs):.2f}ms "
            f"p95={xs[max(int(n * 0.95) - 1, 0)]:.2f}ms max={xs[-1]:.2f}ms"
        )


if __name__ == "__main__":
    main()
