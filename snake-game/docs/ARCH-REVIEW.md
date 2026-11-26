# 架构评审报告（ARCH-REVIEW）

- 评审人：architect-reviewer（ai-dev-team 流水线，独立于架构师）
- 评审对象：首轮 [ARCHITECTURE.md](./ARCHITECTURE.md) v1.0 / [API.md](./API.md) v1.0；复审 v1.1（上游 [PRD.md](./PRD.md) v1.0 不变）
- 最终结论：**approved**（首轮 changes_requested：1 blocker + 2 major + 2 minor；v1.1 复审确认全部修复且未引入新问题，见 §9）
- 说明：§1~§8 为首轮（v1.0）评审记录，原样保留；§9 为复审记录与最终结论。

## 1. P0 需求覆盖度（FR-01~FR-09 逐条）

| FR | 承接与契约支撑 | 验收可自动化断言 | 判定 |
|----|----------------|------------------|------|
| FR-01 | createGame/start + 开始遮罩 + storage.loadHighScore | 棋盘/蛇/食物/分数可经 debug.getState 断言；**开始界面「最高分」显示位置未定义**（见 M2） | 有缺口 |
| FR-02 | submitDirection/tick，§3.3 五条 + §3.4 边界表 | 三条 Given/When/Then 逐条对照通过（见 §2） | 通过 |
| FR-03 | tick ⑥⑦：吃→不弹尾/+10/新食物；空格→弹尾 | snake/score/food 字段不变量完整，可断言 | 通过 |
| FR-04 | tick ④⑤ + app 死亡结算 + #overlay-over/#over-* | 撞墙/自撞/破纪录三分支均有契约；死亡拍蛇形保留、tickCount 计入已写明 | 通过 |
| FR-05 | restart=createGame(同 config)+新 seed，pendingDirection 归 null | 蛇长/分数/速度/最高分保留可断言；**Enter 重开存在焦点冲突违例路径**（见 B1） | 有缺口 |
| FR-06 | pause/resume + acc=0 + phase≠running 拒绝方向 | 暂停静止、恢复续态、暂停期方向无效均可断言 | 通过 |
| FR-07 | HUD DOM tick 后同帧更新 | #hud-score 可断言；「最高分区域不被遮挡」依赖遮罩覆盖范围，契约未写明（并入 M2） | 有缺口 |
| FR-08 | storage 注入后端 + 探测/读写 try/catch 降级内存 | 持久/降级双路径语义精确（saveHighScore 失败时内存值已更新），e2e addInitScript 方案正确利用 Lead 实测事实 | 通过 |
| FR-09 | speed=min(4+floor(foodEaten/5),12) | 第 5 个食物→foodEaten=5→speed=5，与验收「5 格/秒」一致；封顶 12 一致；HUD『速度 x』+speed 与「对应档位」自洽 | 通过 |

NFR-03/06/07：经典脚本+UMD 正确规避 file:// CORS；engine 无计时/无 DOM，Node 可直接 require 驱动；零运行时依赖、devDependency 精确版本匹配 chromium-1217。均通过。

## 2. FR-02 输入契约逐条对照（PRD §5 vs API §3.3/§3.4）

1. 右行按 ↑/W → 垂直于基准 right，pending=up，下一拍向上：一致。
2. 右行按 ←/A → OPPOSITE[right] 命中，返回 false，方向保持右：一致。
3. 同节拍 ↑ 后 ← → ↑ 占槽；← 相对**已提交的 right**（非 pending up）为反向被忽略，仅 ↑ 生效：一致，且「基准恒为 direction」写死，杜绝了以 pending 为基准导致的漏判。
4. 补充边界核验：↑ 后 ↓ 取末次 ↓（蛇身水平，安全）；同向 → 视为无效不占槽（与「只取最后一次**有效**方向」语义自洽）；非法枚举返回 false（§3.2）；tick 死亡拍也先提交方向并清空 pending（②在④⑤之前），over/ready/paused 一律拒绝，无残留；重开走 createGame 全新状态，pendingDirection=null。暂停时 pending 保留、恢复后下一拍正常提交，无丢失/连跳。
- 结论：输入契约本身**无语义漏洞**；唯一输入相关缺陷在浏览器默认行为层（B1）。

## 3. 契约精确性

- GameState 不变量自洽：死亡不写入碰撞格→「无重复格」保持；food=null 唯一情形=over+cleared，与 wall/self 死亡保留 food 一致；tickCount 仅有效 tick（含死亡拍）+1，ok=false 不计；config 冻结副本可 JSON 序列化，snapshot 深拷贝成立。
- Config 约束自洽：initialLength ≤ floor(width/2)-1 保证初始蛇（头 x=floor(width/2)-2 向左延伸）不越界；width/height≥5 保证 createGame 首个食物必有空白格。
- TickResult 常规分支完整：ok=false 全 false/null；死亡拍 moved=false、head=死亡前蛇头、newFood=null；吃食物拍 ate/newFood/speedChanged 明确。**唯 cleared 拍取值未定义**（M1）。
- UMD 双端核验：Node 分支 `require('./constants.js')` 相对模块文件解析正确；浏览器分支命名空间名与 §1 映射一致，加载顺序 constants→rng→engine→storage→renderer→input→app 保证依赖先就绪；renderer/input/app 禁止 Node require 已写明。成立。
- rng 核验：所给 mulberry32 以累加后的 t 为下一 state，与标准实现序列等价；value∈[0,1)；§3.5 行优先枚举空白格+状态经 state.rngState 流转，同 seed 同按键序列食物序列确定。成立（但 empty.length=0 须先短路，见 M1）。
- storage 核验：仅接受 /^\d+$/ 且安全整数、写失败内存值仍更新、isPersistent 可查，FR-08 两条验收均可断言。成立。
- 结论：修复 M1/M2 后，前端与 QA 可仅凭契约并行开发；当前尚不能。

## 4. correctness 风险核查

- 循环累加器：pause/resume/start/restart 一律 acc=0，仅 running 累积，dt 钳 250ms，while 条件含 phase 检查（死亡即停）——设计正确；但循环体未写明 acc 递减（m2）。
- 失焦（FR-12 P1）：blur/visibilitychange→hidden 且 running 才 pause，与 acc=0 组合无连跳。正确。
- **按钮焦点 × 默认行为**：空格已 preventDefault（可阻断聚焦按钮的空格激活）；Enter 未处理，存在 P0 验收违例路径（B1）。
- URL seed 注入：正则校验放行超 uint32 值将触发 createGame RangeError（m1）。
- file:// 降级：storage 对「取 window.localStorage 本身」也要求 try/catch，正确覆盖 Lead 实测的抛异常场景。

## 5. 边界决议 R5/R6/R7 评审

- **R5（自撞含即将让位的尾节）：接受。** PRD FR-04 原文「蛇头越出棋盘边界或**与自身任一节重合即死亡**」，验收「蛇头即将进入自身某节所在格……判定死亡」未给尾节豁免；按字面含尾节有直接 PRD 依据，且已在契约写明、QA 可断言。
- **R6（填满棋盘按通关）：接受（附 M1）。** PRD 未定义该情形；FR-03 要求新食物生成于空白格，无空白格时无法满足，按结束结算自洽且不违背任何 PRD 条款。但 cleared 拍的 TickResult 与 §3.5 短路顺序必须补精确（M1），否则该决议不可测试。
- **R7（最高分死亡时刷新）：接受。** PRD FR-04 原文「Given 本局得分高于存储的最高分，When **死亡结算**，Then 最高分更新为本局得分并显示破纪录中文提示」，字面支持死亡时刷新；游玩中 HUD 保持会话纪录值不违背 FR-07「常显」。

## 6. 问题清单（首轮，v1.0）

| # | 级别 | 位置 | 问题 | 修复建议 |
|---|------|------|------|----------|
| B1 | **blocker** | API.md §7（bindKeyboard 与 phase×输入表） | Enter 未 preventDefault。复现：鼠标点 #btn-pause 暂停→再点继续（焦点残留于常驻按钮）→死亡→按 Enter：window keydown 先 restart（phase→running），随后 Enter 默认行为触发聚焦按钮原生 click，此时 running→立即 pause。FR-05「按回车立即开新局」验收确定性失败；running 中按 Enter 也会误暂停 | 契约明确：Enter 与方向键/空格一样 preventDefault（或所有按钮 click 后 blur()）；e2e 增加「鼠标点暂停按钮→恢复→死亡→Enter 重开」用例 |
| M1 | major | API.md §3.1 TickResult / §3.4 ⑦ / §3.5 | cleared 拍各字段取值未定义：moved/died/ate/head 为何？§3.5 字面先调 nextInt(empty.length)，empty.length=0 时按 §4 抛 RangeError，与「无空白格→cleared」矛盾 | 写死 cleared 拍取值（建议 ate=true、moved=true、died=true、deathCause='cleared'、head=结算后蛇头、newFood=null，或另设 cleared 标志，由架构师定）；§3.5 明确 empty.length===0 时不调 nextInt、直接走 cleared 分支；写明 cleared 同样走 saveHighScore/破纪录结算 |
| M2 | major | API.md §7 DOM 契约 | 不完备：①HUD 在 ready/paused/over 各 phase 是否可见未写明，FR-01/FR-08「开始界面显示最高分」无确定断言位置；②中文标题与操作说明无选择器；③遮罩覆盖范围未写明，FR-07「最高分区域不被遮挡」不可断言 | 明确 HUD 全 phase 常显、遮罩仅覆盖棋盘区；补标题/说明固定 id（如 #game-title、#help）；FR-01/FR-08 e2e 统一断言 #hud-high |
| m1 | minor | API.md §7 测试钩子 × §3.1 Config.seed | `?seed=99999999999` 通过 /^\d+$/ 但超 uint32，createGame 抛 RangeError 致开局崩溃 | seed 校验追加 ≤4294967295，超限按「非法忽略」处理 |
| m2 | minor | API.md §7 循环 / ARCHITECTURE.md §6 | while 循环体未写明 `acc -= 1000/state.speed`，作为「并行开发唯一依据」按字面实现会死循环 | 补写递减语句；顺带注明「最多补 3 拍」仅对默认 maxSpeed=12 成立（Config 允许至 60） |

## 7. 过度设计或缺失检查

- 无过度设计：7 个小模块、零框架零构建，UMD/Config 参数化/debug 钩子均由硬约束与可测试性直接驱动；deploy/ 仅静态说明。日志、迁移、回滚、鉴权等企业级组件对本项目 N/A，未引入，正确。
- 关键缺失即 B1/M1/M2/m1/m2 所列，无其他缺失组件。

## 8. 首轮结论（v1.0，历史记录）

**changes_requested**。必须修复项：
1. **B1**：Enter 默认行为与按钮焦点冲突（FR-05 验收违例，blocker）。
2. **M1**：cleared 拍 TickResult 取值与 §3.5 空数组短路顺序（R6 决议可测试的前提）。
3. **M2**：DOM 契约补全（HUD 各 phase 可见性、标题/说明选择器、遮罩范围）。

m1/m2 建议随上述修订一并落实。修复后本评审认可总体架构：选型正确利用全部 Lead 实测环境事实，R5/R6/R7 决议均有 PRD 依据或自洽，输入契约语义严密，无需重做设计。

## 9. 复审记录（v1.1，逐条修复核验）

复审方式：完整重读 API.md v1.1 与 ARCHITECTURE.md v1.1，逐条核对契约文本本身是否精确、自洽、可实现，不采信修订声称。

| # | 核验位置 | 核验结果 |
|---|----------|----------|
| B1 | API §7 bindKeyboard 条、「焦点冲突双保险」条、DOM 契约；ARCH R9/§9 | **已修复**。①Enter 与方向键/空格并列写明 preventDefault，阻断聚焦按钮的原生激活；②#btn-start/#btn-pause/#btn-restart 三个按钮 click 处理后立即 blur()，覆盖鼠标焦点残留。DOM 契约仅此三个按钮，无遗漏路径；Tab 键盘焦点路径由①覆盖，且 phase×输入表为各 phase 提供 Enter/空格等价语义，键盘闭环不受损。ARCH §9 已落 e2e 必测「鼠标点暂停→继续→死亡→Enter 重开，断言新局 running」，正对 FR-05 验收违例路径 |
| M1 | API §3.1 字段表与 cleared 写死条、§3.4 ⑦/结算条、§3.5；ARCH §6/R6/§9 | **已修复且自洽**。cleared 拍 ok/moved/ate/died=true、deathCause='cleared'、newFood=null、head=写入后 newHead、speedChanged 按通用规则、tickCount+1，与字段表语义逐条一致（died=「phase 已置 over」涵盖 cleared，moved/head 已特判写明）；§3.4 ⑥头入 snake 先于 ⑦，§3.5 明确「此时新蛇头已写入」且 empty.length===0 短路（不调 nextInt、rngState 不变），RangeError 矛盾消除；food=null 唯一情形、snake 无重复格不变量在 cleared 下均成立；wall/self/cleared 三种 deathCause 同走 saveHighScore/破纪录结算（API §7、ARCH §6 一致）；unit 必测含 cleared 全字段与 rngState 不变（ARCH §9） |
| M2 | API §7 DOM 契约；ARCH §9 | **已修复**。补 #game-title/#game-help（textContent 绑定 TEXT.title/TEXT.help）；HUD 明文在 ready/running/paused/over 全部 phase 常显，FR-01/FR-08 统一断言 #hud-high（无记录为 '0'）；遮罩仅覆盖棋盘区（canvas 所在容器）、不得覆盖 HUD，FR-07「最高分不被遮挡」可断言；e2e 断言已同步写入 ARCH §9 |
| m1 | API §7 测试钩子；ARCH R8 | **已修复**。seed 校验为 /^\d+$/ 且数值 ≤4294967295，不满足按非法忽略并回退 Date.now()>>>0，不再触发 createGame RangeError；两文档表述一致 |
| m2 | API §7 补拍循环伪代码；ARCH §6 循环参数 | **已修复**。伪代码写死 `acc -= interval`（用 tick 前 interval，语义正确）、每次迭代按当前 speed 重算 interval、循环条件含 phase 检查；interval≥1000/60>0 保证终止，acc 恒非负；「最多补 3 拍」已限定仅对默认 maxSpeed=12 成立，两文档一致 |

新问题检查（修订副作用）：
- cleared 取值与 GameState 不变量（food=null 唯一性、无重复格、tickCount 计死亡拍）及 §3.4/§3.5 顺序逐条自洽，无新矛盾；cleared 仅可能发生在吃食物拍（棋盘只因生长填满），与 ⑦ 分支位置一致。
- 循环伪代码与 pause/resume/start/restart acc=0、dt 钳制组合，无连跳、负 acc 或死循环路径；死亡拍后循环经 phase 检查即停。
- Enter 全局 preventDefault 无其他副作用（本项目无输入框/表单），键盘可玩闭环由 phase×输入表保留；blur() 对已失焦按钮为安全 no-op。
- 未发现修订引入的新问题。残留问题：无（blocker 0 / major 0 / minor 0）。

**最终结论：approved。** 首轮 B1/M1/M2/m1/m2 全部修复核验通过，v1.1 契约精确、自洽、可实现，前端与 QA 可仅凭 API.md v1.1 并行开发；R5/R6/R7 决议维持接受。可进入开发与测试实现阶段。