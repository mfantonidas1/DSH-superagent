#!/usr/bin/env bash
# =============================================================================
# 单机版贪食蛇 —— 本地静态服务器一键脚本（可选）
#
# 用法:
#   bash deploy/serve.sh [端口]        # 端口默认 8000，绑定 127.0.0.1
#   例: bash deploy/serve.sh 4175      # 浏览器打开 http://127.0.0.1:4175/
#
# 说明:
#   - 本项目为纯静态前端（frontend/），零运行时依赖、零构建、零网络请求。
#     首要运行方式是 file:// 直开 frontend/index.html，本脚本只是可选的
#     本地 http 托管方式（架构决议见 docs/ARCHITECTURE.md §1）。
#   - 服务目录固定为「相对脚本位置的 ../frontend」，与调用时的工作目录无关。
#   - 幂等：脚本不产生任何状态文件/副作用；重复启动同一端口会被启动前的
#     端口探测拦截，给出明确错误并以非零码退出，不会影响已在运行的服务。
#   - 失败退出码：2=参数错误 3=缺少 python3 4=frontend 缺失 5=端口被占用/不可绑定
#   - 前台运行（exec），Ctrl+C 即停止；退出码透传 python3 http.server。
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$SCRIPT_DIR/../frontend"
PORT="${1:-8000}"

usage() {
  echo "用法: bash $0 [端口]    # 端口默认 8000，范围 1-65535，绑定 127.0.0.1" >&2
}

# --- 参数校验 ---------------------------------------------------------------
if [[ $# -gt 1 ]]; then
  echo "错误: 最多接受 1 个参数（端口），收到 $# 个。" >&2
  usage
  exit 2
fi
if [[ ! "$PORT" =~ ^[0-9]+$ ]] || (( 10#$PORT < 1 || 10#$PORT > 65535 )); then
  echo "错误: 端口必须是 1-65535 的整数，收到: '$PORT'" >&2
  usage
  exit 2
fi

# --- 依赖与目录检查 ----------------------------------------------------------
if ! command -v python3 >/dev/null 2>&1; then
  echo "错误: 未找到 python3。请安装 Python 3（如 apt install python3），" >&2
  echo "      或改用首要运行方式: 浏览器直接打开 frontend/index.html（file://，无需任何安装）。" >&2
  exit 3
fi
if [[ ! -f "$FRONTEND_DIR/index.html" ]]; then
  echo "错误: 未找到 $FRONTEND_DIR/index.html，请确认脚本位于 snake-game/deploy/ 下且 frontend/ 完整。" >&2
  exit 4
fi

# --- 启动前端口占用探测 ------------------------------------------------------
# 用与 http.server 相同的 SO_REUSEADDR 语义试绑定 127.0.0.1:PORT，
# 区分「已被占用」与「权限不足」，给出明确错误。
if ! python3 - "$PORT" <<'PY'
import errno, socket, sys
port = int(sys.argv[1])
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try:
    s.bind(("127.0.0.1", port))
except OSError as exc:
    if exc.errno == errno.EADDRINUSE:
        print(f"错误: 端口 127.0.0.1:{port} 已被占用。请更换端口重试，"
              f"例如: bash deploy/serve.sh {port + 1 if port < 65535 else port - 1}",
              file=sys.stderr)
    elif exc.errno in (errno.EACCES, errno.EPERM):
        print(f"错误: 绑定端口 {port} 权限不足（1-1023 为特权端口）。请改用 >=1024 的端口。",
              file=sys.stderr)
    else:
        print(f"错误: 无法绑定 127.0.0.1:{port}（{exc}）。", file=sys.stderr)
    sys.exit(1)
finally:
    s.close()
PY
then
  exit 5
fi

# --- 启动（前台，exec 透传信号与退出码） -------------------------------------
echo "静态服务器启动: http://127.0.0.1:$PORT/  (目录: $FRONTEND_DIR)"
echo "健康检查: curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:$PORT/  # 期望 200"
echo "按 Ctrl+C 停止。"
exec python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$FRONTEND_DIR"
