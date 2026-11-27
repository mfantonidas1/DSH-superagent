# 测试报告：superagent 面板局域网入口

日期：2026-11-27 · 环境：GB10（aarch64），nginx 1.24（用户级实例），
Chromium 147.0.7727.0（Playwright 1.59，chromium-1217 缓存），面板 PID 997713（全程未重启）。

## 1. refresh-token 分支隔离测试（10/10 通过）

`bash tests/test-refresh-token.sh` —— 真 node 假面板进程 + 临时目录，不触碰线上配置、
不重启真实面板。

| 分支 | 结果 |
|---|---|
| a 新进程打印新 token → 写入（nginx 未运行跳过 reload） | ok |
| b token 未变 → exit 0 且不重写（inode 不变） | ok |
| c 进程在但 WAIT_SECS 内无 token → exit 1，旧值保留 | ok |
| d 无存活面板且本地有值 → 保留，exit 0 | ok |
| e 无存活面板且本地无值 → exit 1，不写 | ok |
| f fd/1 是管道非日志 → 拒绝写入 | ok |
| g 多候选进程 → 拒绝任选，exit 1 | ok |
| h token 形状异常（太短）→ 拒绝写入 | ok |
| i --force 相同 token 也重写 | ok |
| j plugin 子命令进程被排除，扫描只认真面板 | ok |

## 2. 真实 token 同步（线上）

`bin/refresh-token.sh` 对真实面板：经 `service.pid` → `/proc/997713/fd/1` 定位当前日志，
提取 43 字符 token 写入 `token.conf`（600）。用该 token 直连回环后端验证：
`GET /?token=…` → `303` + `Set-Cookie`，cookie payload authority = `127.0.0.1:3082`，
cookie 名 = `dsh-auth-` + base64url(sha256("127.0.0.1:3082"))（与设计一致）。

## 3. 部署后入口分层验证（12/12 通过）

`tests/verify-gateway.sh`，目标 `http://172.16.2.238:3083/`。
凭据说明：验证期间向 htpasswd 临时追加随机强密码账号 `panel-verify`，
验证完成后**原样恢复**（sha256 与追加前一致、与 dsh-gateway 的 htpasswd 逐字节相同），
reload 后该账号立即 401（`user "panel-verify" was not found`），临时密码文件已删除。
生产凭据（复用 dsh-gateway 的既有账号）未被改动、未出现在任何日志/仓库。

| # | 检查 | 结果 |
|---|---|---|
| 1 | 无凭据 → nginx 401 + `WWW-Authenticate: Basic` | ok |
| 2 | 错误密码 → nginx 401 | ok |
| 3 | 正确凭据 + 无 cookie → 303 + Set-Cookie（token 引导座位） | ok |
| 3b | 303 Location 为相对 `./`（不回漏回环地址） | ok |
| 3c | cookie 名恰为 hash("127.0.0.1:3082") 的 authority 绑定 | ok |
| 4 | 带 cookie → 200 且含 `window.__DSH_BOOT__`（真 GUI） | ok |
| 5 | 已有 cookie 再访问 → 直接 200（无 token 交换） | ok |
| 6 | `/api/remote.mux` WS 升级 + cookie → 101 | ok |
| 7 | /api POST + 本入口 Origin + cookie → 过 Host/Origin 栅栏 | ok |
| 8 | /api POST + 外来 Origin（http://evil.example）→ 403 | ok |
| 9 | /api 无 cookie → DSH 层 401（非 / 路径不引导） | ok |
| 10 | 面板仍仅 `127.0.0.1:3082` 监听 | ok |

补充：

- **跨站引导加固**：`Sec-Fetch-Site: cross-site` 的导航 → 401（不做 token 交换）；
  `Sec-Fetch-Site: none` → 正常 303 引导。
- **superagent 管理 API**：带 cookie + `x-orchestrator-request: 1` + 本入口 Origin
  请求 `/orchestrator/api/state` → 200 JSON（runtime ready）。原型 `sameOrigin`
  要求 Host 恰为 `127.0.0.1:<port>`，恒定改写恰好满足；管理面板可正常使用。

## 4. 真实浏览器端到端（Playwright Chromium，RESULT=PASS）

`tests/browser-check.cjs`，`httpCredentials` 原生应答 Basic 弹框（与用户输密码同路，
凭据不进 URL）。经 `http://172.16.2.238:3083/` 登录：

- 页面：title=DeepSeek Harness，`__DSH_BOOT__` 存在，root innerHTML 80841 字符，
  readyState=complete（输出见 `evidence/after-browser-check.txt`，侧栏文本已脱敏）
- 控制台 error/warning：无
- >=400 响应：无
- WebSocket：`ws://172.16.2.238:3083/api/remote.mux` 握手成功，收到 11 帧，连接保持

截图（1400×900，同一入口）：

- `evidence/after-auth-gate-401.png` —— 无凭据时的 nginx 401 门禁页
- `evidence/after-login-center.png` —— 登录后主内容区（中性新会话视图；元素级截图，
  侧栏的工作区/会话名不入仓库；截图前已断言内容不含隐私字样）
- 全页截图（含侧栏会话名）仅留内部记录，不入仓库

## 5. 持久化与零改动确认

- `panel-gateway.service` / `panel-gateway-token.timer`：active + enabled；
  timer 每分钟触发（list-timers 可见）；`Linger=yes` 开机自启。
- 面板进程 PID 997713 全程未变（uptime 1 天 4 小时+），回环绑定未动，DSH 配置零改动。
- access.log / error.log 均无 `token=`（只记 $uri；子请求不落 access.log）；
  htpasswd / token.conf / 日志均 600。
- nginx 临时目录落盘正常（error.log 的 buffered to a temporary file 为预期 warn，
  大 bundle 完整送达，浏览器侧无语法错误）。

## 6. 已知限制

- HTTP 明文（与 dsh-gateway 一致）；HTTPS 需另加 TLS 层。
- 面板重启后新浏览器最多等 1 分钟（timer 周期）；已登录浏览器不受影响。
- `HEAD /` 不触发引导（token 交换只认 GET）；健康检查用 GET。
- 未从另一台物理局域网机器实测（本机经局域网 IP 访问与远端客户端走同一监听 socket；
  dsh-gateway 曾在 172.16.2.180 真机验证过同模式）。