#!/usr/bin/env bash
# 抓 superagent 面板（dsh --profile superagent，tmux 拉起）当前进程的启动 token，
# 写进 conf/token.conf，并在 token 变化时 reload nginx。
#
#   bin/refresh-token.sh              # 有变化就更新 + reload
#   bin/refresh-token.sh --force      # 强制写入 + reload
#   WAIT_SECS=20 bin/refresh-token.sh # 等新 token 出现的上限（默认 15 秒）
#
# 由 panel-gateway-token.timer 每分钟兜底调用。
#
# token 来源与 dsh-gateway 不同：面板不是 systemd 服务，没有 journal 可查。
# 启动脚本 scripts/dsh-superagent 把 pane 的 stdout 重定向到每次启动独立的
# .artifacts/dsh-superagent-<profile>-<stamp>-<pid>.log，所以
#   /proc/<面板PID>/fd/1  →  恰好就是「当前这个进程」的日志
# 这是精确绑定，不会拿到历史进程的旧 token。
#
# 关键安全约束（同 dsh-gateway）：token 是每次进程启动 randomBytes 现生成的，
# 把旧 token 写进配置比不写更糟 —— nginx 会一直拿 DSH 已不再接受的 token 去换
# cookie，新浏览器永久 401。所以：
#   · 找不到存活的面板进程 → 保留 token.conf 现状；
#   · 进程在但 WAIT_SECS 内没打印 token → 保留现状，退出码 1，交给下次 timer；
#   · fd/1 不是可读的常规日志文件 → 拒绝写入。
set -euo pipefail

PREFIX="${PREFIX:-$HOME/dsh-workspace/panel-gateway}"
PROTOTYPE="${PROTOTYPE:-$HOME/dsh-workspace/dsh-superagent-prototype}"
PROFILE="${PROFILE:-superagent}"
NGINX="${NGINX:-/usr/sbin/nginx}"
WAIT_SECS="${WAIT_SECS:-15}"
POLL_INTERVAL="${POLL_INTERVAL:-0.5}"
TOKEN_FILE="$PREFIX/conf/token.conf"
LOCK_FILE="$PREFIX/conf/.refresh.lock"
PID_FILE="$PROTOTYPE/.artifacts/control/profiles/$PROFILE/service.pid"

die() { echo "refresh-token: $*" >&2; exit 1; }

mkdir -p "$PREFIX/conf" "$PREFIX/logs"

# 与并发调用（timer 撞上手工执行）串行化，避免互相覆盖 token.conf.new。
exec 9>"$LOCK_FILE"
flock -w 30 9 || die "拿不到 $LOCK_FILE 的锁"

# 只接受 base64url 形状（32 字节随机数 → 43 字符），避免把任意字符串写进配置。
ok_shape() { [[ "$1" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; }

current() {
  [ -f "$TOKEN_FILE" ] || return 0
  sed -n 's/^set \$dsh_launch_token "\(.*\)";$/\1/p' "$TOKEN_FILE" | head -1
}

PROFILE_RE="--profile[= ]${PROFILE}([[:space:]]|$)"

# 一个 pid 是否是面板主进程：comm 为 node/dsh，cmdline 带 --profile <profile>，
# 且不是 plugin 子命令（与 scripts/dsh-superagent 的判定一致）。
serves() {
  local pid="$1" comm args
  comm="$(cat "/proc/$pid/comm" 2>/dev/null || true)"
  case "$comm" in node|dsh) ;; *) return 1 ;; esac
  args="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  [[ "$args" == *" plugin "* ]] && return 1
  [[ "$args" =~ $PROFILE_RE ]]
}

# 优先用启动脚本记录的 service.pid；失效时全表扫描唯一的候选。
# 返回码：0=找到；1=没有；2=多个候选（拒绝任选）。
panel_pid() {
  local pid found=() p comm rest
  pid="${PANEL_PID:-}"
  [ -n "$pid" ] || pid="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$pid" ] && serves "$pid"; then
    printf '%s\n' "$pid"
    return 0
  fi
  while read -r p comm rest; do
    case "$comm" in node|dsh) ;; *) continue ;; esac
    [[ "$rest" == *" plugin "* ]] && continue
    if [[ "$rest" =~ $PROFILE_RE ]]; then found+=("$p"); fi
  done < <(ps -ww -ax -o pid=,ucomm=,args=)
  if [ "${#found[@]}" -eq 1 ]; then
    printf '%s\n' "${found[0]}"
    return 0
  fi
  [ "${#found[@]}" -eq 0 ] || return 2
  return 1
}

# 注意：panel_pid 在命令替换子 shell 里运行，die 只会退出子 shell，
# 所以多候选用返回码 2 传出来，在这里显式 die。
PID="$(panel_pid)" && PID_RC=0 || PID_RC=$?
if [ "$PID_RC" = "2" ]; then
  die "发现多个面板进程，拒绝任选其一，token.conf 未改动"
fi
[ "$PID_RC" = "0" ] || PID=""
if [ -z "$PID" ]; then
  OLD="$(current || true)"
  if [ -n "${OLD:-}" ]; then
    echo "refresh-token: 找不到存活的面板进程，保留 token.conf 现有值"
    exit 0
  fi
  die "找不到存活的面板进程且 token.conf 为空，不写入"
fi

# 当前进程自己的 stdout 日志；拿不到就绝不猜（不退回历史日志）。
LOG="$(readlink "/proc/$PID/fd/1" 2>/dev/null || true)"
if [ -z "$LOG" ] || [ ! -f "$LOG" ] || [ ! -r "$LOG" ]; then
  die "面板进程（PID=$PID）的 stdout 不是可读日志文件（fd1=${LOG:-?}），token.conf 未改动"
fi

# 锚定 dsh 启动时打印的整行 URL，避免把日志里其它 token= 字样误当启动 token。
extract() {
  grep -oE 'dsh web: http://[^ ]+\?token=[A-Za-z0-9_-]+' "$LOG" 2>/dev/null \
    | tail -1 | sed 's/.*?token=//'
}

# 进程刚拉起时 token 尚未打印（实测约 1 秒内），等而不是查一次就下结论。
deadline=$(( $(date +%s) + WAIT_SECS ))
TOKEN=""
while :; do
  TOKEN="$(extract || true)"
  [ -n "$TOKEN" ] && break
  [ "$(date +%s)" -lt "$deadline" ] || break
  sleep "$POLL_INTERVAL"
done
if [ -z "$TOKEN" ]; then
  die "PID $PID 在 ${WAIT_SECS}s 内没有打印 token（log=$LOG），token.conf 未改动"
fi

ok_shape "$TOKEN" || die "token 形状异常（PID=$PID），已放弃写入"

OLD="$(current || true)"
if [ "${OLD:-}" = "$TOKEN" ] && [ "${1:-}" != "--force" ]; then
  exit 0
fi

umask 077
printf 'set $dsh_launch_token "%s";\n' "$TOKEN" > "$TOKEN_FILE.new"
mv -f "$TOKEN_FILE.new" "$TOKEN_FILE"

if [ -f "$PREFIX/logs/nginx.pid" ] && kill -0 "$(cat "$PREFIX/logs/nginx.pid")" 2>/dev/null; then
  "$NGINX" -p "$PREFIX" -c conf/nginx.conf -s reload
  echo "refresh-token: token 已更新（${#OLD} → ${#TOKEN} 字符，PID=$PID），nginx 已 reload"
else
  echo "refresh-token: token 已写入（${#TOKEN} 字符，PID=$PID）；nginx 未运行，跳过 reload"
fi