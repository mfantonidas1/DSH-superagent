# 内部模块接口契约（API.md）

- 版本：v1.2（v1.1 按 ARCH-REVIEW.md 修复 B1/M1/M2/m1/m2 并复审 approved；v1.2 为 Lead 批准的纯增补：TEXT.pause='暂停'，running 态 #btn-pause 按钮文案，无任何语义变更）｜ 作者：architect ｜ 本项目**无 HTTP API**（backend N/A，见 ARCHITECTURE.md §1），本文件为前端与 QA 并行开发的唯一依据。
- 约定：`integer` 指 JS 安全整数；`uint32` 指 0~4294967295 的整数；`Cell = {x: integer, y: integer}`；所有函数除注明外不抛异常。

## 1. 加载与导出约定（UMD 式，浏览器/Node 共用源码）

每个 `frontend/js/*.js` 使用统一模板（以 engine 为例）：

```js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./constants.js'), require('./rng.js'));
  } else {
    root.SnakeGame = root.SnakeGame || {};
    root.SnakeGame.Engine = factory(root.SnakeGame.Constants, root.SnakeGame.Rng);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Constants, Rng) {
  'use strict';
  /* 模块实现，返回 API 对象 */
});
```

- 浏览器：经典脚本（`<script src>`，**无 type="module"**），加载顺序 constants → rng → engine → storage → renderer → input → app；命名空间 `window.SnakeGame.{Constants,Rng,Engine,Storage,Renderer,Input}`。
- Node：`require('<repo>/snake-game/frontend/js/engine.js')` 直接可用（依赖走 require）；renderer/input/app 含 DOM 引用，**禁止**在 Node 单测中 require。
- 模块名与文件对应：constants→Constants、rng→Rng、engine→Engine、storage→Storage、renderer→Renderer、input→Input。

## 2. Constants（constants.js，纯常量）

| 导出 | 类型/值 |
|------|---------|
| GRID_WIDTH / GRID_HEIGHT | integer 20 / 20 |
| CELL_SIZE | integer 30（逻辑像素/格） |
| INITIAL_LENGTH / INITIAL_SPEED / MAX_SPEED | integer 3 / 4 / 12 |
| FOODS_PER_LEVEL / SCORE_PER_FOOD | integer 5 / 10 |
| MAX_FRAME_DELTA_MS | integer 250（循环 dt 钳制） |
| STORAGE_KEY | string `'snake-game.highScore.v1'` |
| DIRECTION | `{UP:'up', DOWN:'down', LEFT:'left', RIGHT:'right'}` |
| OPPOSITE | `{up:'down', down:'up', left:'right', right:'left'}` |
| DELTA | `{up:{x:0,y:-1}, down:{x:0,y:1}, left:{x:-1,y:0}, right:{x:1,y:0}}` |
| COLORS | `{boardLight:'#f3f7f0', boardDark:'#e8efe3', snakeHead:'#1b7a3d', snakeBody:'#3fae62', food:'#d94f3d'}`（string，可微调但键名固定） |
| TEXT | `{title:'贪食蛇', start:'开始游戏', pause:'暂停', paused:'已暂停', resume:'继续', over:'游戏结束', restart:'重新开始', record:'新纪录！', scoreLabel:'分数', highLabel:'最高分', speedPrefix:'速度 x', help:'方向键 / WASD 转向，空格暂停，回车开始/重开'}`（string；`pause` 为 v1.2 增补：running 态 #btn-pause 文案，paused 态该按钮文案为 `resume`） |

## 3. Engine（engine.js，纯逻辑，核心契约）

### 3.1 类型

- `Direction = 'up'|'down'|'left'|'right'`；`Phase = 'ready'|'running'|'paused'|'over'`；`DeathCause = 'wall'|'self'|'cleared'`。
- `Config`（createGame 入参，全部可选，缺省取默认）：

| 字段 | 类型 | 默认 | 约束（违反抛 RangeError） |
|------|------|------|---------------------------|
| width / height | integer | 20 / 20 | ≥5 |
| initialLength | integer | 3 | 1 ≤ 值 ≤ floor(width/2)-1 |
| initialSpeed / maxSpeed | integer | 4 / 12 | 1 ≤ initialSpeed ≤ maxSpeed ≤ 60 |
| foodsPerLevel | integer | 5 | ≥1 |
| scorePerFood | integer | 10 | ≥1 |
| seed | uint32 | `Date.now()>>>0` | 传入非 uint32 抛 RangeError |

- `GameState`（engine 原地修改的唯一状态对象，全部字段可 JSON 序列化）：

| 字段 | 类型 | 取值/不变量 |
|------|------|-------------|
| phase | Phase | 初始 'ready' |
| width / height | integer | 来自 Config，局内不变 |
| snake | Cell[] | 头在 index 0；长度 ≥ initialLength；坐标 0≤x<width、0≤y<height；无重复格 |
| direction | Direction | **上一节拍已提交的方向**；初始 'right' |
| pendingDirection | Direction \| null | 本节拍待生效转向，单槽位；初始 null；每次 tick 后必为 null |
| food | Cell \| null | 非蛇身格；仅 phase='over' 且 deathCause='cleared' 时为 null |
| score | integer | ≥0，scorePerFood 的倍数；初始 0 |
| foodEaten | integer | ≥0；初始 0 |
| speed | integer | `min(initialSpeed + floor(foodEaten/foodsPerLevel), maxSpeed)`；初始 initialSpeed |
| tickCount | integer | ≥0；每次有效 tick（含死亡拍）+1 |
| rngState | uint32 | 随机流转唯一来源；初始 = seed |
| deathCause | DeathCause \| null | 仅 phase='over' 时非 null |
| config | Config（冻结副本） | 记录本局全部参数，供 speed 重算与测试断言 |

初始蛇：头 `(floor(width/2)-2, floor(height/2))`（20×20 即 (8,10)），向左延伸 initialLength 节；首个食物在 createGame 内用 rng 生成。

- `TickResult`（tick 返回值）：

| 字段 | 类型 | 语义 |
|------|------|------|
| ok | boolean | false = phase≠'running'，state 完全未变，其余字段为 false/null |
| moved | boolean | true = 本拍蛇头成功写入并完成移动；wall/self 死亡拍或 ok=false 时为 false；cleared 拍为 true |
| ate | boolean | 本拍吃到食物；cleared 拍为 true |
| died | boolean | 本拍死亡（phase 已置 'over'） |
| deathCause | DeathCause \| null | 死亡原因 |
| newFood | Cell \| null | 本拍新生成食物坐标；cleared 拍为 null |
| speedChanged | boolean | 本拍 speed 变化；cleared 拍按公式正常计算 |
| head | Cell \| null | 结算后蛇头；wall/self 死亡时为死亡前蛇头；cleared 拍为写入后的 newHead；ok=false 时 null |

**cleared 拍取值写死（M1）**：ok=true、moved=true、ate=true、died=true、deathCause='cleared'、newFood=null、head=结算后蛇头（newHead 已写入 snake、不弹尾，蛇填满棋盘）、speedChanged 按公式正常计算；**与 wall/self 一样走 saveHighScore/破纪录结算**。

### 3.2 函数

| 签名 | 行为 |
|------|------|
| `createGame(config?: Partial<Config>): GameState` | 按 §3.1 初始化；生成首个食物；phase='ready' |
| `start(state): boolean` | 仅 'ready'→'running' 返回 true；其余 false 且无副作用 |
| `pause(state): boolean` | 仅 'running'→'paused' |
| `resume(state): boolean` | 仅 'paused'→'running' |
| `submitDirection(state, dir: Direction): boolean` | 见 §3.3；dir 非法枚举返回 false |
| `tick(state): TickResult` | 见 §3.4 |
| `snapshot(state): GameState` | 深拷贝（JSON 往返等价），供 debug 钩子与测试断言 |

### 3.3 输入契约（FR-02，逐条强制）

1. `phase≠'running'` → 返回 false，state 不变（暂停/开局/结束界面方向键全部无效）。
2. 校验基准 **恒为 `state.direction`**，禁止用 pendingDirection 做基准。
3. `dir === 基准` 或 `dir === OPPOSITE[基准]` → 返回 false（同向视为无效按键，不占槽位）。
4. 其余情况：`pendingDirection = dir`（**覆盖**旧值，末次有效按键生效），返回 true。无队列。
5. tick 提交：`direction = pendingDirection ?? direction`；`pendingDirection = null`。

### 3.4 tick 结算顺序与边界

顺序：① phase 检查 → ② 提交方向 → ③ `newHead = snake[0] + DELTA[direction]` → ④ 越界（x<0∨x≥width∨y<0∨y≥height）→ deathCause='wall' → ⑤ newHead 与 snake **任一节（含尾节）重合** → 'self'（R5 决议：尾节不让位，按 PRD 字面）→ ⑥ 头入 snake → ⑦ 若 newHead==food：score+=scorePerFood、foodEaten+=1、重算 speed、**不弹尾**、按 §3.5 生成新食物（empty.length===0 → cleared 分支，见下）；否则弹尾 → ⑧ tickCount+=1。
wall/self 死亡时：phase='over'，**newHead 不写入 snake**（保留死亡瞬间蛇形），score/food 保留，tickCount+=1（死亡拍计入）。cleared 拍：newHead 已写入、不弹尾、蛇填满棋盘，food=null、phase='over'、deathCause='cleared'，moved=ate=died=true（全字段取值见 §3.1），tickCount+=1，**与 wall/self 一样走 saveHighScore/破纪录结算**。

边界用例表（unit 必测，蛇向右、本节拍未结算）：

| 按键序列 | pendingDirection 结果 | 下一拍移动 |
|----------|----------------------|-----------|
| ↑ | 'up' | 上 |
| ← | null（180° 忽略） | 右 |
| ↑ 然后 ← | 'up'（← 相对已提交的右是反向，忽略） | 上 |
| ↑ 然后 ↓ | 'down'（均垂直于右，取末次） | 下 |
| → | null（同向忽略） | 右 |
| 暂停中按任意方向 | null（拒绝） | 不动 |

### 3.5 食物生成（可复现）

空白格 = 全盘去除 snake 占据格（此时新蛇头已写入），按**行优先**（y 外层 0→height-1，x 内层 0→width-1）枚举为数组 empty。**若 empty.length===0：不调用 nextInt，state.rngState 不变**，直接 food=null、phase='over'、deathCause='cleared'（cleared 分支，取值与结算见 §3.1/§3.4）。否则 `{state,value} = Rng.nextInt(state.rngState, empty.length)`；`food = empty[value]`；`state.rngState = state`。同 seed 同按键序列 → 食物序列完全一致。

## 4. Rng（rng.js，纯函数，mulberry32）

| 签名 | 行为 |
|------|------|
| `next(rngState: uint32): {state: uint32, value: number}` | value ∈ [0,1)；算法见下 |
| `nextInt(rngState: uint32, n: integer): {state: uint32, value: integer}` | value = floor(next().value × n) ∈ [0, n-1]；n<1 抛 RangeError |

```js
function next(s) {
  var t = (s + 0x6D2B79F5) >>> 0;
  var r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { state: t, value: ((r ^ (r >>> 14)) >>> 0) / 4294967296 };
}
```

## 5. Storage（storage.js，纯逻辑 + 注入后端）

- `StorageBackend = {getItem(key: string): string|null, setItem(key: string, value: string): void}`；两方法**允许抛异常**。浏览器侧由 app 传入 localStorage 包装（取 `window.localStorage` 本身须 try/catch，失败传 null）；Node 测试传内存 Map 实现或 null。
- `createStorage(backend: StorageBackend|null): Storage`：构造时 try 探测 `getItem(STORAGE_KEY)`；backend=null 或探测抛异常 → 降级内存模式。
- `Storage` 接口：

| 签名 | 行为 |
|------|------|
| `loadHighScore(): integer ≥0` | max(内存值, 持久值)；持久值仅接受 `/^\d+$/` 且为安全整数，否则按 0；读取抛异常 → 按 0 并置 persistent=false |
| `saveHighScore(score: integer ≥0): boolean` | score 非法抛 RangeError；score ≤ loadHighScore() → false 不写；否则先更新内存值，再 try setItem(STORAGE_KEY, String(score))：成功 true；抛异常 → persistent=false、返回 false（**内存值已更新，会话内仍正确**） |
| `isPersistent(): boolean` | 当前是否处于持久模式 |

- 键名固定 `snake-game.highScore.v1`（唯一存储键，NFR-04）；值格式：十进制整数字符串，无前导零。降级后游戏功能不受影响（FR-08）。

## 6. Renderer（renderer.js，仅浏览器）

- `createRenderer(canvas: HTMLCanvasElement, opts?: {cellSize?: integer}): {draw(state: GameState): void, resize(cssWidth: number): void}`；cellSize 默认 CELL_SIZE。
- 逻辑画布 `width*cellSize × height*cellSize`（默认 600×600）；backing store 乘 devicePixelRatio；`resize(cssWidth)` 设置 CSS 宽度并保持正方形比例（FR-11）。
- `draw` 为 state 的纯函数：清屏 → 棋盘格（boardLight/boardDark 交替）→ 食物（food 色圆形）→ 蛇（头 snakeHead、身 snakeBody）；不修改 state、不绘制任何文字（文字全在 DOM）。

## 7. Input（input.js，仅浏览器）与 App 契约

- `bindKeyboard(target: Window, handlers: KeyHandlers): () => void`（返回解绑函数）；仅 keydown；`e.repeat===true` 一律忽略；**方向键、空格与 Enter 均 preventDefault**（Enter 默认行为会激活聚焦按钮，必须阻断，见下「焦点冲突双保险」）。
- `KeyHandlers = {onDirection(dir: Direction): void, onSpace(): void, onEnter(): void, onPauseKey(): void}`。键位映射：ArrowUp/w/W→up，ArrowDown/s/S→down，ArrowLeft/a/A→left，ArrowRight/d/D→right，`' '`→onSpace，Enter→onEnter，p/P→onPauseKey。
- `bindTouch(el: HTMLElement, handlers: {onDirection(dir: Direction): void}): () => void`（P1）：touchstart 记起点、touchend 算位移；max(|dx|,|dy|) ≥ 30 CSS px 才触发，取主导轴（|dx|>|dy| 时水平）；el 设 `touch-action:none` 且 touchmove preventDefault（防滚动）。
- **app.js 控制器语义**（phase × 输入）：

| phase | 空格 | 回车 | P/暂停按钮 | 方向键 |
|-------|------|------|-----------|--------|
| ready | start | start | 无效 | 无效 |
| running | pause | 无效 | pause | submitDirection |
| paused | resume | 无效 | resume（按钮文案「继续」） | 无效 |
| over | restart | restart | 无效 | 无效 |

- **焦点冲突双保险（B1，FR-05 验收路径）**：场景——鼠标点 #btn-pause 暂停→再点继续（焦点残留于常驻按钮）→死亡→按 Enter：若 Enter 默认行为未阻断，window keydown 先 restart（phase→running），随后 Enter 默认行为触发聚焦按钮原生 click，把 running 的新局立即 pause，FR-05「按回车立即开新局」确定性失败。两条防线**缺一不可**：① bindKeyboard 对 Enter preventDefault（与方向键/空格并列写明）；② app 对 #btn-start/#btn-pause/#btn-restart 的 click 处理完成后立即调用该按钮 `blur()`。e2e 必测该路径（ARCHITECTURE §9）。
- 循环：rAF；`dt=min(now-last, MAX_FRAME_DELTA_MS)`；仅 running 累积 acc；start/restart/pause/resume 时 **acc=0**；每帧 draw + HUD 更新（tick 后同帧）。补拍循环写死为（m2）：

```js
var interval = 1000 / state.speed;
while (acc >= interval && state.phase === 'running') {
  Engine.tick(state);
  acc -= interval;
  interval = 1000 / state.speed; // 每次迭代按当前 speed 重算，提速即时生效
}
```

  dt 钳制后单帧补拍数 = ceil(250/interval)；「最多补 3 拍」仅对默认 maxSpeed=12（interval≥83.3ms）成立，Config 允许 maxSpeed 至 60。
- 死亡结算（wall/self/cleared 三种 deathCause 同一路径）：app 维护会话最高分 appHigh（初始 loadHighScore()）；score>appHigh 时更新 appHigh、saveHighScore(score)、显示 TEXT.record。HUD 最高分显示 appHigh（R7：游玩中不实时刷新）。
- 失焦（FR-12）：window 'blur' 或 document visibilitychange→hidden 且 running → pause。
- restart：`createGame(同 config)`；URL 未指定 seed 时新 seed=`Date.now()>>>0`，指定则复用；直接进入 running。
- **测试钩子**：`window.SnakeGame.debug = {getState(): GameState}`（snapshot 深拷贝，只读）；URL `?seed=<uint32>` 注入种子，校验为 `/^\d+$/` **且数值 ≤ 4294967295**，不满足按非法忽略（回退 `Date.now()>>>0`，m1），file:// 下同样可用。
- **DOM 契约**（e2e 选择器，id 固定）：标题 `#game-title`（textContent=TEXT.title）、操作说明 `#game-help`（textContent=TEXT.help）；canvas `#board`；HUD `#hud-score`/`#hud-high`/`#hud-speed`（textContent 分别为数字、数字、`'速度 x'+speed`），**在 ready/running/paused/over 全部 phase 常显**；FR-01/FR-08「开始界面显示最高分」统一断言 `#hud-high`（无记录时为 '0'）。遮罩 `#overlay-start`/`#overlay-pause`/`#overlay-over`（hidden 属性控制显隐）**仅覆盖棋盘区（canvas 所在容器），不得覆盖 HUD**（FR-07「最高分区域不被遮挡」据此断言，M2）；按钮 `#btn-start`/`#btn-pause`/`#btn-restart`（click 处理后立即 blur()，见 B1 双保险）；结束数据 `#over-score`/`#over-high`（数字）、`#over-record`（破纪录时可见，文本 TEXT.record）。