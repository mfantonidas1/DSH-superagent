#!/usr/bin/env bash
# 对已部署的局域网入口做分层验证（curl 层面）。需要一套可用凭据：
#   BASE=http://172.16.2.238:3083 USER=u PASS=p bash tests/verify-gateway.sh
# 浏览器端到端另见 bin/cdp-check.cjs。
set -uo pipefail

BASE="${BASE:-http://172.16.2.238:3083}"
USER="${USER:?需要 USER}"
PASS="${PASS:?需要 PASS}"
T="$(mktemp -d /tmp/panel-verify.XXXXXX)"
trap 'rm -rf "$T"' EXIT
JAR="$T/cookies"

PASS_N=0; FAIL_N=0
check() { # check <名称> <断言 0/1> <证据>
  if [ "$2" = "1" ]; then PASS_N=$((PASS_N+1)); echo "ok   $1";
  else FAIL_N=$((FAIL_N+1)); echo "FAIL $1 —— $3"; fi
}

# 1. 无凭据 → nginx 层 401 + Basic challenge
H="$T/h1"; curl -sS -m 10 -D "$H" -o /dev/null "$BASE/"
check "1 无凭据 nginx 401" "$([ "$(head -1 "$H" | awk '{print $2}')" = "401" ] && grep -qi 'www-authenticate: Basic' "$H" && echo 1 || echo 0)" "$(head -1 "$H")"

# 2. 错误密码 → 仍 nginx 401
H="$T/h2"; curl -sS -m 10 -u "$USER:wrong-password" -D "$H" -o /dev/null "$BASE/"
check "2 错密码 nginx 401" "$([ "$(head -1 "$H" | awk '{print $2}')" = "401" ] && echo 1 || echo 0)" "$(head -1 "$H")"

# 3. 正确凭据 + 无 cookie → 引导座位 token 交换：303 + Set-Cookie，Location 为相对路径
H="$T/h3"; curl -sS -m 10 -u "$USER:$PASS" -D "$H" -o /dev/null "$BASE/"
CODE="$(head -1 "$H" | awk '{print $2}')"
SC="$(grep -i '^set-cookie:' "$H" | head -1)"
LOC="$(grep -i '^location:' "$H" | tr -d '\r' | awk '{print $2}')"
check "3 无 cookie 引导 303+Set-Cookie" "$([ "$CODE" = "303" ] && echo "$SC" | grep -q 'dsh-auth-' && echo 1 || echo 0)" "code=$CODE set-cookie=$(echo "$SC" | cut -c1-60)…"
check "3b Location 相对（不回漏回环地址）" "$([ "$LOC" = "./" ] && echo 1 || echo 0)" "location=$LOC"

# cookie 名应恰为 dsh-auth- + base64url(sha256("127.0.0.1:3082"))（authority 恒定改写）
EXPECT_NAME="$(node -e 'const c=require("crypto");process.stdout.write("dsh-auth-"+c.createHash("sha256").update("127.0.0.1:3082").digest("base64url"))')"
check "3c cookie 名绑定回环 authority" "$(echo "$SC" | grep -q "$EXPECT_NAME=" && echo 1 || echo 0)" "expect=$EXPECT_NAME"

# 4. 带 cookie 跟转 → 200 且是真 GUI（含 __DSH_BOOT__）
curl -sS -m 10 -u "$USER:$PASS" -c "$JAR" -o /dev/null "$BASE/"   # 重新走一遍拿 cookie 进 jar
B="$T/b4"; CODE="$(curl -sS -m 15 -u "$USER:$PASS" -b "$JAR" -L -o "$B" -w '%{http_code}' "$BASE/")"
check "4 带 cookie 200 + __DSH_BOOT__" "$([ "$CODE" = "200" ] && grep -q '__DSH_BOOT__' "$B" && echo 1 || echo 0)" "code=$CODE boot=$(grep -c '__DSH_BOOT__' "$B" 2>/dev/null)"

# 5. 已有 cookie 再访问 → 直接 200（不再发生 token 交换）
H="$T/h5"; curl -sS -m 10 -u "$USER:$PASS" -b "$JAR" -D "$H" -o /dev/null "$BASE/"
check "5 有 cookie 直接 200" "$(head -1 "$H" | grep -q ' 200 ' && echo 1 || echo 0)" "$(head -1 "$H")"

# 6. WebSocket 升级（/api/remote.mux）+ cookie → 101
H="$T/h6"; curl -sS -m 4 -u "$USER:$PASS" -b "$JAR" -D "$H" -o /dev/null \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' -H 'Sec-WebSocket-Version: 13' \
  -H "Origin: $BASE" "$BASE/api/remote.mux" 2>/dev/null
check "6 WS 升级 101" "$(head -1 "$H" | grep -q ' 101 ' && echo 1 || echo 0)" "$(head -1 "$H")"

# 7. /api POST + 本入口 Origin + cookie → 栅栏放行（非 401/403；mux 非升级请求预期 4xx）
CODE="$(curl -sS -m 10 -u "$USER:$PASS" -b "$JAR" -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" "$BASE/api/remote.mux")"
check "7 同源 Origin 过栅栏" "$([ "$CODE" != "401" ] && [ "$CODE" != "403" ] && echo 1 || echo 0)" "code=$CODE"

# 8. /api POST + 外来 Origin + cookie → 栅栏拒绝 403（Origin 改写只认本入口）
CODE="$(curl -sS -m 10 -u "$USER:$PASS" -b "$JAR" -o /dev/null -w '%{http_code}' -X POST -H 'Origin: http://evil.example' "$BASE/api/remote.mux")"
check "8 外来 Origin 403" "$([ "$CODE" = "403" ] && echo 1 || echo 0)" "code=$CODE"

# 9. /api 无 cookie → DSH 层 401（非 / 路径不做引导）
CODE="$(curl -sS -m 10 -u "$USER:$PASS" -o /dev/null -w '%{http_code}' -X POST -H "Origin: $BASE" "$BASE/api/remote.mux")"
check "9 无 cookie API 401" "$([ "$CODE" = "401" ] && echo 1 || echo 0)" "code=$CODE"

# 10. 面板仍仅回环绑定
check "10 面板仅回环 3082" "$(ss -tln | grep -E ':3082\b' | grep -q '127.0.0.1:3082' && ! ss -tln | grep -E ':3082\b' | grep -qv '127.0.0.1:3082' && echo 1 || echo 0)" "$(ss -tln | grep ':3082')"

echo "----"
echo "PASS=$PASS_N FAIL=$FAIL_N"
[ "$FAIL_N" = "0" ]