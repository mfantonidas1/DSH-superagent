# 单机版贪食蛇

纯前端、零运行时依赖、零网络请求的单机贪食蛇游戏。简体中文界面，`file://` 直开可玩，最高分仅保存在本机浏览器。

## 如何运行

### 方式一：双击即玩（无需任何安装）

直接用浏览器打开 `frontend/index.html` 即可（`file://` 协议可玩）。

### 方式二：静态托管（可选）

任意静态服务器均可，例如：

```sh
python3 -m http.server 8000 --directory frontend
# 浏览器打开 http://127.0.0.1:8000/
```

无后端进程、无构建步骤、无外部 CDN 资源。

## 操作

- 方向键 / WASD：转向（禁止 180° 直接反向）
- 空格：开始 / 暂停 / 继续 / 重开（随状态）
- 回车：开始 / 重开
- P：暂停 / 继续
- 移动端：棋盘上滑动转向，屏上按钮完成开始/暂停/重开

规则：20×20 棋盘，吃食物 +10 分并变长，每吃 5 个食物提速一档（4→12 格/秒），撞墙或撞到自己即结束。最高分保存在本机 localStorage（不可用时自动降级为会话内有效，不影响游玩）。

## 跑测试（仅开发需要）

测试工具链要求 Node.js ≥ 22；e2e 需要 Playwright 浏览器（版本已精确锁定，与本机缓存匹配）：

```sh
npm install          # 仅安装 devDependency @playwright/test@1.59.0
npm run test:unit    # 核心逻辑单元测试（node:test，零依赖）
npm run test:e2e     # 真实浏览器端到端测试（http 与 file:// 双场景）
npm test             # 以上全部
```

首次运行 e2e 若缺浏览器：`npx playwright install chromium`。

## 目录

```
frontend/   游戏本体（index.html / styles.css / js/，运行时零依赖）
tests/      单元测试（unit/）与端到端测试（e2e/）
deploy/     静态托管说明（可选）
docs/       PRD / 架构 / 接口契约 / 架构评审 / UI 规范 / 测试计划与报告 / 运维手册
```

## 文档（ai-dev-team 流水线产物）

- [PRD](docs/PRD.md) · [架构设计](docs/ARCHITECTURE.md) · [内部模块契约](docs/API.md) · [架构评审](docs/ARCH-REVIEW.md)
- [UI 规范](docs/UI-SPEC.md) · [测试计划](docs/TEST-PLAN.md) · [测试报告](docs/TEST-REPORT.md) · [运维手册](docs/RUNBOOK.md)