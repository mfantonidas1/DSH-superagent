# UI 设计规范：单机版贪食蛇

- 版本：v1.0 ｜ 作者：ui-designer（ai-dev-team 流水线）｜ 上游：[PRD.md](./PRD.md) v1.0、[ARCHITECTURE.md](./ARCHITECTURE.md) v1.1、[API.md](./API.md) v1.2（approved；v1.2 纯增补 TEXT.pause='暂停'）
- 交接面：本文件是前端实现的唯一 UI 依据。DOM 结构与全部 id 以 API.md §7「DOM 契约」为准，本规范只描述其位置/样式/状态，不增删改任何 id 或语义。
- 硬约束：单页、简体中文、`file://` 直开可玩、零网络请求（无外部字体/图标/图片，字体用下方系统栈；装饰一律 CSS 绘制）。

## 1. 页面信息架构

**页面数量：1**（`frontend/index.html`，无路由）。四状态 ready / running / paused / over 均在本页内以遮罩切换，不发生导航。

桌面线框（内容列宽 600px，水平居中）：

```
┌────────────────────── 页面（背景 chrome-bg）──────────────────────┐
│                    贪食蛇  #game-title（H1，居中）                 │
│        方向键 / WASD 转向，空格暂停，回车开始/重开  #game-help      │
│  ┌──────────────────────── HUD 行（全状态常显）────────────────┐  │
│  │ 分数        最高分        速度 x4              [ 暂停 ]     │  │
│  │ #hud-score  #hud-high    #hud-speed            #btn-pause   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│  ┌──────────── 棋盘容器 .board-wrap（position:relative）───────┐  │
│  │  #board（canvas，600×600 CSS px 上限，正方形）              │  │
│  │      ┌──── 遮罩（absolute，仅盖本容器，不盖 HUD）────┐      │  │
│  │      │ #overlay-start / #overlay-pause / #overlay-over│      │  │
│  │      │        （同一时刻至多一个可见，hidden 控制）   │      │  │
│  │      └────────────────────────────────────────────────┘      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

- 区域自上而下：标题区（#game-title + #game-help）→ HUD 行（3 个数据位 + #btn-pause）→ 棋盘容器（#board + 三个遮罩）。无页脚、无弹窗、无其他页面。
- #btn-start 位于 #overlay-start 内、#btn-restart 位于 #overlay-over 内；**#btn-pause 是常驻按钮，放在 HUD 行右端**（遮罩外），保证 paused 时可达且不被遮挡（FR-06/FR-11）。
- 触摸滑动区 = 棋盘容器（`touch-action: none`，API §7 bindTouch 绑定于此）；容器外页面可正常滚动。

## 2. 设计令牌

### 2.1 色板（HEX）

游戏内颜色（Canvas 绘制，取 API.md §2 COLORS 原值，禁改）：

| 令牌 | HEX | 用途 |
|------|-----|------|
| boardLight / boardDark | `#f3f7f0` / `#e8efe3` | 棋盘明暗格 |
| snakeHead / snakeBody | `#1b7a3d` / `#3fae62` | 蛇头 / 蛇身 |
| food | `#d94f3d` | 食物 |

页面 chrome（本规范定义，与游戏绿调协调）：

| 令牌 | HEX | 用途与对比度 |
|------|-----|--------------|
| chrome-bg | `#eef1ea` | 页面背景（浅灰绿） |
| surface | `#ffffff` | HUD 行、遮罩面板、次按钮底色 |
| text-primary | `#22301f` | 标题/正文/数值（对 chrome-bg ≈ 12.2:1，对 surface ≈ 13.9:1） |
| text-secondary | `#57684f` | 说明文字、HUD 标签（对 chrome-bg ≈ 5.3:1，对 surface ≈ 6.0:1，均 ≥4.5:1） |
| brand | `#1b7a3d` | 主按钮底、焦点强调（复用 snakeHead；白字对其 ≈ 5.4:1） |
| brand-hover | `#166532` | 主按钮 hover |
| brand-active | `#124f28` | 主按钮 active |
| border | `#c9d6c2` | HUD/棋盘容器/次按钮描边（装饰性，无对比度要求） |
| record-bg / record-text | `#fbeae7` / `#a03325` | 破纪录徽标底/字（≈ 6.0:1；呼应 food 红但加深保证对比度） |
| scrim | `rgba(238, 241, 234, 0.88)` | 遮罩幕布（chrome-bg 88% 不透明度，隐约透出棋盘） |
| disabled-bg / disabled-text | `#e3e8df` / `#8b9784` | 禁用按钮（禁用态豁免对比度要求） |

### 2.2 字体与字号阶梯（px）

系统字体栈（零网络请求）：
`-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif`

| 阶梯 | 桌面 | 移动（≤480px） | 用途 |
|------|------|----------------|------|
| display | 28px / 700 / 行高 36px | 22px / 行高 28px | #game-title、遮罩大标题（已暂停/游戏结束） |
| title | 20px / 600 / 行高 28px | 18px / 行高 24px | HUD 数值、#over-score/#over-high 数值 |
| body | 16px / 400 / 行高 24px | 16px（不缩，保可读） | 按钮文字、遮罩正文 |
| caption | 14px / 400 / 行高 20px | 12px / 行高 18px | #game-help、遮罩提示行 |
| label | 12px / 500 / 行高 16px | 12px | HUD 标签「分数」「最高分」 |

数字（HUD 与结算数值）加 `font-variant-numeric: tabular-nums`，防跳动。

### 2.3 间距 / 圆角 / 阴影

- 间距体系（4px 基数）：`4 / 8 / 12 / 16 / 24 / 32`。页面内容列上下留白 32px（移动 16px）；标题→说明 8px；说明→HUD 16px；HUD→棋盘 12px；HUD 数据位横向间隔 24px（移动 12px）；遮罩面板内边距 24px（移动 16px），面板内元素纵向间隔 12px。
- 圆角：按钮 8px；HUD 行与遮罩面板 12px；棋盘容器 12px（canvas 直角即可，容器 `overflow: hidden` 裁切）；破纪录徽标 999px（胶囊）。
- 阴影：遮罩面板 `0 8px 24px rgba(34, 48, 31, 0.18)`；HUD 行 `0 1px 3px rgba(34, 48, 31, 0.08)`；按钮默认无阴影。
- 描边：HUD 行、棋盘容器、次按钮均 `1px solid #c9d6c2`。

## 3. 组件规范

### 3.1 按钮（三个契约按钮共用基样式）

- 尺寸：桌面高 40px、水平内边距 24px、字号 16px/600、圆角 8px；移动（≤480px）高 **44px**（触达目标 ≥44px，FR-11）。宽度随文案自适应，min-width 112px。
- **主按钮**（#btn-start、#btn-restart）：底 brand `#1b7a3d`、字 `#ffffff`、无描边。
  - hover：底 `#166532`；active：底 `#124f28` 且 `transform: translateY(1px)`；过渡 `background-color 120ms ease`（`prefers-reduced-motion: reduce` 时关闭过渡与位移）。
- **次按钮**（#btn-pause，常驻 HUD 行右端）：底 surface `#ffffff`、字 `#1b7a3d`、描边 `1px solid #c9d6c2`。
  - hover：底 `#f3f7f0`；active：底 `#e8efe3` + translateY(1px)。
  - 文案随状态：running →「暂停」（**TEXT.pause**，API v1.2 Lead 批准增补）；paused →「继续」（TEXT.resume）。TEXT.paused「已暂停」仅作暂停遮罩标题，不用作按钮文案。全部取自 TEXT，不得改动键值。
  - disabled（ready / over 两态）：底 `#e3e8df`、字 `#8b9784`、描边 `#e3e8df`、`cursor: not-allowed`，且设置原生 `disabled` 属性（不可聚焦、不响应点击）。
- **focus-visible（全部按钮）**：`outline: 3px solid #22301f; outline-offset: 2px;`（outline 落在浅色页面/面板底上，对比充分）；仅 `:focus-visible` 显示，鼠标点击不出现焦点环。
- **B1 双保险（必须实现）**：所有按钮 click 处理完成后立即 `blur()`；Enter 在 bindKeyboard 中 preventDefault（API §7），防止焦点残留导致 Enter 重开后误触暂停。

### 3.2 HUD（全状态常显，永不被遮罩覆盖）

- 容器：surface 白底、圆角 12px、描边 border、内边距 `8px 16px`，flex 单行：左起三个数据位（间隔 24px），右端 #btn-pause（`margin-left: auto`）。
- 数据位结构：`分数`/`最高分` 为「label（12px，text-secondary）上、数值（20px/600，text-primary）下」两行；**label 是独立静态元素**，因契约要求 #hud-score/#hud-high 的 textContent 仅为数字。速度位无独立 label：#hud-speed 整体 textContent = `'速度 x' + speed`（TEXT.speedPrefix 原值），单行 20px/600 垂直居中。
- 初始值：分数 `0`、最高分 `0`（无记录时，FR-01/FR-08 断言 #hud-high）、速度 `速度 x4`。吃食物同帧更新；最高分游玩中保持会话纪录值，死亡结算时才刷新（R7）。

### 3.3 遮罩（三个，hidden 属性显隐，仅覆盖棋盘容器）

- 共同：`position: absolute; inset: 0;` 于 .board-wrap 内；幕布 scrim；内容居中（flex 居中）；显隐**只用 hidden 属性**，禁止用 display/class 替代语义。角色：`role="dialog"` + `aria-modal="false"`（HUD 仍可交互）+ `aria-label` 分别为「开始游戏」「已暂停」「游戏结束」（不新增 id，故不用 aria-labelledby）。
- 面板：surface 白底、圆角 12px、描边 border、阴影见 §2.3、内边距 24px、宽 `min(320px, 棋盘宽 - 32px)`、内容纵向居中排列，元素间隔 12px。
- **#overlay-start**：提示行「按回车或点击按钮开始」（caption，text-secondary，新增文案 N1，见 §7）→ #btn-start「开始游戏」（TEXT.start）。标题/最高分/操作说明由遮罩外常显的 #game-title、#hud-high、#game-help 承担，面板内不重复。
- **#overlay-pause**：大标题「已暂停」（TEXT.paused，display，text-primary）→ 提示行「按空格或点击继续按钮恢复」（caption，text-secondary，新增文案 N2，见 §7）。面板内无按钮（继续入口 = HUD 行 #btn-pause，文案已切「继续」）。
- **#overlay-over**：大标题「游戏结束」（TEXT.over，display）→ 两列数据行：`分数 #over-score`、`最高分 #over-high`（label 12px 上、数值 20px/600 下，列间隔 32px，居中）→ #over-record 徽标「新纪录！」（TEXT.record；底 record-bg、字 record-text、14px/600、内边距 `4px 12px`、胶囊；**仅破纪录时移除 hidden，否则保持 hidden**）→ #btn-restart「重新开始」（TEXT.restart）→ 提示行「按回车也可重开」（caption，text-secondary，新增文案 N3，见 §7）。

### 3.4 棋盘容器与 canvas

- .board-wrap：正方形，`aspect-ratio: 1 / 1`，宽 `min(600px, 100% 内容列宽)`；`touch-action: none`；圆角 12px + `overflow: hidden` + 描边 border。
- #board：CSS 宽高 100% 填满容器；逻辑画布 600×600（20×20×CELL_SIZE 30），backing store 乘 devicePixelRatio，缩放走 `renderer.resize(cssWidth)`（API §6），CSS 不得拉伸变形。

## 4. 四状态视觉描述（单页状态机）

| phase | 可见遮罩 | #btn-pause | #btn-start / #btn-restart | HUD | 棋盘画面 |
|-------|----------|------------|---------------------------|-----|----------|
| ready | #overlay-start | disabled，文案「暂停」 | start 可见可点 / restart 随遮罩隐藏 | 常显：0 / 历史最高 / 速度 x4 | 初始蛇（3 节向右）+ 首个食物已绘制，静止 |
| running | 无（三个全 hidden） | 可用，文案「暂停」 | 均随遮罩隐藏 | 分数/速度同帧更新 | 蛇按速度移动 |
| paused | #overlay-pause | 可用，文案「继续」（TEXT.resume） | 均隐藏 | 常显，保持暂停瞬间值 | 静止，保留暂停瞬间蛇形（幕布下隐约可见） |
| over | #overlay-over | disabled，文案「暂停」 | restart 可见可点 / start 隐藏 | 常显；最高分按结算刷新 | 静止，保留死亡瞬间蛇形 |

状态切换即时生效（无淡入淡出硬性要求；如加过渡限 120ms 且尊重 reduced-motion）。遮罩出现时将焦点移到对应主按钮（start→#btn-start，over→#btn-restart，paused→#btn-pause），便于纯键盘闭环；点击后按 B1 立即 blur。

## 5. 响应式断点与移动端布局

- 断点仅一个：**480px**。>480px 用桌面令牌；≤480px 用移动令牌（§2.2）。
- 内容列：桌面宽 600px 居中、页面左右留白 ≥24px；移动宽 `100vw - 24px`（左右各 12px），棋盘随之自适应正方形缩放，**不横向溢出**（FR-11）。
- 移动 HUD：仍单行「分数 | 最高分 | 速度 xN | 暂停按钮」，数据位间隔缩至 12px、容器内边距 `8px 12px`、数值 18px；320px 宽下若仍放不下，允许 HUD 折为两行（数据一行、按钮一行右对齐），但 #btn-pause 必须始终在首屏可见、可点（高 44px）。
- 移动端完整闭环（无键盘）：点 #btn-start 开始 → 棋盘容器滑动转向（阈值 30 CSS px、主导轴判定，API §7）→ 点 #btn-pause 暂停/继续 → 死亡后点 #btn-restart 重开。
- 页面纵向可滚动（棋盘容器外不拦截触摸）；棋盘上滑动不得触发页面滚动/下拉刷新（touch-action:none + touchmove preventDefault）。
- 横屏手机不做专门优化，按宽度断点自然降级即可。

## 6. 无障碍要求

1. 对比度：正文/数值/说明对各自底色 ≥4.5:1（§2.1 已标注）；按钮文字对白/绿底 ≥4.5:1；禁用态豁免。
2. 焦点可见：所有可交互元素 `:focus-visible` 外显 3px `#22301f` outline（offset 2px）；不得 `outline: none` 一删了之。
3. 键盘全闭环（API §7 phase×输入表为准）：ready 回车/空格开始；running 空格或 P 暂停、方向键/WASD 转向；paused 空格/P/「继续」按钮恢复（方向键无效）；over 回车/空格重开。Enter/空格/方向键全局 preventDefault（防页面滚动与按钮原生激活，B1）。
4. 遮罩语义：`role="dialog"` + `aria-modal="false"` + 中文 aria-label（§3.3）；hidden 时天然不可聚焦、对读屏隐藏。
5. HUD：容器可加 `aria-label="游戏状态"`；#hud-score 高频更新**不加 aria-live**（避免读屏轰炸）；死亡结算后焦点移至 #btn-restart，读屏经由 dialog 播报「游戏结束」。
6. 语言与文案：`<html lang="zh-CN">`；契约文案一律取 TEXT 原值（标题「贪食蛇」、按钮「开始游戏」「暂停」「继续」「重新开始」、提示「新纪录！」等）；TEXT 未覆盖的新增文案**仅限 §7 清单四条**，逐字实现，不得自行发挥。
7. 动效：`prefers-reduced-motion: reduce` 时移除按钮位移与一切过渡；游戏本体动画不受影响（属核心玩法）。
8. 触达：移动端全部按钮命中区 ≥44×44px；#btn-pause 与棋盘间留 ≥8px 防误触。

## 7. 新增文案清单（TEXT 之外，前端逐字实现，不得自行发挥）

| 编号 | 位置 | 逐字文案（简体中文） |
|------|------|----------------------|
| N1 | #overlay-start 提示行 | 按回车或点击按钮开始 |
| N2 | #overlay-pause 提示行 | 按空格或点击继续按钮恢复 |
| N3 | #overlay-over 提示行 | 按回车也可重开 |
| N4 | HUD 容器 aria-label（读屏专用，不可见） | 游戏状态 |

其余全部界面文案复用 TEXT 现有值：遮罩 aria-label 分别取 TEXT.start / TEXT.paused / TEXT.over；HUD 标签取 TEXT.scoreLabel / TEXT.highLabel；#btn-pause 取 TEXT.pause / TEXT.resume。除上表四条外不得新增任何文案。
