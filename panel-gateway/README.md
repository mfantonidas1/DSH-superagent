# superagent 面板局域网入口（用户名密码门禁）

给 superagent 面板（`dsh --profile superagent`，回环 `127.0.0.1:3082`）加一个局域网访问入口，
照 [`dsh-gateway`](../../dsh-gateway) 的既有模式：用户级 nginx 反代 + Basic Auth 密码门禁 +
launch token 自动注入。**面板保持回环绑定，DSH 本体零改动**（配置、进程都不动）。

```
浏览器 ── Basic Auth（用户名/密码） ──► nginx 172.16.2.238:3083
                                          │  Host/Origin 恒定改写成 127.0.0.1:3082
                                          │  DSH 回 401 时自动补当前 launch token
                                          ▼
                               superagent 面板 127.0.0.1:3082（仅回环）
```

访问入口：**`http://172.16.2.238:3083/`**。凭据默认复用 dsh-gateway 的同一套
（`conf/htpasswd` 安装时从那边复制）；本机直连仍用 `http://127.0.0.1:3082/?token=…`。

## 与 dsh-gateway 的唯一本质区别：Host 头

dsh-gateway 的后端绑在局域网 IP，DSH 的 Host 栅栏接受「绑定地址本身、忽略端口」，
所以那边 `Host $http_host` 原样透传。本面板**保持回环绑定**，浏览器从局域网进来的
Host（`172.16.2.238:3083`）既不是回环、也不是绑定地址、也不在 `trustedHosts`（默认空），
透传会让每个 `/api` 请求被 403（页面白屏）。给 `connection.trustedHosts` 加条目需要重启
面板才能生效，而面板进程里跑着 superagent 编排器和活动会话，不能为了进门去重启它。

因此 nginx 把 **Host 恒定改写成 `127.0.0.1:3082`**，并把**本入口自己的 Origin**
（`http://172.16.2.238:3083`）同步改写成 `http://127.0.0.1:3082`：

- Host 栅栏：回环 hostname 恒被接受（任何端口）——`isTrustedApiRequest`；
- Origin 栅栏：`isSameAuthorityOrigin` 要求 Origin 与 Host 同 authority，改写后一致；
  **外来 Origin 原样透传**，由 DSH 栅栏拒绝，跨站防护不削弱
  （另有 `SameSite=Strict` cookie 与 `Sec-Fetch-Site` 兜底）；
- 会话 cookie：名字（`dsh-auth-` + base64url(sha256(authority))）与 HMAC 签名都按
  Host 头推导的 authority 计算。改写是恒定的，下发与校验两侧一致；浏览器按主机名
  （`172.16.2.238`）存 cookie、不分端口，每次都会带回来。authority 恒为
  `127.0.0.1:3082` 也意味着局域网浏览器不可能持有「同名外来 cookie」，
  dsh-gateway 记录过的跨端口 cookie 误判事故在这里结构性不存在。

## 文件

| 路径 | 作用 |
|---|---|
| `conf/nginx.conf` | 用户级 nginx 实例配置（Basic Auth + 反代 + Host/Origin 改写 + WebSocket 升级 + 大请求体） |
| `bin/refresh-token.sh` | 从面板进程自己的 stdout 日志抓当前 token → 写 `token.conf` → 变化时 reload |
| `tests/test-refresh-token.sh` | refresh-token 分支隔离测试（假 node 进程 + 临时目录，不触碰线上） |
| `tests/verify-gateway.sh` | 已部署入口的 curl 分层验证（401 分层/引导/cookie/WS/Origin 栅栏/回环绑定） |
| `tests/browser-check.cjs` | 真实浏览器端到端验证（Playwright Chromium，`httpCredentials` 原生应答 Basic 弹框） |
| `systemd/` | 单元源文件，`install.sh` 安装到 `~/.config/systemd/user/` |
| `install.sh` | 幂等部署：复制源文件 → 凭据/占位 token → `nginx -t` → enable --now |

浏览器验证需要 playwright（与本机浏览器缓存匹配的版本，如 1.59.0 + chromium-1217）：
`NODE_PATH=<含 playwright 的 node_modules> BASIC_USER=… BASIC_PASS=… node tests/browser-check.cjs`。

运行目录 `~/dsh-workspace/panel-gateway/` 里才有秘密与运行时状态：
`conf/htpasswd`（用户名/密码，apr1）、`conf/token.conf`（一行 `set $dsh_launch_token "…";`，600）、
`logs/`（access/error/pid，600）、`data/`（nginx 临时目录）。仓库里不落任何凭据。

## token 同步

面板不是 systemd 服务，没有 journal 可查。启动脚本 `scripts/dsh-superagent` 把 pane 的
stdout 重定向到每次启动独立的 `.artifacts/dsh-superagent-superagent-<stamp>-<pid>.log`，
所以 **`/proc/<面板PID>/fd/1` 恰好指向当前进程自己的日志** —— 精确绑定，不会拿到历史
进程的旧 token。脚本锚定 `dsh web: http://…?token=…` 整行提取，`flock` 串行化，
原子写入，token 变化才 reload。

安全语义（同 dsh-gateway，宁缺毋旧）：

- 面板 PID 取自 `.artifacts/control/profiles/superagent/service.pid`，用
  `/proc/<pid>/comm`（node/dsh）+ cmdline（`--profile superagent`）双重校验；
  记录失效时全表扫描唯一候选，多个候选拒绝任选。
- 找不到存活进程 → 保留 `token.conf` 现状；进程在但 `WAIT_SECS`（默认 15s）内没打印
  token → 保留现状、退出码 1；fd/1 不是可读日志 → 拒绝写入。
- 同步通道只有一条：`panel-gateway-token.timer` 每 1 分钟（面板没有 systemd 单元，
  做不了 ExecStartPost drop-in）。面板重启后最多 1 分钟内 token 跟上；期间**已登录的
  浏览器不受影响**（签名 secret 持久化、cookie authority 不变），只有新浏览器要等。

## 部署 / 日常 / 回滚（runbook）

```bash
# 部署（面板需在运行；凭据默认复用 dsh-gateway）
cd <仓库检出>/panel-gateway && ./install.sh

# 状态 / 日志
systemctl --user status panel-gateway panel-gateway-token.timer
journalctl --user -u panel-gateway -n 50
tail -f ~/dsh-workspace/panel-gateway/logs/access.log

# 改用户名 / 密码（独立于 dsh-gateway）
cd ~/dsh-workspace/panel-gateway
{ printf '你的用户名:'; openssl passwd -apr1 '你的密码'; } > conf/htpasswd
chmod 600 conf/htpasswd
systemctl --user restart panel-gateway

# 手动同步 token
~/dsh-workspace/panel-gateway/bin/refresh-token.sh

# 停用 / 完全回滚（面板侧本来就没被改动，127.0.0.1:3082 一直能用）
systemctl --user disable --now panel-gateway panel-gateway-token.timer
rm ~/.config/systemd/user/panel-gateway* && systemctl --user daemon-reload
```

本机 `Linger=yes`，用户级单元开机即起。nginx 配置语法检查：
`nginx -p ~/dsh-workspace/panel-gateway -c conf/nginx.conf -t`。

## 必须知道的约束

1. **入口地址/端口变化时**，`conf/nginx.conf` 的 `listen` 与 Origin map 里的入口
   authority 要一起改；后端回环地址/端口变化时，`upstream`、Host 改写值、Origin map
   的目标值要一起改。
2. **端口必须落在 3083 之类的高端口**，非 root 绑不了 80/443。要 HTTPS 需另加 TLS 层
   （cookie 的 `Secure` 由 DSH 按监听协议自行判断）。
3. **首页 401（用户字段已是你的用户名）只有一个含义：`token.conf` 过期**（面板重启过
   且 timer 还没跟上）。直接刷新即可自愈；仍失败就手动跑 `bin/refresh-token.sh`。
4. `client_max_body_size 400m` 对齐 DSH 默认 `maxRequestBodyBytes`（约 300MB 附件）。
5. **不要用 `http://用户名:密码@172.16.2.238:3083/` 进门**：Chrome 会从 JS 侧抛
   `Request cannot be constructed from a URL that includes credentials`，白屏。
   开干净 URL，在弹框里输一次即可。
6. 面板仍只绑回环；局域网唯一的门就是 3083 这层密码。`ss -tlnp | grep 3082` 应只见
   `127.0.0.1:3082`。
7. access.log 只记 `$uri` 不记 query（launch token 不落盘），日志权限 600。
8. **`HEAD /` 不会触发 token 引导**（DSH 的 token 交换只认 GET）：健康检查请用
   GET，或接受 HEAD 的 401。
9. 引导座位对 `Sec-Fetch-Site: cross-site` 的导航直接回 401、不做 token 交换
   （login-CSRF 加固）；正常地址栏输入/书签/同源刷新不受影响。

## 排障：先分清是谁回的 401

`logs/access.log` 里 `$remote_user` 是 `-` 还是你的用户名，直接区分两层：

| 现象 | 谁回的 | 含义 |
|---|---|---|
| `"GET /" 401`，用户字段 `-` | nginx | Basic Auth 没过（没输/输错/账号不在 htpasswd） |
| `"GET /" 401`，用户字段是你的用户名 | DSH | 密码过了，token/cookie 层的问题（见约束 3） |
| `/api` 大量 403 | DSH Host/Origin 栅栏 | Host/Origin 改写配置被改坏（对照上文） |
| 白屏但 access.log 全 200 | nginx 临时目录 | `data/` 不可写（对照 dsh-gateway README 同名段落） |

## 验证记录（2026-11-27，详见 docs/TEST-REPORT.md）

- refresh-token 10 个分支隔离测试全过（假 node 进程 + 临时目录，不触碰线上）。
- 部署后 curl 分层验证 12/12：无凭据/错密码 nginx 401；正确凭据无 cookie → 303+Set-Cookie
  （token 引导）；带 cookie 200 + `__DSH_BOOT__`；WS 101；同源 Origin 过栅栏、外来 Origin 403；
  跨站导航不引导；管理 API `/orchestrator/api/state` 200；面板仍仅回环监听。
- 真实浏览器（Playwright Chromium 147）经局域网入口 Basic Auth 登录：页面完整渲染、
  控制台零错误、无 >=400 响应、mux WebSocket 收帧正常。截图见 docs/evidence/。
- 验证用临时账号已吊销，htpasswd 恢复原样（sha256 一致）；面板进程全程未重启。