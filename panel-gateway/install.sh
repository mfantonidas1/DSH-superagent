#!/usr/bin/env bash
# 把仓库里的 panel-gateway 源文件部署到 ~/dsh-workspace/panel-gateway 并启用。
# 幂等：重复执行 = 更新配置/脚本/单元 + reload。
#
#   ./install.sh                 # 部署并启用（凭据默认复用 dsh-gateway 的 htpasswd）
#   PREFIX=/path ./install.sh    # 自定义运行目录（nginx.conf 内的绝对路径需自行一致）
#
# 运行目录里才有秘密（htpasswd / token.conf / 日志），仓库里只有源文件。
set -euo pipefail
umask 077

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${PREFIX:-$HOME/dsh-workspace/panel-gateway}"
GATEWAY_HTPASSWD="${GATEWAY_HTPASSWD:-$HOME/dsh-workspace/dsh-gateway/conf/htpasswd}"
NGINX="${NGINX:-/usr/sbin/nginx}"
UNIT_DIR="$HOME/.config/systemd/user"

[ "$(id -u)" != "0" ] || { echo "install: 以普通用户运行（用户级 nginx + systemd --user）" >&2; exit 1; }

mkdir -p "$PREFIX"/{conf,logs,bin,systemd} "$PREFIX"/data/{proxy,body,misc} "$UNIT_DIR"
chmod 700 "$PREFIX" "$PREFIX/conf" "$PREFIX/logs" "$PREFIX/data"

install -m 644 "$SRC/conf/nginx.conf"            "$PREFIX/conf/nginx.conf"
install -m 755 "$SRC/bin/refresh-token.sh"       "$PREFIX/bin/refresh-token.sh"
install -m 644 "$SRC/systemd/panel-gateway.service"       "$UNIT_DIR/panel-gateway.service"
install -m 644 "$SRC/systemd/panel-gateway-token.service" "$UNIT_DIR/panel-gateway-token.service"
install -m 644 "$SRC/systemd/panel-gateway-token.timer"   "$UNIT_DIR/panel-gateway-token.timer"

# token.conf 占位：nginx 的 include 必须能解析；空 token 时引导座位得到干净 401。
if [ ! -f "$PREFIX/conf/token.conf" ]; then
  printf 'set $dsh_launch_token "";\n' > "$PREFIX/conf/token.conf"
fi
chmod 600 "$PREFIX/conf/token.conf"

# 凭据：默认复用 dsh-gateway 的同一套用户名密码（同一个人用同一套凭据进两个门）。
# 想独立一套：部署后按 README 改 conf/htpasswd 再 reload。
if [ ! -f "$PREFIX/conf/htpasswd" ]; then
  if [ -f "$GATEWAY_HTPASSWD" ]; then
    install -m 600 "$GATEWAY_HTPASSWD" "$PREFIX/conf/htpasswd"
    echo "install: 已复用 dsh-gateway 的凭据（$(cut -d: -f1 "$GATEWAY_HTPASSWD" | paste -sd, -)）"
  else
    echo "install: 缺少 $PREFIX/conf/htpasswd，且找不到可复用的 $GATEWAY_HTPASSWD" >&2
    echo "  先创建：{ printf '用户名:'; openssl passwd -apr1 '密码'; } > $PREFIX/conf/htpasswd && chmod 600 $PREFIX/conf/htpasswd" >&2
    exit 1
  fi
fi
chmod 600 "$PREFIX/conf/htpasswd"

# 日志预创建并收权：access.log 只记 $uri，但仍按 600 管理。
touch "$PREFIX/logs/access.log" "$PREFIX/logs/error.log"
chmod 600 "$PREFIX/logs/access.log" "$PREFIX/logs/error.log"

# 先同步一次 token（面板没起也不致命），再做语法检查。
bash "$PREFIX/bin/refresh-token.sh" || echo "install: token 同步暂未成功（面板未运行？），timer 会兜底" >&2
"$NGINX" -p "$PREFIX" -c conf/nginx.conf -t

systemctl --user daemon-reload
systemctl --user enable --now panel-gateway.service panel-gateway-token.timer
# 配置更新后让运行中的实例加载新配置。
systemctl --user reload panel-gateway.service 2>/dev/null || true

echo
echo "install: 完成。局域网入口 → http://172.16.2.238:3083/ （用户名密码同 dsh-gateway）"
echo "install: 状态 → systemctl --user status panel-gateway panel-gateway-token.timer"