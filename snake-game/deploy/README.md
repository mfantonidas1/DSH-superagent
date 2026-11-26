# 部署说明（deploy/）

单机版贪食蛇是**纯静态前端**：游戏本体全部在 `snake-game/frontend/`（index.html / styles.css / js/），**零运行时依赖、零构建步骤、零网络请求、无后端进程、无数据库、无环境变量、无密钥**。架构决议（[docs/ARCHITECTURE.md](../docs/ARCHITECTURE.md) §1）：`deploy/` 只做静态托管形态，不引入任何服务进程依赖。

因此本目录只有三样东西：

| 文件 | 作用 | 是否必需 |
|------|------|----------|
| `serve.sh` | 本地静态服务器一键脚本（python3 -m http.server） | 可选 |
| `nginx.conf.example` | nginx 生产静态托管参考配置 | 可选（仅参考） |
| `README.md` | 本说明 | — |

**没有** Dockerfile / docker-compose / systemd unit / .env.example —— 因为没有需要容器化或常驻的服务进程，也没有任何环境变量与密钥。

---

## 三种运行 / 部署方式

### 方式一：file:// 直开（首要方式，零安装）

直接用浏览器打开 `frontend/index.html` 即可游玩（双击或拖入浏览器）。

- 无需安装任何东西，无需启动任何进程。
- 经典脚本（非 ES module）+ UMD 写法，`file://` 下不会被 CORS 拦截。
- 最高分保存在浏览器 localStorage；个别浏览器在 `file://` 下限制 localStorage 时，游戏自动降级为「会话内最高分」，**属预期行为，不是故障**，游玩不受影响。

### 方式二：serve.sh 本地静态服务器（可选）

需要本机有 Python 3（仅标准库，无需 pip 安装任何包）：

```sh
bash deploy/serve.sh          # 默认端口 8000 → http://127.0.0.1:8000/
bash deploy/serve.sh 4175     # 指定端口 → http://127.0.0.1:4175/
```

脚本行为：

- 绑定 `127.0.0.1`（仅本机可访问），服务目录固定为**相对脚本位置**的 `../frontend`，在任意工作目录下调用均可。
- 启动前探测端口占用：被占用时给出明确错误并以非零码退出（退出码：2=参数错误，3=缺少 python3，4=frontend 缺失，5=端口被占用/不可绑定）。
- 幂等：不产生状态文件；重复启动同端口只会报错退出，不影响已运行的服务。
- 前台运行，`Ctrl+C` 停止。后台运行与停止方法见 [docs/RUNBOOK.md](../docs/RUNBOOK.md)。

### 方式三：任意静态托管（可选，生产/分享）

把 `frontend/` 目录原样放到任何静态文件服务器上即可，**无需构建、无需配置环境变量、无需上传任何密钥**。

- **nginx**：参考 [nginx.conf.example](./nginx.conf.example)（把 `root` 指向 `frontend/` 的绝对路径，`nginx -t` 后 reload）。纯 `try_files` 静态服务，无后端代理。
- **GitHub Pages**：把 `frontend/` 的内容作为站点根发布（例如推到 `gh-pages` 分支根目录，或仓库 Settings → Pages 选择对应分支/目录）。无需 CI 构建步骤。
- 其他（Caddy、Apache、对象存储静态网站、`npx serve` 等）同理：站点根 = `frontend/` 内容，入口 `index.html`。

注意：localStorage 按「源」（协议+域名+端口）隔离。`file://`、`http://127.0.0.1:8000`、`https://你的域名` 各自保存各自的最高分，互不相通，**这是浏览器机制，属预期行为**；部署/换域名不会丢失用户已在该源下保存的最高分。

---

## 运维手册

部署步骤、启动/停止/重启、健康检查、日志、故障排查、备份与回滚、上线前人工确认清单与本机实测验证记录，见 [docs/RUNBOOK.md](../docs/RUNBOOK.md)。
