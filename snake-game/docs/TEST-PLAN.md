# 测试计划（TEST-PLAN.md）

- 版本：v1.0 ｜ 作者：qa（ai-dev-team 流水线）
- 上游依据：[PRD.md](./PRD.md) v1.0 §5（P0 Given/When/Then 为断言的唯一需求依据）、[API.md](./API.md) v1.2（模块契约）、[ARCHITECTURE.md](./ARCHITECTURE.md) v1.1 §9（测试要求）、[UI-SPEC.md](./UI-SPEC.md) v1.0（HUD 常显/遮罩仅盖棋盘/按钮状态）
- 被测对象：`frontend/js/*.js` + `frontend/index.html` + `frontend/styles.css`（单机版贪食蛇，无后端，backend N/A）
- 职责边界：本计划与 `tests/` 由 qa 编写；**执行与结果汇报由 qa-runner 负责**。qa 仅做 `node --check` 语法自检，不执行业务测试、不改业务代码、不做 git 操作。

## 1. 执行命令与环境要求

### 1.1 命令（cwd = `snake-game/` 根目录）

| 用途 | 命令 |
|------|------|
| 全部单元测试 | `npm run test:unit`（即 `node --test tests/unit/`） |
| 全部 e2e | `npm run test:e2e`（即 `playwright test --config tests/e2e/playwright.config.js`） |
| 全量 | `npm test` |
| 单个单元文件 | `node --test tests/unit/engine.test.js` |
| 单个 e2e 用例 | `npx playwright test --config tests/e2e/playwright.config.js -g "E-G10"` |

### 1.2 环境（已就绪，直接采用）

- Node v22（内置 `node:test` + `node:assert`，CJS `require` 直接加载 `frontend/js/{constants,rng,engine,storage}.js`；renderer/input/app 仅浏览器，单测禁止 require）。
- `@playwright/test@1.59.0` 已安装（node_modules 就绪），chromium-1217 已缓存，无需下载浏览器。
- e2e webServer：`python3 -m http.server 4174 --bind 127.0.0.1 --directory frontend`（配置内 cwd 为 snake-game 根，`reuseExistingServer: true`）。**4173 已被 Lead 冒烟服务器占用，本套件固定 4174。**
- e2e 参数：workers=1、fullyParallel=false、reporter 'list'、默认 viewport 1280×800、baseURL `http://127.0.0.1:4174`；移动端用例单独 `test.use` viewport 390×844、hasTouch、isMobile。
- 页面测试钩子：URL `?seed=<uint32>` 固定随机；`window.SnakeGame.debug.getState()` 只读深拷贝快照。**全部游戏进度断言走 getState + waitForFunction，无固定 sleep**；「画面静止」用 rAF 帧数等待后断言 tickCount 不变。
- file:// URL 由 `path.resolve(__dirname, '../../frontend/index.html')` 构造，不硬编码绝对路径。

### 1.3 反 flaky 设计要点

1. 吃食物助手（`tests/e2e/helpers.js`）：读快照 → BFS 规划（蛇身含尾节为障碍，R5；尽量避开边缘格）→ 前瞻两格安全校验 → 真实 `keyboard.press` → `waitForFunction` tickCount 递增后再按下一键；每食物最多 300 拍护栏。
2. 死亡驱动：蛇沿当前方向直行必撞墙（棋盘有限宽），`waitForFunction phase==='over'`，无需猜测时间。
3. 转向用例均为不回绕的阶梯路径或独立开局，避免自撞干扰；180°/阈值类「无变化」断言先等 2 拍再断言。
4. 每用例独立浏览器上下文（localStorage 隔离）；错误监控 fixture 收尾统一断言 pageerror/console error 为空（浏览器自发 favicon 404 除外）。
5. 移动端滑动用 CDP `Input.dispatchTouchEvent` 真实触摸事件（位移 60px ≥ 30px 阈值）。

## 2. 用例矩阵

优先级：P0 = MVP 必须；P1 = 本期尽量交付；契约 = API.md 写死的模块契约（含评审决议 B1/M1/M2/m1/R5）。
归属：unit = `tests/unit/`（node:test）；e2e = `tests/e2e/`（Playwright）。

### 2.1 单元测试（58 条 test()：rng 6 + engine 39 + storage 13）

#### Rng（tests/unit/rng.test.js，API §4）

| 用例 id | FR/契约 | 优先级 | 前置 | 步骤 | 断言 |
|---------|---------|--------|------|------|------|
| U-RNG-01 | API §4 | P0 | 无 | 6 种子各迭代 next 200 次 | value∈[0,1)；state 为 uint32 |
| U-RNG-02 | API §4 | P0 | 无 | 与自写参考 mulberry32 逐位对比（6 种子×200 次） | state/value 完全一致 |
| U-RNG-03 | API §4 | P0 | 无 | 同输入重复调用、中间插入异参调用 | 纯函数，输出恒同 |
| U-RNG-04 | API §4 | P0 | 无 | nextInt 多种 n（1..1000000）×6 种子 | value=floor(next.value×n)∈[0,n-1]；state 与 next 一致 |
| U-RNG-05 | API §4 | P0 | 无 | n=1 | value 恒 0 |
| U-RNG-06 | API §4 | P0 | 无 | n=0/-1/-100 | 抛 RangeError |

#### Engine（tests/unit/engine.test.js，API §3）

| 用例 id | FR/契约 | 优先级 | 前置 | 步骤 | 断言 |
|---------|---------|--------|------|------|------|
| U-ENG-01 | API §3.1 | P0 | createGame({seed:42}) | 检查全字段 | phase=ready；20×20；蛇 [(8,10),(7,10),(6,10)]；right；pending=null；score/foodEaten/tickCount=0；speed=4；rngState=next(seed).state（首食物已流转一次，T-01 修正）；config.seed=seed；config 冻结 |
| U-ENG-02 | API §3.5 | P0 | 5 个种子 | 首食物与参考实现推演对比 | food=行优先空白格[ref 值]（397 格）；不在蛇身；rngState 流转 |
| U-ENG-03 | API §3.1 | P0 | 8×6/len2 | createGame | 头 (2,3)、蛇 2 节、食物界内 |
| U-ENG-04 | API §3.1 | P0 | 边界合法值 | 5×5/len1、速度 1..60、seed 0/4294967295、len9 | 不抛错且初值正确 |
| U-ENG-05 | API §3.1 | P0 | 无 | width 4/5.5/'20'、height 4/0 | RangeError |
| U-ENG-06 | API §3.1 | P0 | 无 | initialLength 0/10/1.5、5×5 时 len2 | RangeError |
| U-ENG-07 | API §3.1 | P0 | 无 | initialSpeed 0/13/2.5、maxSpeed 61/3、initial>max | RangeError |
| U-ENG-08 | API §3.1 | P0 | 无 | foodsPerLevel 0/1.5、scorePerFood 0/-1 | RangeError |
| U-ENG-09 | API §3.1 | P0 | 无 | seed -1/4294967296/1.5/'42'/null/NaN | RangeError |
| U-ENG-10 | API §3.2 | P0 | ready | start→pause→resume | 均 true，phase 正确迁移 |
| U-ENG-11 | API §3.2 | P0 | 各 phase | 非法迁移（ready pause/resume、running start/resume、paused start/pause） | false 且 snapshot 无副作用 |
| U-ENG-12 | API §3.1 | P0 | ready/paused/over | tick | ok=false 全空结果；state 完全未变 |
| U-ENG-13 | FR-02 验收① | P0 | 蛇向右 running | submit up → tick | pending=up；头 (8,9)；direction=up；pending 清空 |
| U-ENG-14 | FR-02 验收② | P0 | 蛇向右 | submit left → tick | false；pending=null；仍向右 (9,10) |
| U-ENG-15 | FR-02 验收③ | P0 | 蛇向右 | 同拍 up 后 left → tick | left 拒绝；仅 up 生效；不自撞死亡 |
| U-ENG-16 | API §3.4 边界表 | P0 | 蛇向右 | up 后 down；同向 down；left 后 down | 末次覆盖 down；同向拒绝不占槽位（pending 保持 left） |
| U-ENG-17 | API §3.3【D-01】 | P0 | running | 非法枚举 12 种（含 'constructor'/'toString' 等原型键） | 一律 false 且 state 不变。**当前实现预期失败，见缺陷 D-01** |
| U-ENG-18 | FR-06/API §3.3 | P0 | ready/paused/over | 4 方向逐一 submit；paused 时 tick | 全 false；state 不变；暂停中不动 |
| U-ENG-19 | API §3.3 | P0 | running | 连续 tick（含按键拍） | 每拍后 pendingDirection 必 null |
| U-ENG-20 | API §3.4 ② | P0 | 头 (10,0) 向右 | submit up → tick（越上界） | 死亡拍仍提交 direction=up、pending=null；newHead 不写入 |
| U-ENG-21 | FR-05 | P0 | 旧局有 pending/暂停 | createGame 新局 | pending=null、right、tickCount=0、ready、score=0、无残留 |
| U-ENG-22 | FR-03 验收② | P0 | 蛇向右，食物远端 | tick 空白格 | 整体前移；长度/分数不变；moved=true/ate=false；tickCount+1 |
| U-ENG-23 | FR-03 验收① | P0 | 食物在头正前方 | tick | 长度+1、score+10、foodEaten+1、不弹尾；newFood 不在蛇身且=state.food；rngState 流转 |
| U-ENG-24 | FR-03 | P0 | 100×5/len1 | 连续吃 30 个 | 新食物恒不在蛇身；score=10k；长度=1+k |
| U-ENG-25a~d | FR-04 验收① | P0 | 头贴四边、方向朝外 | tick（右/左/上/下各一条） | died/wall；newHead 不写入；score/food 保留；tickCount 计死亡拍；result.head=死亡前蛇头；moved/ate=false |
| U-ENG-26 | FR-04 验收② | P0 | 蛇长 5 盘绕 | tick 头入非尾节蛇身 | died/self；蛇形保留；tickCount+1 |
| U-ENG-27 | R5 尾节不让位① | 契约 | 2×2 环形蛇 | tick 头入当前尾节 | 判死 self（按 PRD 字面，尾节不让位） |
| U-ENG-28 | R5 尾节不让位② | 契约 | 尾节已让位一格 | 3 拍后头入上一拍让位格 | 安全存活（对照用例） |
| U-ENG-29 | M1 cleared | 契约 | 5×5/len1，蛇占 24 格、食物最后一格、foodEaten=4 | tick 吃最后一格 | ok/moved/ate/died=true；deathCause='cleared'；newFood=null；head=(4,4)（写入后）；蛇长 25 覆盖全盘；food=null；rngState 不变；tickCount+1；speedChanged=true（第 5 食物 4→5） |
| U-ENG-30 | FR-09 验收① | P0 | 100×5/len1 | 吃 15 个 | 第 5/10/15 提速；speed=min(4+floor(k/5),12)；speedChanged 仅提速拍 true |
| U-ENG-31 | FR-09 验收② | P0 | 同上 | 吃 45 个 | 40 个达 12 封顶；之后不再增加、计分生长照常 |
| U-ENG-32 | FR-09/API §3.1 | P0 | foodsPerLevel=2/initialSpeed=2/maxSpeed=3 | 吃 6 个 | 速度序列 2,3,3,3,3,3；speedChanged 仅第 2 拍 |
| U-ENG-33 | API §3.1 | P0 | scorePerFood=7 | 吃 3 个 | score=7k |
| U-ENG-34 | API §3.5 | P0 | 同 seed 两局 | 同输入序列（强制吃 12 个 / 40 拍固定转向） | 食物序列与终态 snapshot 完全一致 |
| U-ENG-35 | API §3.5 | P0 | seed 1/2/123456789 | 参考推演首食物 | 与实现一致；三种子首食物不全同（确定性断言） |
| U-ENG-36 | API §3.2 | P0 | running | snapshot 后改快照各字段 | 原 state 不受影响；JSON 往返等价 |

#### Storage（tests/unit/storage.test.js，API §5）

| 用例 id | FR/契约 | 优先级 | 前置 | 步骤 | 断言 |
|---------|---------|--------|------|------|------|
| U-STO-01 | FR-08 | P0 | 空内存后端 | createStorage | load=0；isPersistent=true |
| U-STO-02 | NFR-04/API §5 | P0 | 空后端 | save(100)；新实例读同后端 | 键=Constants.STORAGE_KEY='snake-game.highScore.v1'；值 '100' 无前导零；仅 1 键；跨实例恢复 |
| U-STO-03 | API §5 | P0 | 持久值 100 | save 100/50/0/200 | ≤最高分 false 且不触发 setItem；200 true |
| U-STO-04 | API §5 | P0 | 持久 500→save600→外部改 50 | load | max(内存,持久)=600 |
| U-STO-05 | API §5 | P0 | 任意 | save -1/0.5/'10'/NaN/Infinity/null/undefined | RangeError |
| U-STO-06 | API §5 | P0 | 损坏值 abc/''/-5/1.5/1e3/' 12'/'12 '/0x10 | load | 按 0；不降级 |
| U-STO-07 | API §5 | P0 | 超安全整数/最大安全整数 | load | 9007199254740992 与 20 位串按 0；9007199254740991 接受 |
| U-STO-08 | API §5【C-01】 | P0 | 持久值 '007' | load；另验写入格式 | 按 API 字面正则接受 →7；写入侧无前导零。**与任务简报「前导零按 0」冲突，见澄清项 C-01** |
| U-STO-09 | FR-08 降级 | P0 | backend=null | load/save | isPersistent=false；save false 但会话内 load 正确更新 |
| U-STO-10 | FR-08 降级 | P0 | 构造探测 getItem 抛异常 | createStorage/save | 降级；load=0；save false 但内存更新 |
| U-STO-11 | API §5 | P0 | 构造成功后读抛异常 | load | 按 0；persistent=false |
| U-STO-12 | FR-08/API §5 | P0 | setItem 抛异常 | save(100)/save(200) | false；persistent=false；内存值已更新（load=100/200） |
| U-STO-13 | API §5 | P0 | 写失败后后端恢复 | isPersistent 迁移 | true→false 后不自动恢复；会话值继续更新 |

### 2.2 e2e 测试（24 条：game 17 + file 2 + mobile 5）

#### 桌面 http（tests/e2e/game.spec.js，viewport 1280×800）

| 用例 id | FR/契约 | 优先级 | 前置 | 步骤 | 断言 |
|---------|---------|--------|------|------|------|
| E-G01 | FR-01 验收① | P0 | ?seed=42 加载 | 检查开始界面 | #game-title='贪食蛇'；#game-help=TEXT.help 逐字；#hud-high='0'；#hud-score='0'；#hud-speed='速度 x4'；#overlay-start 可见、其余遮罩隐藏；#btn-pause disabled 文案「暂停」；#btn-start='开始游戏'；ready/蛇 3/有食物 |
| E-G02 | FR-01 验收② | P0 | 开始界面 | 点击开始 | running；20×20；蛇长 3 向右；1 食物；score=0；开始遮罩隐藏；#btn-pause 可用 |
| E-G03 | FR-01 | P0 | ready | 按 Enter | running |
| E-G04 | FR-01 | P0 | ready | 按空格 | running |
| E-G05 | FR-02 | P0 | 每场景独立开局 | 8 键逐一真实按下（ArrowUp/w/ArrowDown/s/w+ArrowLeft/w+a/w+ArrowRight/w+d） | direction 按契约提交；全程存活 |
| E-G06 | FR-02 验收② | P0 | running 向右 | ArrowLeft、a；转 up 后 ArrowDown | 方向不变、pending=null、不自撞 |
| E-G07 | FR-06 验收①② | P0 | running | 空格暂停→等 40 帧→暂停中按方向→空格恢复 | tickCount 静止；#overlay-pause 可见；#btn-pause='继续'；方向键无效不恢复；恢复后节拍继续 |
| E-G08 | FR-06 | P0 | running | p 暂停、P 继续 | phase 迁移与遮罩显隐正确 |
| E-G09 | FR-03/04/05/07 | P0 | running | BFS 助手吃 1 食物→直行撞墙→Enter 重开 | score+10/长度+1/新食物不在蛇身；#hud-score='10' 即时；死亡 wall；#overlay-over/#over-score/#over-high=state 契约值；重开 score=0/蛇 3/speed=4；#hud-high 保留 |
| E-G10 | B1（FR-05 验收路径） | 契约 | running | 鼠标点 #btn-pause 暂停→点继续→撞墙死亡→Enter | 新局必须 running（再走 2 拍复核）；暂停遮罩隐藏；按钮文案「暂停」 |
| E-G11 | FR-04 验收③/FR-08 验收① | P0 | 新上下文 | 吃食物后死亡→刷新→第二局死亡 | #over-record 可见='新纪录！'；#hud-high 更新；刷新后 #hud-high 保留；第二局徽标按 score>appHigh 契约显隐 |
| E-G12 | FR-08 验收② | P0 | addInitScript 使 localStorage getter 抛异常 | 开局→吃食物→死亡→重开 | 游戏可玩；#over-high/#hud-high 会话内更新；破纪录提示；全程无 pageerror（fixture） |
| E-G13 | FR-09 验收① | P0 | running | BFS 助手连吃 5 个 | speed=5、score=50；#hud-speed='速度 x5'（超时放宽 180s） |
| E-G14 | M2/FR-07/UI-SPEC §3 | 契约 | 四状态流转 | ready/running/paused/over 逐态检查 | HUD 三位常显；三遮罩 boundingBox 均不与 #hud-high 相交；#hud-score 纯数字；#btn-pause ready/over disabled、running「暂停」/paused「继续」 |
| E-G15 | FR-12 | P1 | running | dispatchEvent(blur)→等 30 帧→空格 | 自动 paused；画面静止；需手动继续 |
| E-G16 | NFR-03 | P0 | 完整玩一局 | 收集全部 page request | ≥9 个请求全部同源 http://127.0.0.1:4174/；无 console error（fixture） |
| E-G17 | R8/m1 | 契约 | ?seed=42 | 刷新对比；死亡后 Enter 重开；?seed=99999999999 与 ?seed=abc | 同 seed 首食物/rngState 一致；重开复用 seed；非法种子忽略不崩溃可开局 |

#### file:// 直开（tests/e2e/file.spec.js）

| 用例 id | FR/契约 | 优先级 | 前置 | 步骤 | 断言 |
|---------|---------|--------|------|------|------|
| E-F01 | A6/NFR-03/R3 | P0 | file://…index.html?seed=123 | ready→点开始→走 2 拍 | seed 钩子可用；running；零 http(s) 请求；无 pageerror |
| E-F02 | m1 | 契约 | file://?seed=99999999999 / ?seed=abc | 加载→开始 | 不崩溃；ready→running；无 pageerror |

#### 移动端（tests/e2e/mobile.spec.js，390×844、hasTouch、isMobile）

| 用例 id | FR/契约 | 优先级 | 前置 | 步骤 | 断言 |
|---------|---------|--------|------|------|------|
| E-M01 | FR-11 | P1 | 移动端加载 | 量 #board-wrap/#btn-pause；点开始 | 棋盘宽 ≤390 且不溢出页面（scrollWidth≤390）；#btn-pause 首屏可见、高 ≥44px、ready disabled→running 可用 |
| E-M02 | FR-10 | P1 | running | CDP 真实触摸：上/右/下/右滑（60px） | direction 依次 up/right/down/right；页面 scrollY 不变（不触发滚动） |
| E-M03 | FR-10 | P1 | running | 上滑后左滑 | direction=left；存活 |
| E-M04 | FR-10/API §7 | P1 | running | 斜向 (60,40)/(40,60)；10px 微滑 | 主导轴判定 right/down；<30px 忽略（方向不变、pending=null） |
| E-M05 | FR-11 闭环 | P1 | 移动端 ready | 点开始→上滑→点暂停→点继续→撞墙→点重开 | 全程无键盘；各 phase 与遮罩/按钮文案正确；重开 score=0/蛇 3/running |

### 2.3 覆盖汇总

- **FR 覆盖：FR-01 ~ FR-12 全部 12 条**（P0 九条全部单元+e2e 双层覆盖；P1 三条 e2e 覆盖）。另覆盖契约决议 B1/M1/M2/m1/R5/R7/R8 与 NFR-03（零网络）、NFR-04（单键存储）、NFR-06（纯逻辑可测）。
- FR-13~FR-16 为 P2 明确延后，不在本期测试范围。
- 用例总数：**82 条**（单元 58：rng 6 / engine 39 / storage 13；e2e 24：game 17 / file 2 / mobile 5）。
- PRD §5 每条 P0 Given/When/Then 均有对应断言（FR-02 三条 → U-ENG-13/14/15 + E-G05/06；FR-09 两条 → U-ENG-30/31 + E-G13；其余见矩阵 FR 列）。

## 3. 缺陷清单（qa 只记录，不改业务代码）

### D-01【一般·契约健壮性】submitDirection 非法枚举校验可被原型链键穿透，污染 GameState

- **状态：已修复（dev：Lead），qa-runner 复跑确认通过（U-ENG-17 转绿），本缺陷关闭。** 修复方式：engine.js `DIRECTIONS` 与 input.js `KEYMAP` 均改为 `Object.assign(Object.create(null), {...})` 无原型字典；Lead 已实测 `'constructor'/'toString'/'valueOf'/'hasOwnProperty'/'__proto__'/'UP'/''` 全部返回 false 且 state 不变。U-ENG-17 断言无需改动，qa-runner 复跑通过后本缺陷即可关闭。
- 位置（修复前）：`frontend/js/engine.js` `submitDirection`（`var DIRECTIONS = { up:true, ... }` 普通对象 + `if (!DIRECTIONS[dir])` 查表）。
- 现象：`dir='constructor'/'toString'/'valueOf'/'hasOwnProperty'` 等原型链键查表为 truthy，绕过非法枚举校验 → 返回 true 并写入 `pendingDirection`；下一拍 `direction` 被置为该键，`DELTA[dir]` 取到原型值（函数），`d.x/d.y` 为 undefined → 蛇头坐标变 NaN 写入 snake，违反 API §3.1「坐标为整数」不变量与 §3.2/§3.3「dir 非法枚举返回 false、state 不变」。
- 复现：`npm run test:unit` 中 **U-ENG-17**（按契约断言，修复前该用例预期失败，属已知缺陷而非测试错误）。
- 影响面：UI 真实键盘路径不可触发（input.js KEYMAP 只产出四个合法枚举），仅 Node/调试直接调用 API 时可触发；定级一般。
- 修复建议（供 dev 参考）：查表改 `Object.prototype.hasOwnProperty.call(DIRECTIONS, dir)`，或 `DIRECTIONS = Object.assign(Object.create(null), {...})`；DELTA 查表同理加固。

### C-01【澄清项·非代码缺陷】损坏持久值「前导零」的取值口径冲突

- **状态：已裁决（Lead）：按 API.md v1.2 §5 字面为准，无需改动。** 读取正则 `/^\d+$/` 且安全整数接受 `'007'`→7；「无前导零」仅约束**写入值格式**（`String(score)` 永不产生前导零）。QA 简报中「前导零按 0」表述不准确，以契约为准。实现与 U-STO-08 断言均维持原样，本项关闭。
- 冲突（记录留档）：QA 任务简报曾要求「前导零按 0」；但 API.md v1.2 §5 的读取接受条件字面为「`/^\d+$/` 且安全整数」，`'007'` 满足两者 → 应取 7。被测实现与 API 字面一致，不构成实现缺陷。

### T-01【测试自身问题】U-ENG-01 rngState 初值断言与契约矛盾，已修正

- **状态：已修正（qa），qa-runner 复跑确认 rngState 断言通过，本项关闭（同用例冻结写入问题另见 T-02）。** 现象：qa-runner 复跑报 U-ENG-01 `assert.equal(s.rngState, 42)` 失败（实际 1831565855）。
- 原因：测试断言错误，非业务缺陷。API §3.1 明确「首个食物在 createGame 内用 rng 生成」、§3.5 明确 rngState 经 nextInt 流转，故 createGame 返回时 rngState 必已前进一次；原断言把 rngState 初值写成 seed 原值，与同文件 U-ENG-02（参考实现断言流转值，通过）互相矛盾。
- 修正：`tests/unit/engine.test.js` U-ENG-01 该行改为 `assert.equal(s.rngState, refNext(42).state)`（与 U-ENG-02 同口径的参考 mulberry32），并补 `assert.equal(s.config.seed, 42)` 保留「seed 原值记录于 config」的断言意图；§2.1 矩阵 U-ENG-01 行断言描述同步更正。仅此一处测试文件改动，业务代码未动。
- 环境备注（Lead 通知留档）：package.json `test:unit` 脚本已由 Lead 从 `node --test tests/unit/`（Node 22.23.1 不展开目录参数，实测 MODULE_NOT_FOUND）改为 `node --test tests/unit/*.test.js`（实测 58 条全部被发现）；`npm run test:unit` 命令本身不变，本计划 §1 命令表无需改动。

### T-02【测试自身问题】U-ENG-01 冻结 config 写入断言误用 sloppy 模式语义，已修正

- **状态：已修正（qa），qa-runner 复跑确认通过，本项关闭。** 现象：qa-runner 复跑报 U-ENG-01 第 86 行 `s.config.width = 5` 抛 TypeError「Cannot assign to read only property 'width'」。
- 原因：测试写法错误，非业务缺陷。本文件头部为 `'use strict'`，严格模式下对冻结对象写入**抛 TypeError**；原写法 `s.config.width = 5; /* 冻结对象写入应无效 */` 依赖的是 sloppy 模式的静默无效语义。业务代码 config 冻结行为本身符合 API §3.1。
- 修正：`tests/unit/engine.test.js` U-ENG-01 该处改为 `assert.throws(() => { s.config.width = 5; }, TypeError)`，并保留随后 `assert.equal(s.config.width, 20)` 断言（写入被拒后原值不变）。仅此一处测试文件改动，业务代码未动；node --check 通过。
- 复跑背景（qa-runner 通报留档）：T-01 修正后 rngState 断言已通过；其余 57 条全部通过（含 U-ENG-17，D-01 修复获复跑确认）。**收尾复跑最终结果：npm run test:unit 58/58 全绿（U-ENG-01 通过，T-02 修复确认）；e2e 24/24 通过。缺陷清单 D-01/C-01/T-01/T-02 全部关闭。**执行报告由 Lead 产出 docs/TEST-REPORT.md。

### 其他说明

- 除 D-01 外，静态审查未发现被测代码与 API v1.2 契约的偏离；cleared（M1）、尾节不让位（R5）、死亡拍不写入、acc 清零、B1 双保险（Enter preventDefault + 按钮 blur）、m1 种子校验、m2 补拍循环均与契约一致，已按契约值编写断言，最终以 qa-runner 执行结果为准。
- 已知可接受的微小竞态：e2e 真实按键与节拍结算存在毫秒级窗口，助手已用「BFS 避边缘 + 前瞻两格安全 + 逐拍等待」压缩到可忽略；若 qa-runner 观察到偶发失败，请附 trace（retain-on-failure 已开启）反馈 qa 分析，不得以固定 sleep 修补。

## 4. 交付物清单

| 文件 | 说明 |
|------|------|
| `docs/TEST-PLAN.md` | 本计划 |
| `tests/unit/rng.test.js` | Rng 6 条 |
| `tests/unit/engine.test.js` | Engine 39 条（含 D-01 契约断言） |
| `tests/unit/storage.test.js` | Storage 13 条（含 C-01 口径断言） |
| `tests/e2e/playwright.config.js` | e2e 配置（4174 端口/webServer/workers=1） |
| `tests/e2e/helpers.js` | 错误监控 fixture、状态等待、BFS 吃食物助手、CDP 滑动助手 |
| `tests/e2e/game.spec.js` | 桌面 http 17 条 |
| `tests/e2e/file.spec.js` | file:// 2 条 |
| `tests/e2e/mobile.spec.js` | 移动端 5 条 |
