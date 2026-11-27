#!/usr/bin/env bash
# refresh-token.sh 的分支隔离测试：全部在临时目录 + 假面板进程上跑，
# 不触碰线上 ~/dsh-workspace/panel-gateway，也不重启真实面板。
#
#   bash tests/test-refresh-token.sh
#
# 假面板 = 真 node 进程（comm=node、cmdline 带 --profile superagent），
# stdout 重定向到假日志，与 scripts/dsh-superagent 拉起真实面板的形态一致。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$HERE/bin/refresh-token.sh"
T="$(mktemp -d /tmp/panel-refresh-test.XXXXXX)"
trap 'rm -rf "$T"; [ -n "${P1:-}" ] && kill "$P1" 2>/dev/null; [ -n "${P2:-}" ] && kill "$P2" 2>/dev/null; [ -n "${P3:-}" ] && kill "$P3" 2>/dev/null' EXIT

PASS=0; FAIL=0
check() { # check <名称> <期望退出码> <实际退出码> <附加断言描述> <附加断言 0/1>
  if [ "$2" = "$3" ] && [ "$5" = "1" ]; then PASS=$((PASS+1)); echo "ok   $1";
  else FAIL=$((FAIL+1)); echo "FAIL $1（期望 exit=$2 实际=$3；$4）"; fi
}
token_of() { sed -n 's/^set \$dsh_launch_token "\(.*\)";$/\1/p' "$1/conf/token.conf" 2>/dev/null | head -1; }
fake_panel() { # fake_panel <日志路径> [日志内容] [profile，默认 superagent]
  if [ -n "${2:-}" ]; then printf '%s\n' "$2" > "$1"; else : > "$1"; fi
  node -e 'setTimeout(()=>{},120000)' -- --profile "${3:-superagent}" >> "$1" 2>&1 &
  echo $!
}
run() { # run <PREFIX> <额外 env...> [-- 脚本参数...]
  local prefix="$1"; shift
  local envs=() args=()
  while [ $# -gt 0 ]; do
    if [ "$1" = "--" ]; then shift; args=("$@"); break; fi
    envs+=("$1"); shift
  done
  env PREFIX="$prefix" PROTOTYPE="$T/empty" NGINX=/usr/sbin/nginx "${envs[@]}" bash "$SCRIPT" ${args[@]+"${args[@]}"}
}

GOOD_URL='dsh web: http://127.0.0.1:3082/?token=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
GOOD_TOKEN='AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
OLD_TOKEN='BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'

# a. 新进程打印了新 token → 写入；nginx 未运行 → 跳过 reload
PA="$T/a"; mkdir -p "$PA/conf"; printf 'set $dsh_launch_token "%s";\n' "$OLD_TOKEN" > "$PA/conf/token.conf"
P1="$(fake_panel "$T/a.log" "$GOOD_URL")"; sleep 0.5
run "$PA" PANEL_PID="$P1" WAIT_SECS=5 >/dev/null 2>&1; rc=$?
check "a 新 token 写入" 0 "$rc" "token=$(token_of "$PA")" "$([ "$(token_of "$PA")" = "$GOOD_TOKEN" ] && echo 1 || echo 0)"
kill "$P1" 2>/dev/null; P1=""

# b. token 未变 → exit 0 且不重写（inode 不变）
PB="$T/b"; mkdir -p "$PB/conf"; printf 'set $dsh_launch_token "%s";\n' "$GOOD_TOKEN" > "$PB/conf/token.conf"
INODE_BEFORE=$(stat -c %i "$PB/conf/token.conf")
P1="$(fake_panel "$T/b.log" "$GOOD_URL")"; sleep 0.5
run "$PB" PANEL_PID="$P1" WAIT_SECS=5 >/dev/null 2>&1; rc=$?
INODE_AFTER=$(stat -c %i "$PB/conf/token.conf")
check "b 幂等不重写" 0 "$rc" "inode $INODE_BEFORE→$INODE_AFTER" "$([ "$INODE_BEFORE" = "$INODE_AFTER" ] && echo 1 || echo 0)"
kill "$P1" 2>/dev/null; P1=""

# c. 进程在但日志里没有 token → 等满 WAIT_SECS 后 exit 1，旧值保留
PC="$T/c"; mkdir -p "$PC/conf"; printf 'set $dsh_launch_token "%s";\n' "$OLD_TOKEN" > "$PC/conf/token.conf"
P1="$(fake_panel "$T/c.log" "")"; sleep 0.5
run "$PC" PANEL_PID="$P1" WAIT_SECS=2 >/dev/null 2>&1; rc=$?
check "c 等不到不写旧值" 1 "$rc" "token=$(token_of "$PC")" "$([ "$(token_of "$PC")" = "$OLD_TOKEN" ] && echo 1 || echo 0)"
kill "$P1" 2>/dev/null; P1=""

# d. 找不到存活面板（profile 不存在 + 死 PID）且本地有值 → 保留，exit 0
PD="$T/d"; mkdir -p "$PD/conf"; printf 'set $dsh_launch_token "%s";\n' "$OLD_TOKEN" > "$PD/conf/token.conf"
run "$PD" PROFILE=test-none PANEL_PID=999999 >/dev/null 2>&1; rc=$?
check "d 无进程保留现状" 0 "$rc" "token=$(token_of "$PD")" "$([ "$(token_of "$PD")" = "$OLD_TOKEN" ] && echo 1 || echo 0)"

# e. 找不到存活面板且 token.conf 为空 → exit 1，不写
PE="$T/e"; mkdir -p "$PE/conf"
run "$PE" PROFILE=test-none PANEL_PID=999999 >/dev/null 2>&1; rc=$?
check "e 无进程无值不写" 1 "$rc" "存在=$([ -f "$PE/conf/token.conf" ] && echo y || echo n)" "$([ ! -f "$PE/conf/token.conf" ] && echo 1 || echo 0)"

# f. fd/1 是管道而非日志文件 → 拒绝写入，旧值保留
PF="$T/f"; mkdir -p "$PF/conf"; printf 'set $dsh_launch_token "%s";\n' "$OLD_TOKEN" > "$PF/conf/token.conf"
node -e 'setTimeout(()=>{},120000)' -- --profile superagent 2>&1 | cat > /dev/null &
P1=$!; sleep 0.5
# $! 是管道最后一个进程(cat)；找前面的 node
NODE_PID=$(ps -ax -o pid=,ucomm=,args= | awk '$2=="node" && /-- --profile superagent/ {print $1}' | head -1)
run "$PF" PANEL_PID="$NODE_PID" WAIT_SECS=2 >/dev/null 2>&1; rc=$?
check "f 管道 stdout 拒写" 1 "$rc" "token=$(token_of "$PF")" "$([ "$(token_of "$PF")" = "$OLD_TOKEN" ] && echo 1 || echo 0)"
kill "$NODE_PID" "$P1" 2>/dev/null; P1=""

# g. 多个候选进程（无 service.pid 时全表扫描）→ 拒绝任选，exit 1
PG="$T/g"; mkdir -p "$PG/conf"; printf 'set $dsh_launch_token "%s";\n' "$OLD_TOKEN" > "$PG/conf/token.conf"
P1="$(fake_panel "$T/g1.log" "$GOOD_URL")"; P2="$(fake_panel "$T/g2.log" "$GOOD_URL")"; P3="$(fake_panel "$T/g3.log" "$GOOD_URL")"; sleep 0.5
run "$PG" WAIT_SECS=2 >/dev/null 2>&1; rc=$?
check "g 多候选拒绝" 1 "$rc" "token=$(token_of "$PG")" "$([ "$(token_of "$PG")" = "$OLD_TOKEN" ] && echo 1 || echo 0)"
kill "$P1" "$P2" "$P3" 2>/dev/null; P1=""; P2=""; P3=""

# h. token 形状异常（太短）→ 拒绝写入
PH="$T/h"; mkdir -p "$PH/conf"; printf 'set $dsh_launch_token "%s";\n' "$OLD_TOKEN" > "$PH/conf/token.conf"
P1="$(fake_panel "$T/h.log" 'dsh web: http://127.0.0.1:3082/?token=short')"; sleep 0.5
run "$PH" PANEL_PID="$P1" WAIT_SECS=2 >/dev/null 2>&1; rc=$?
check "h 形状异常拒写" 1 "$rc" "token=$(token_of "$PH")" "$([ "$(token_of "$PH")" = "$OLD_TOKEN" ] && echo 1 || echo 0)"
kill "$P1" 2>/dev/null; P1=""

# i. --force：token 相同也重写
PI="$T/i"; mkdir -p "$PI/conf"; printf 'set $dsh_launch_token "%s";\n' "$GOOD_TOKEN" > "$PI/conf/token.conf"
INODE_BEFORE=$(stat -c %i "$PI/conf/token.conf")
P1="$(fake_panel "$T/i.log" "$GOOD_URL")"; sleep 0.5
run "$PI" PANEL_PID="$P1" WAIT_SECS=5 -- --force >/dev/null 2>&1; rc=$?
INODE_AFTER=$(stat -c %i "$PI/conf/token.conf")
check "i --force 重写" 0 "$rc" "inode $INODE_BEFORE→$INODE_AFTER" "$([ "$INODE_BEFORE" != "$INODE_AFTER" ] && echo 1 || echo 0)"
kill "$P1" 2>/dev/null; P1=""

# j. plugin 子命令不算面板进程：一个真面板形态 + 一个 plugin 形态，扫描应只认前者。
#    用独立 profile 名，避免与真实在跑的面板进程互相干扰。
PJ="$T/j"; mkdir -p "$PJ/conf"
P1="$(fake_panel "$T/j1.log" "$GOOD_URL" test-j)"
node -e 'setTimeout(()=>{},120000)' -- plugin --profile test-j > "$T/j2.log" 2>&1 &
P2=$!; sleep 0.5
run "$PJ" PROFILE=test-j WAIT_SECS=5 >/dev/null 2>&1; rc=$?
check "j plugin 进程被排除" 0 "$rc" "token=$(token_of "$PJ")" "$([ "$(token_of "$PJ")" = "$GOOD_TOKEN" ] && echo 1 || echo 0)"
kill "$P1" "$P2" 2>/dev/null; P1=""; P2=""

echo "----"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" = "0" ]