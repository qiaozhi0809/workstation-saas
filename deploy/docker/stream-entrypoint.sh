#!/usr/bin/env bash
# 转流镜像入口(L293):先以 root 给容器写出站规则,再降权到 uid 10001 运行 worker(CMD 默认 python -m app.stream)。
#
# 为什么要出站规则:ffmpeg 没有"不跟随 RTSP 3xx 重定向"的开关,摄像头(或冒充摄像头的内网主机)可以把拉流重定向到
# 公网或 compose 内网里的别的服务;应用层的地址校验只管登记时解析出的地址,管不了跳转。这里在容器层面兜底,OUTPUT 链:
#   放行 lo、DNS(resolv.conf 里的服务器)、compose 子网(WS_SUBNET)里的数据库 5432 与 Redis 6379;
#   拒绝 compose 子网其余地址与端口(否则默认的 172.16.0.0/12 会把 172.30.0.0/24 整个放进来);
#   放行 WS_CAMERA_NETS(默认 10.0.0.0/8,172.16.0.0/12,192.168.0.0/16);其余一律拒绝。
# 数据库 / Redis 按"子网 + 端口"放行而不是解析服务名:容器重建后地址会变,规则写死地址会在 redis 重启后把 worker 隔开。
# 需要容器带 NET_ADMIN 能力(docker-compose.yml 的 cap_add);没有时明确报错退出,不静默放行。
# WS_CAMERA_NETS=any 关闭限制(开发 / CI 的假摄像头在回环或 compose 子网里时用),此时不需要 NET_ADMIN。
set -euo pipefail

CAMERA_NETS_DEFAULT="10.0.0.0/8,172.16.0.0/12,192.168.0.0/16"
nets="${WS_CAMERA_NETS:-}"
[ -n "$nets" ] || nets="$CAMERA_NETS_DEFAULT"
subnet="${WS_SUBNET:-172.30.0.0/24}"
[ "$#" -gt 0 ] || set -- python -m app.stream

die() { printf 'stream-worker 入口错误:%s\n' "$*" >&2; exit 1; }
warn() { printf 'stream-worker 入口警告:%s\n' "$*" >&2; }

# 降权后 exec:PID 1 仍是 worker 本身(compose 的 stop 信号直达);清掉可继承能力并禁止再提权
drop_privileges() {
  exec setpriv --reuid=10001 --regid=10001 --clear-groups --inh-caps=-all --bounding-set=-all --no-new-privs -- "$@"
}

case "$(printf '%s' "$nets" | tr '[:upper:]' '[:lower:]')" in
  any)
    warn "WS_CAMERA_NETS=any:未设置出站限制,RTSP 重定向可以到达任何地址(只应在开发 / CI 使用)"
    drop_privileges "$@"
    ;;
esac

# cidr_ok <a.b.c.d[/n]>:IPv4 地址或网段的形状检查(细节交给 iptables,它会拒绝非法地址)
cidr_ok() { [[ "$1" =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}(/([0-9]|[12][0-9]|3[0-2]))?$ ]]; }

allow=()
IFS=, read -ra entries <<<"$nets"
for e in "${entries[@]}"; do
  e="${e//[[:space:]]/}"
  [ -n "$e" ] || continue
  cidr_ok "$e" || die "WS_CAMERA_NETS 里的「$e」不是合法的 IPv4 地址或网段(应形如 192.168.0.0/16,逗号分隔;或 any 关闭限制)"
  allow+=("$e")
done
[ "${#allow[@]}" -gt 0 ] || die "WS_CAMERA_NETS 没有任何网段"
cidr_ok "$subnet" || die "WS_SUBNET 不是合法的 IPv4 网段:$subnet"

# 选 iptables 后端:Debian 默认是 nft;内核不支持 nf_tables 时退回 legacy。两者都不行多半是容器没有 NET_ADMIN
IPT=""
for cand in iptables iptables-legacy; do
  if command -v "$cand" >/dev/null 2>&1 && "$cand" -w 5 -S OUTPUT >/dev/null 2>&1; then
    IPT="$cand"
    break
  fi
done
if [ -z "$IPT" ]; then
  err="$(iptables -w 5 -S OUTPUT 2>&1 || true)"
  die "无法操作 iptables(${err:-未知原因})。写出站规则需要容器带 NET_ADMIN 能力:请确认 docker-compose.yml 的 stream-worker 有 cap_add: [NET_ADMIN](1.0.0 起的 compose 文件已带);确实不需要出站限制时可在 .env 设 WS_CAMERA_NETS=any"
fi
ipt() { "$IPT" -w 5 "$@"; }

# reject_rule <匹配参数...>:优先 REJECT(连接立即被拒,ffmpeg 很快报错);内核没有 REJECT 模块时退回 DROP(靠超时)
REJECT_FALLBACK=0
reject_rule() {
  if ! ipt -A OUTPUT "$@" -j REJECT 2>/dev/null; then
    ipt -A OUTPUT "$@" -j DROP || die "写出站规则失败(-A OUTPUT $* -j DROP)"
    REJECT_FALLBACK=1
  fi
}

ipt -P OUTPUT ACCEPT || die "设置 OUTPUT 链策略失败"
ipt -F OUTPUT || die "清空 OUTPUT 链失败"
ipt -A OUTPUT -o lo -j ACCEPT || die "写出站规则失败(lo)"
# DNS:只放行 resolv.conf 里的服务器(compose 网络里是 127.0.0.11,已被 lo 覆盖;默认桥接网络里是宿主机的 DNS)
while read -r key val _; do
  [ "$key" = "nameserver" ] && cidr_ok "$val" || continue
  ipt -A OUTPUT -d "$val" -p udp --dport 53 -j ACCEPT || die "写出站规则失败(DNS $val)"
  ipt -A OUTPUT -d "$val" -p tcp --dport 53 -j ACCEPT || die "写出站规则失败(DNS $val)"
done </etc/resolv.conf
ipt -A OUTPUT -d "$subnet" -p tcp --dport 5432 -j ACCEPT || die "写出站规则失败(数据库)"
ipt -A OUTPUT -d "$subnet" -p tcp --dport 6379 -j ACCEPT || die "写出站规则失败(Redis)"
reject_rule -d "$subnet"
for e in "${allow[@]}"; do
  ipt -A OUTPUT -d "$e" -j ACCEPT || die "写出站规则失败(放行 $e)"
done
reject_rule
# IPv6:摄像头地址只认 IPv4;容器若有 IPv6 出口,除回环外一律拒绝(没有 IPv6 时 ip6tables 不可用,跳过)
if command -v ip6tables >/dev/null 2>&1 && ip6tables -w 5 -S OUTPUT >/dev/null 2>&1; then
  ip6tables -w 5 -F OUTPUT || die "清空 IPv6 OUTPUT 链失败"
  ip6tables -w 5 -A OUTPUT -o lo -j ACCEPT || die "写 IPv6 出站规则失败(lo)"
  ip6tables -w 5 -A OUTPUT -j REJECT 2>/dev/null || ip6tables -w 5 -A OUTPUT -j DROP || die "写 IPv6 出站规则失败"
elif [ -r /proc/net/if_inet6 ] && awk '$4 != "10" && $6 != "lo" && $1 !~ /^fe80/ { f = 1 } END { exit !f }' /proc/net/if_inet6; then
  # 有非回环、非链路本地的 IPv6 地址却写不了 ip6tables:IPv6 出口不受限,失败关闭而不是静默放行
  die "容器有 IPv6 地址但 ip6tables 不可用,无法限制 IPv6 出站;请关闭该网络的 IPv6,或确认内核支持 ip6tables,或在 .env 设 WS_CAMERA_NETS=any"
fi
note=""
if [ "$REJECT_FALLBACK" -eq 1 ]; then note="(内核没有 REJECT 模块,改用 DROP,被拒的连接要等超时)"; fi
printf 'stream-worker 出站限制已生效:放行 %s;compose 子网 %s 只到 5432 / 6379;其余拒绝%s\n' "$nets" "$subnet" "$note"
drop_privileges "$@"
