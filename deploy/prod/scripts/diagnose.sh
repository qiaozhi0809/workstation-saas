#!/usr/bin/env bash
# 主机诊断包:在部署目录里执行 ./scripts/diagnose.sh [--out <目录>]
#
# 生成 ws-host-diagnostics-<时间>.tar.gz(权限 600),内含 docker compose ps、docker version、df -h、
# free -m、uname -a、各服务最近 24 小时日志。命令不存在或失败时写"不可用",不让脚本失败。
# 全部内容先经打码再入包:.env 里的每个密钥值(含连接串里的密码)→ ***,手机号 → 1**********,
# Bearer 令牌与 JWT 形状的串 → ***。不含 .env;不使用 docker compose config / docker inspect
# (它们会展开密钥)。密钥值经环境变量交给 awk,不进命令行参数。
set +x
unset BASH_XTRACEFD
set -euo pipefail

# shellcheck source=scripts/lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

umask 077
WORK=""
cleanup() {
  local rc=$?
  trap - EXIT
  lib_cleanup
  exit "$rc"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

# 连接串里的密码:scheme://用户:密码@主机/...,取 ":" 与最后一个 "@" 之间的部分
url_password() {
  printf '%s' "$1" | sed -n -E 's#^[A-Za-z0-9+.-]+://[^:@/]*:([^@]*)@.*#\1#p' | head -n 1
}

# mask:标准输入 → 标准输出。先精确替换密钥值,再按形状打码。
mask() {
  WS_DG1="$(read_env WS_JWT_SECRET)" WS_DG2="$(read_env WS_MASTER_KEY)" WS_DG3="$(read_env POSTGRES_PASSWORD)" \
  WS_DG4="$(url_password "$(read_env WS_DATABASE_URL)")" WS_DG5="$(url_password "$(read_env WS_REDIS_URL)")" awk '
    BEGIN {
      n = 0
      for (i = 1; i <= 5; i++) { v = ENVIRON["WS_DG" i]; if (length(v) >= 4) s[++n] = v }
    }
    {
      line = $0
      for (i = 1; i <= n; i++) {
        out = ""
        while ((p = index(line, s[i])) > 0) {
          out = out substr(line, 1, p - 1) "***"
          line = substr(line, p + length(s[i]))
        }
        line = out line
      }
      print line
    }' \
  | sed -E \
      -e 's/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*/***/g' \
      -e 's/Bearer [A-Za-z0-9._~+\/=-]+/Bearer ***/g' \
      -e 's/(^|[^0-9])1[3-9][0-9]{9}([^0-9]|$)/\11**********\2/g' \
      -e 's/(^|[^0-9])1[3-9][0-9]{9}([^0-9]|$)/\11**********\2/g'
}

# capture <文件名> <命令...>:命令输出(含 stderr)打码后写入;命令不存在或失败时写"不可用"
capture() {
  local name="$1" out rc=0
  shift
  if ! command -v "$1" >/dev/null 2>&1; then
    printf '不可用(本机没有 %s 命令)\n' "$1" >"$WORK/$name"
    return 0
  fi
  out="$("$@" 2>&1 </dev/null)" || rc=$?
  if [ "$rc" -ne 0 ]; then
    { printf '不可用(命令执行失败,退出码 %s),输出如下:\n' "$rc"; printf '%s\n' "$out"; } | mask >"$WORK/$name"
  else
    printf '%s\n' "$out" | mask >"$WORK/$name"
  fi
}

main() {
  local outdir="." ts final svc
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --out) [ "$#" -ge 2 ] || die "--out 需要一个目录"; outdir="$2"; shift 2 ;;
      --out=*) outdir="${1#--out=}"; shift ;;
      -h|--help) printf '用法:./scripts/diagnose.sh [--out <目录>]\n'; exit 0 ;;
      *) die "不认识的参数:$1" ;;
    esac
  done
  [ -d "$outdir" ] || die "输出目录不存在:$outdir"
  outdir="$(cd "$outdir" && pwd)"
  [ -f "$ENV_FILE" ] || die "当前目录没有 .env,看起来还没安装"
  require_cmd docker "请先安装 Docker Engine"
  cd "$DEPLOY_DIR"

  WORK="$(mktemp -d "${TMPDIR:-/tmp}/.ws-diag.XXXXXX")"
  register_tmp "$WORK"
  mkdir "$WORK/bundle"
  WORK="$WORK/bundle"

  log_info "收集主机与容器信息……"
  capture compose-ps.txt docker compose -p "${WS_COMPOSE_PROJECT:-workstation}" --project-directory "$DEPLOY_DIR" ps -a
  capture docker-version.txt docker version
  capture df.txt df -h
  capture free.txt free -m
  capture uname.txt uname -a
  for svc in postgres redis app scheduler web; do
    log_info "收集 $svc 最近 24 小时日志……"
    capture "logs-$svc.txt" docker compose -p "${WS_COMPOSE_PROJECT:-workstation}" --project-directory "$DEPLOY_DIR" logs --since 24h --no-color "$svc"
  done
  printf '诊断包生成时间:%s\n部署版本:%s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$(tr -d '[:space:]' <"$DEPLOY_DIR/VERSION" 2>/dev/null || echo 未知)" >"$WORK/info.txt"

  ts="$(date +%Y%m%d-%H%M%S)"
  final="$outdir/ws-host-diagnostics-$ts.tar.gz"
  export COPYFILE_DISABLE=1
  tar -czf "$final" -C "$WORK" . || die "打包失败"
  chmod 600 "$final"
  log_info "诊断包已生成:$final"
  printf '  已对密钥、手机号、令牌打码,且不含 .env;发给技术支持前仍请自行浏览一遍\n'
}

main "$@"
exit 0
