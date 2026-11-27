# 架构评审：superagent 面板局域网入口

日期：2026-11-27 · 状态：实现前评审（含对 DSH 源码的逐条核对）

## 问题

superagent 面板（`dsh --profile superagent`）只绑 `127.0.0.1:3082`，局域网无法访问。
要求照 dsh-gateway 模式加 nginx 反代 + 用户名密码门禁，**面板保持回环绑定**，
处理好 Host 头与 token 自动注入，浏览器可正常登录使用。

## 关键约束（对 DSH 源码逐条核对）

核对对象：`@deepseek-ai/dsh-client-connection/lib/index.js`
（`/home/jxdxyfzx/.local/dsh/node_modules/` 下的实际运行版本）。

1. **Host/Origin 栅栏**（`isTrustedApiRequest`，每个 `/api` 请求）：
   Host 必须是回环 hostname（任意端口）、监听绑定 IP 字面量（忽略端口）、
   或 `connection.trustedHosts` 条目（superagent profile 未配置，默认空）；
   带 `Origin` 时必须与 Host 同 authority（`isSameAuthorityOrigin`）；
   `Sec-Fetch-Site: cross-site` 直接拒绝。
2. **会话 cookie**：名字 = `dsh-auth-` + base64url(sha256(authority))，
   authority 从 **Host 头**推导（`requestAudience`）；HMAC 签名 payload 内也绑定
   authority，校验时两侧必须一致。cookie 无 Domain 属性（浏览器按主机名存、
   不分端口）、`Path=/; HttpOnly; SameSite=Strict`。
3. **token 交换**：`GET /?token=<launch token>` → 303，`Location: ./`（相对路径，
   不会把后端 authority 泄漏给浏览器）；token 每进程启动随机生成，只打印在 stdout。
4. **配置不可热更**：`trustedHosts` 在插件 `apply` 时读取；dsh/cordis-loader 无
   配置文件 watcher —— 改 `trustedHosts` 必须重启面板。
5. **面板进程不能重启**：superagent 编排器与活动 Executor Session 就跑在这个
   进程里；`scripts/dsh-superagent stop` 会等当前步骤结束再杀进程，从会话内部
   触发重启等于自杀且会卡住优雅停机。

## 备选方案与否决理由

| 方案 | 结论 |
|---|---|
| A. Host 原样透传（dsh-gateway 原样照搬） | **否决**：后端是回环绑定，浏览器 Host `172.16.2.238:3083` 不在栅栏接受集内，所有 `/api` 403，白屏 |
| B. 给 profile 加 `connection.trustedHosts: ["172.16.2.238"]` | **否决**：需要重启面板才生效（约束 4、5）；且改动了 DSH 侧配置，违背「面板零改动」 |
| C. nginx 把 Host 恒定改写成回环 authority `127.0.0.1:3082`，本入口 Origin 同步改写 | **采纳**：见下 |
| D. 把面板改绑局域网 IP | **否决**：任务明确要求保持回环绑定；且绕过密码层直连 |

## 采纳方案 C 的正确性论证

- **Host 栅栏**：改写后 Host 恒为回环 hostname → 恒被接受（与端口无关）。
- **Origin 栅栏**：map 只把本入口自己的 Origin（`http://172.16.2.238:3083`）
  改写成 `http://127.0.0.1:3082`，与 Host 一致 → 同源请求放行。
  **外来 Origin 原样透传** → DSH 栅栏照旧拒绝；不削弱跨站防护
  （`SameSite=Strict` cookie 与 `Sec-Fetch-Site` 仍在）。
- **cookie 一致性**：下发与校验两侧的 authority 都来自同一个恒定改写值
  `127.0.0.1:3082`，名字与签名必然一致；浏览器按主机名 `172.16.2.238` 存
  cookie、每次请求都会带回。authority 恒定还带来一个结构性好处：
  局域网浏览器不可能持有「同名外来 cookie」（那需要它访问过
  `127.0.0.1:3082`，局域网做不到），dsh-gateway 记录过的跨端口 cookie
  误判事故在这里不存在。
- **客户端 URL**：浏览器侧 WS/fetch 全部相对 `document.baseURI`
  （`client.browser.js` `openConnectionWebSocket`），即入口 authority；
  服务端唯一的重定向是相对 `./`。无绝对地址回漏。
- **superagent 管理 API 的额外同源检查**（原型 `src/app/http.ts` `sameOrigin`）：
  `/orchestrator/api/*` 要求 Host **恰好**是 `127.0.0.1:<port>` 或 `localhost:<port>`，
  且 Origin 缺失或等于 `http://<Host>`。Host 透传方案在这里同样必败；
  本方案的恒定改写（Host=127.0.0.1:3082、本入口 Origin→http://127.0.0.1:3082）
  恰好满足，管理面板（总览/工单/设置）可正常使用。
- **引导座位**：沿用 dsh-gateway 的「DSH 真 401 → 内部子请求补 token」写法，
  `@dsh_bootstrap` 内 `proxy_intercept_errors off` 断递归；token 失效时浏览器
  拿到干净 401 而非 500。子请求继承 server 级 Host/Origin 改写，authority 一致。

## token 同步设计

面板由 `scripts/dsh-superagent` 在 tmux 里拉起，stdout 重定向到每次启动独立的
`.artifacts/…log`。因此 `/proc/<面板PID>/fd/1` **精确指向当前进程自己的日志**，
比「扫最新日志」更强：不会拿到历史进程的旧 token。PID 用启动脚本记录的
`service.pid`，以 `/proc/<pid>/comm`（node/dsh）+ cmdline（`--profile superagent`）
双重校验；失效时全表扫描唯一候选，多候选拒绝。宁缺毋旧语义与 dsh-gateway 一致
（等不到 / 找不到 / fd 异常 → 保留现状）。同步通道：systemd user timer 每 1 分钟
（面板非 systemd 服务，无 ExecStartPost 可挂）。面板重启后已登录浏览器不受影响
（签名 secret 持久化、cookie authority 不变），新浏览器最多等 1 分钟。

## 安全面

- 密码层：nginx Basic Auth（apr1 htpasswd，600），默认复用 dsh-gateway 同一套凭据。
- 面板仍仅回环监听；局域网唯一入口是 3083，全部流量过密码层。
- token 不落 access.log（只记 `$uri`）；token.conf / htpasswd / 日志均 600。
- 跨站：外来 Origin 透传被 DSH 拒绝 + SameSite=Strict + Sec-Fetch-Site。
- 已知残余风险（与 dsh-gateway 相同，接受）：HTTP 明文，Basic 凭据与 cookie
  在局域网内可被嗅探；要 HTTPS 需另加 TLS 层。已签发 cookie 在到期前不因
  htpasswd 删行而失效（DSH 侧机制，文档已写明）。

## 评审结论

方案 C 在「面板零改动、保持回环、不重启」三个硬约束下是唯一可行且可验证的路径；
栅栏、cookie、引导、WS 四条链路均已在源码层面核对。独立复核见下方附录。

## 附录：独立复核（subagent，实现后、交付前）

独立评审逐行核对了 DSH 源码与 nginx 语义，结论：**无 blocker，方案可部署**。
要点与处置：

| # | 级别 | 发现 | 处置 |
|---|---|---|---|
| 1 | 无问题 | Host/Origin 恒定改写在导航/静态资源/api POST/mux WS/引导/cookie 复验全链路成立；`<base href="./">` + `document.baseURI` 保证客户端 URL 全走入口；cookie 名哈希与 dsh-gateway 不同，无跨端口碰撞 | 采纳为设计依据 |
| 2 | minor | `authorizeIndex` 不查 Origin/Sec-Fetch-Site：缓存了 Basic 凭据的浏览器被跨站顶层导航时，引导座位会铸出会话 cookie（login-CSRF，与 dsh-gateway 同等暴露） | **已加固**：`@dsh_bootstrap` 对 `Sec-Fetch-Site: cross-site` 直接 return 401，不做 token 交换 |
| 3 | minor | `HEAD /` 不触发引导（token 交换只认 GET） | README 约束 8 写明：健康检查用 GET |
| 4 | minor | `PROFILE_RE` 会误匹配 `dsh plugin --profile superagent`；`ps` 无 `-ww` 时窄终端截断 args | **已修**：serves()/扫描均排除 ` plugin `；扫描改 `ps -ww`；新增隔离测试 j |
| 5 | minor | `die` 在 `$(panel_pid …)` 子 shell 里只退出子 shell，多候选拒绝被误报为「无进程」 | **已修**：panel_pid 用返回码 2 传出多候选，主流程显式 die |
| 6 | 无问题 | token 同步机制（fd/1 精确绑定、打印锚点、形状检查、flock、原子写、宁缺毋旧分支）全部核对通过 | — |
| 7 | minor | user scope 下 `network-online.target` 为空操作；开机早期 IP 未就绪时 bind 失败 | 保持与 dsh-gateway 一致：`Restart=always/3s` 自愈，可接受 |
| 8 | 无问题 | 五条 DSH 事实断言（trustedHosts 默认空、绑定 IP 忽略端口、无配置 watcher、签名 secret 持久化、webserver/frontend-static 无额外 Host 检查）全部确认 | — |