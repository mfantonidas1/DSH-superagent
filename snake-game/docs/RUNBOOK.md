# 运维手册（RUNBOOK）—— 单机版贪食蛇

- 版本：v1.0 ｜ 作者：devops（ai-dev-team 流水线）｜ 日期：2026-11-26
- 上游依据：[ARCHITECTURE.md](./ARCHITECTURE.md) §1「backend N/A 决议」与 §9、[README.md](../README.md)、[deploy/README.md](../deploy/README.md)

## 0. 部署形态总览

**纯静态前端，无服务进程依赖。** 游戏本体全部在 `snake-game/frontend/`（index.html / styles.css / js/ 七个经典脚本），零运行时依赖、零构建、零网络请求。**无后端进程、无数据库、无服务端配置、无环境变量、无密钥。** 首要运行方式是 `file://` 直开 index.html；`deploy/` 只提供可选的静态托管形态（serve.sh 本地脚本 + nginx 参考配置）。

因此本手册中「启动/停止/重启/日志」仅针对**可选的静态文件服务器**；游戏本身不需要任何服务端运维。最高分只存在用户浏览器的 localStorage（按源隔离），服务端不保存任何用户数据。

上游测试状态（最终，见 [TEST-REPORT.md](./TEST-REPORT.md)）：**82/82 全部通过**——单元 58/58（node:test）+ e2e 24/24（@playwright/test 1.59.0 + chromium）；缺陷 D-01/T-01/T-02 全部修复闭环。

---

## 1. 部署步骤

### 1.1 获取代码

```sh
git clone <仓库地址> && cd snake-game
# 或直接复制 snake-game/ 目录。运行时只需要 frontend/，其余（tests/、docs/、
# package.json、node_modules）均为开发与文档产物，不参与运行。
```

**无需 `npm install`、无需任何构建步骤**（npm 仅用于测试工具链）。

### 1.2 方式 A：file:// 直开（首要方式，零安装）

浏览器直接打开 `frontend/index.html`（双击或拖入浏览器）即玩。无需启动任何进程。

### 1.3 方式 B：serve.sh 本地静态服务器（可选，需 Python 3 标准库）

```sh
bash deploy/serve.sh          # 默认 8000 → http://127.0.0.1:8000/
bash deploy/serve.sh 4175     # 指定端口 → http://127.0.0.1:4175/
```

绑定 `127.0.0.1`；服务目录固定为相对脚本位置的 `../frontend`（任意工作目录调用均可）；启动前探测端口占用；失败非零退出（2=参数错误，3=缺 python3，4=frontend 缺失，5=端口被占用/不可绑定）。

### 1.4 方式 C：任意静态托管（可选，生产/分享）

把 `frontend/` 内容原样作为站点根发布：

- **nginx**：参考 [deploy/nginx.conf.example](../deploy/nginx.conf.example)，将 `root` 改为 `frontend/` 实际绝对路径、`server_name` 改为实际域名，复制到 `/etc/nginx/conf.d/snake.conf`，`nginx -t` 校验后 `systemctl reload nginx`。纯 `try_files` 静态服务，**无后端代理**。
- **GitHub Pages**：将 `frontend/` 内容发布为站点根（如 `gh-pages` 分支根目录，或 Settings → Pages 指定分支/目录），无需 CI 构建。
- 其他静态服务器（Caddy / Apache / 对象存储静态网站等）同理。

无环境变量、无密钥需要配置或上传。

---

## 2. 启动 / 停止 / 重启

`file://` 方式无启停概念。以下仅针对可选静态服务器。

### 2.1 前台（推荐本地使用）

```sh
bash deploy/serve.sh 8000     # 启动；Ctrl+C 停止
```

### 2.2 后台

```sh
nohup bash deploy/serve.sh 8000 > /tmp/snake-http.log 2>&1 &
echo $! > /tmp/snake-http.pid   # 脚本内 exec python3，此 PID 即服务器进程
```

### 2.3 停止

```sh
kill "$(cat /tmp/snake-http.pid)"        # 前台方式直接 Ctrl+C
ss -ltn | grep ':8000\b' || echo "端口已释放"   # 确认
```

### 2.4 重启

重启 = 停止 + 启动（无状态、无数据迁移，秒级完成）：

```sh
kill "$(cat /tmp/snake-http.pid)" 2>/dev/null || true
nohup bash deploy/serve.sh 8000 > /tmp/snake-http.log 2>&1 &
echo $! > /tmp/snake-http.pid
```

幂等保证：脚本不产生状态文件；端口已被占用时直接报错退出（exit 5），**不会重复启动或影响已运行的服务**。

### 2.5 nginx（若采用）

- 更新静态文件：直接替换 `frontend/` 内容即可生效，**无需重启**。
- 修改配置后：`nginx -t && systemctl reload nginx`。

---

## 3. 健康检查

以端口 8000 为例（换成实际端口）：

```sh
# 1) HTTP 状态码，期望 200
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/

# 2) 页面标题，期望 <title>贪食蛇</title>
curl -sS http://127.0.0.1:8000/ | grep -o '<title>[^<]*</title>'

# 3) 关键词「贪食蛇」，期望 ≥1（实际为 2：<title> 与 <h1>）
curl -sS http://127.0.0.1:8000/ | grep -c '贪食蛇'

# 4) 静态资源抽查，期望均 200
curl -sS -o /dev/null -w 'styles.css=%{http_code}\n' http://127.0.0.1:8000/styles.css
curl -sS -o /dev/null -w 'js/app.js=%{http_code}\n'  http://127.0.0.1:8000/js/app.js
```

`file://` 场景：浏览器打开后确认标题「贪食蛇」、开始遮罩与「开始游戏」按钮可见，点击后蛇开始移动。

---

## 4. 日志位置

| 来源 | 位置 | 说明 |
|------|------|------|
| serve.sh / python3 http.server | **stdout/stderr**（前台终端；后台时为重定向文件，如 `/tmp/snake-http.log`） | 访问日志形如 `127.0.0.1 - - [日期] "GET / HTTP/1.1" 200 -` |
| 游戏本身 | **无服务端日志**（无后端进程） | 客户端报错仅在用户浏览器 DevTools Console，本机可见，不上传任何外部服务 |
| nginx（若采用） | `/var/log/nginx/snake.access.log`、`snake.error.log`（按参考配置） | 仅静态文件访问日志 |

---

## 5. 常见故障排查

| 症状 | 原因 | 处理 |
|------|------|------|
| serve.sh 报「端口 127.0.0.1:PORT 已被占用」，exit 5 | 端口被其他进程监听 | 换端口（如 `bash deploy/serve.sh 8001`）；如需定位占用者：`ss -ltnp \| grep :PORT`。**不要杀不属于本项目的进程**（如本机 4173/4174 被其他任务占用） |
| serve.sh 报「未找到 python3」，exit 3 | 本机无 Python 3 | 安装 python3（如 `apt install python3`）；或直接用首要方式 `file://` 直开，零安装 |
| `file://` 下最高分不持久（刷新后归零） | 个别浏览器限制 file:// 的 localStorage | **预期降级，非故障**（FR-08 / 架构 R2）：游戏自动退化为会话内最高分，游玩不受影响；改用 http 托管即恢复持久化 |
| 换域名/换端口/从 file:// 换到 http 后最高分「消失」 | localStorage 按源（协议+域名+端口）隔离 | 预期行为；各源各自保存最高分，原源下数据仍在 |
| 请求返回 404 | `--directory` / nginx `root` 指错目录 | 确认目录内直接包含 index.html（应指向 `frontend/`，不是 `snake-game/`） |
| 页面空白 / 按钮无响应 | 脚本缺失或加载顺序被改动 | 看浏览器 Console；核对 index.html 中顺序：constants → rng → engine → storage → renderer → input → app |
| 绑定 1-1023 端口报权限不足 | 特权端口需 root | 改用 ≥1024 的端口 |
| serve.sh exit 4 | frontend/index.html 缺失 | 确认脚本位于 `snake-game/deploy/` 且 `frontend/` 完整 |

---

## 6. 备份与回滚

**无服务端数据**：无数据库、无用户数据文件、无服务端状态。唯一「数据」是各用户浏览器内的 localStorage 最高分，部署操作触碰不到，也无需备份。

- **备份 = 版本管理**：发布前打 tag（如 `git tag v1.0.0`），或直接复制 `frontend/` 目录留档。
- **回滚 = git checkout 旧版本目录**：

```sh
git checkout <旧tag或commit> -- frontend/     # 仅回滚游戏本体
# 静态托管侧直接以旧文件覆盖站点根即可；nginx 无需重启，file:// 无需任何操作。
```

- **用户最高分在浏览器侧，不受部署/回滚影响**（同一源下保持不变）。
- 本项目不存在「删除数据 / 覆盖生产配置」类危险运维操作；如未来引入此类脚本，必须加确认开关且默认不执行。

---

## 7. 上线前人工确认清单

- [ ] 部署形态符合架构决议（ARCHITECTURE §1）：**仅静态托管**，未引入任何后端进程、数据库、服务端配置。
- [ ] `frontend/` 完整且与测试通过的版本一致（index.html / styles.css / js/ 七个脚本齐全，加载顺序未被改动）。
- [ ] 测试状态经 QA 最终确认：**82/82 全部通过**（单元 58 + e2e 24），见 [TEST-REPORT.md](./TEST-REPORT.md)。
- [ ] 人工打开目标入口（file:// 或托管 URL）完整试玩一局：开始 → 转向 → 吃食物加分提速 → 死亡结算 → 重开；确认标题「贪食蛇」、HUD 分数/最高分/速度常显。
- [ ] http 托管：健康检查通过（curl 200 + `<title>贪食蛇</title>`，见 §3）。
- [ ] 公开托管（nginx 等）：`root` / `server_name` 占位符已替换为实际值；`nginx -t` 通过；无 proxy_pass 等后端代理。
- [ ] 确认**无环境变量、无密钥**需要配置；不向仓库/站点添加任何密钥。
- [ ] 端口规划不与现有服务冲突（本机 4173/4174 被其他任务占用，勿动）。
- [ ] 向用户说明：最高分仅存本人浏览器、按源隔离，清除浏览器数据会丢失最高分（预期行为）。

---

## 8. 验证记录（本机实测）

- **时间**：2026-11-26 14:27–14:29（Asia/Shanghai）
- **环境**：Linux；Python 3.12.3（/usr/bin/python3）；curl、bash 可用；工作目录 `/home/jxdxyfzx/.dsh/state/superagent/work/snake-game-fd9468211d5b`
- **端口纪律**：全程只使用 **4175**。验证开始时 4173 处于监听（其他任务所有，未触碰）；清理后复查 4173/4174 均已不在监听（由其所有者自行停止，与本验证无关，本验证未对其做任何操作）。

### 8.1 语法与参数校验分支

```sh
bash -n snake-game/deploy/serve.sh            # → SYNTAX-OK
bash snake-game/deploy/serve.sh abc           # → exit=2，stderr: 错误: 端口必须是 1-65535 的整数，收到: 'abc'
bash snake-game/deploy/serve.sh 70000         # → exit=2（超范围）
bash snake-game/deploy/serve.sh 4175 extra    # → exit=2，stderr: 错误: 最多接受 1 个参数（端口），收到 2 个。
```

### 8.2 启动（后台）与监听确认

```sh
bash snake-game/deploy/serve.sh 4175          # 后台启动
```

stdout 摘要：

```
静态服务器启动: http://127.0.0.1:4175/  (目录: .../snake-game/deploy/../frontend)
健康检查: curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:4175/  # 期望 200
按 Ctrl+C 停止。
```

`ss -ltnp` 确认：`LISTEN 127.0.0.1:4175 users:(("python3",pid=1027307,fd=3))`

### 8.3 健康检查（curl）

```sh
curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4175/   # → HTTP_CODE=200
curl -sS http://127.0.0.1:4175/ | grep -o '<title>[^<]*</title>' # → <title>贪食蛇</title>
curl -sS http://127.0.0.1:4175/ | grep -c '贪食蛇'               # → 2
curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4175/styles.css  # → 200
curl -sS -o /dev/null -w '%{http_code}' http://127.0.0.1:4175/js/app.js   # → 200
```

服务器 stdout 访问日志（节选）：

```
127.0.0.1 - - [26/Nov/2026 14:28:50] "GET / HTTP/1.1" 200 -
127.0.0.1 - - [26/Nov/2026 14:28:50] "GET /styles.css HTTP/1.1" 200 -
127.0.0.1 - - [26/Nov/2026 14:28:50] "GET /js/app.js HTTP/1.1" 200 -
```

### 8.4 端口占用分支（第二次启动同端口）

在 `snake-game/` 目录下调用（同时验证脚本相对路径解析与工作目录无关）：

```sh
bash deploy/serve.sh 4175
# → exit=5
# stderr: 错误: 端口 127.0.0.1:4175 已被占用。请更换端口重试，例如: bash deploy/serve.sh 4176
```

已运行的服务不受影响（随后 curl 仍 200）。

### 8.5 清理与清理后确认

```sh
# 向本验证启动的进程（pid 1027307）发送 SIGTERM（后台任务取消）
ss -ltn | grep ':4175\b'                      # → 无输出（4175-RELEASED）
ps -p 1027307                                 # → 进程已退出（PID-1027307-GONE）
curl --max-time 3 http://127.0.0.1:4175/      # → curl: (7) Failed to connect（exit=7，code 000）
```

**结论：全部通过。** serve.sh 启动/健康检查/端口占用拦截/参数校验/清理均符合设计；未触碰 4173/4174；验证后无残留进程与监听。
