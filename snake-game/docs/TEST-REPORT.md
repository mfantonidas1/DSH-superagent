# 测试执行报告（TEST-REPORT）

- 执行人：qa-runner（ai-dev-team 流水线；本工单由 Lead 兼任执行）
- 结论：**pass**（82/82 全部通过：单元 58 + e2e 24）
- 依据：[TEST-PLAN.md](./TEST-PLAN.md) 用例矩阵；需求 [PRD.md](./PRD.md) §5；契约 [API.md](./API.md) v1.2

## 1. 执行环境

| 项 | 值 |
|---|---|
| 时间 | 2026-11-26 14:25~14:40（Asia/Shanghai） |
| OS | Linux（本机） |
| Node | v22.23.1（node:test 内置运行器） |
| e2e | @playwright/test 1.59.0（精确版本），Chromium 147.0.7727.0（本机缓存 chromium-1217，无需下载） |
| 静态服务器 | python3 -m http.server（e2e webServer 端口 4174，套件自管理） |
| 执行目录 | snake-game/ |

## 2. 执行命令与逐套件结果

| 套件 | 命令 | 总数 | 通过 | 失败 | 跳过 | 耗时 |
|------|------|------|------|------|------|------|
| 单元（rng/engine/storage） | `npm run test:unit` | 58 | 58 | 0 | 0 | ~0.07s |
| e2e 桌面 http（game.spec.js） | `npm run test:e2e` | 17 | 17 | 0 | 0 | 套件合计 ~1.0min |
| e2e file:// 直开（file.spec.js） | 同上 | 2 | 2 | 0 | 0 | 同上 |
| e2e 移动端 390×844（mobile.spec.js） | 同上 | 5 | 5 | 0 | 0 | 同上 |

最终全量：`npm test` 口径 = 单元 58 全绿 + e2e 24 全绿（`24 passed (1.0m)`，exit 0）。

## 3. 执行过程与缺陷归类（如实记录，含失败历史）

1. **环境问题 E-01（已修复）**：首次 `npm run test:unit` 失败，`node --test tests/unit/` 在 Node 22.23.1 下不展开目录参数（MODULE_NOT_FOUND）。Lead 将 package.json 脚本改为 `node --test tests/unit/*.test.js`（实测 58 条全部被发现）；npm 命令不变。归类：环境/工具链问题，非代码缺陷。
2. **代码缺陷 D-01（已修复并复跑确认）**：QA 发现 engine.js `submitDirection` 普通对象查表被原型链键（'constructor'/'toString' 等）穿透，违反 API §3.3。Lead 修复：engine DIRECTIONS 与 input KEYMAP 改 `Object.assign(Object.create(null), {...})`；实测 7 类非法键全部返回 false 且 state 不变；U-ENG-17 转绿。
3. **测试自身问题 T-01（已修正并复跑确认）**：U-ENG-01 断言 `rngState===seed` 与契约矛盾（createGame 内首食物生成已流转一次 rng，API §3.1/§3.5；U-ENG-02 同口径通过）。QA 改为参考 mulberry32 `next(seed).state` 并补 `config.seed===seed` 断言。
4. **测试自身问题 T-02（已修正并复跑确认）**：U-ENG-01 对冻结 config 的写入断言误用 sloppy 模式语义；严格模式下抛 TypeError。QA 改为 `assert.throws(..., TypeError)`。业务 config 冻结行为本身符合契约，未改业务代码。
5. **澄清项 C-01（Lead 裁决关闭）**：持久值 '007' 的读取口径以 API §5 字面为准（/^\d+$/ 接受 →7；「无前导零」仅约束写入格式）。实现与 U-STO-08 无需改动。

e2e 首轮即 24/24 通过，无 flaky、无重试；trace retain-on-failure 未触发。

## 4. 覆盖确认

- PRD §5 每条 P0 Given/When/Then 均有单元+e2e 双层断言（FR-01~FR-09）。
- FR-02 输入契约：API §3.4 边界表逐行单元覆盖 + 真实键盘 e2e（8 键转向、180° 忽略）。
- 契约决议：B1 焦点冲突必测路径（E-G10）、M1 cleared 拍全字段+rngState 不变（U-ENG-29）、M2 HUD 常显/遮罩不盖 HUD（E-G14）、m1 非法种子（E-G17/E-F02）、R5 尾节不让位（U-ENG-27/28）、R7 最高分结算时机、R8 种子复现。
- P1：FR-10 触摸滑动（CDP 真实触摸事件，主导轴/30px 阈值）、FR-11 移动布局与无键盘闭环、FR-12 失焦自动暂停。
- NFR-03 零跨源请求（E-G16/E-F01）、NFR-04 单键存储、file:// 直开与 localStorage 抛异常降级（FR-08）。

## 5. 残留风险与说明

- 兼容性（NFR-02）仅在本机 Chromium 147 实测；Firefox/Safari 未实测（环境无浏览器），契约采用标准 API（Canvas 2D/rAF/URLSearchParams/aspect-ratio），风险低但如实标注为验证缺口。
- 移动端 e2e 为 Chromium 触摸模拟（390×844，hasTouch/isMobile），非真机 iOS/Android。
- 性能（NFR-01 60fps）未做定量压测；渲染为 400 格 Canvas 简单图元，逻辑节拍与渲染解耦，10 分钟连续游玩无内存增长断言未纳入自动化。