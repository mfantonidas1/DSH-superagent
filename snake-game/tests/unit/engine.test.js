/* engine.test.js — Engine 核心逻辑单元测试（node:test + node:assert）。
 * 需求依据：docs/PRD.md §5（FR-02/03/04/09 的 Given/When/Then）；
 * 契约依据：docs/API.md v1.2 §3（§3.3 输入契约、§3.4 边界表与结算顺序、§3.5 食物生成、M1 cleared 拍取值）。
 * 执行：npm run test:unit。全部数据自包含（手工构造蛇形/食物），可重复执行。
 * 缺陷标注：U-ENG-17 对应缺陷 D-01（见 docs/TEST-PLAN.md 缺陷清单），按契约断言，当前实现预期失败。 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Engine = require('../../frontend/js/engine.js');
const Constants = require('../../frontend/js/constants.js');

/* ---------- 测试助手（只操作 GameState，不改业务代码） ---------- */

function running(config) {
  const s = Engine.createGame(config);
  Engine.start(s);
  return s;
}

/* 手工构造蛇形：cells[0] 为头；direction 为已提交方向；食物放到指定格（默认左上角远端）。 */
function setSnake(s, cells, direction, food) {
  s.snake = cells.map((c) => ({ x: c[0], y: c[1] }));
  s.direction = direction;
  s.pendingDirection = null;
  s.food = food ? { x: food[0], y: food[1] } : { x: 0, y: 0 };
}

function cell(x, y) { return { x, y }; }

/* API §4 参考实现（独立书写），用于推演首个食物的确定值。 */
function refNext(s) {
  let t = (s + 0x6D2B79F5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { state: t, value: ((r ^ (r >>> 14)) >>> 0) / 4294967296 };
}

/* 行优先枚举空白格（API §3.5），返回参考首食物与 rngState。 */
function refFirstFood(seed, width, height, snake) {
  const occupied = new Set(snake.map((c) => c.y * width + c.x));
  const empty = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!occupied.has(y * width + x)) empty.push({ x, y });
    }
  }
  const r = refNext(seed);
  return { food: empty[Math.floor(r.value * empty.length)], rngState: r.state, emptyCount: empty.length };
}

/* 在蛇头正前方放食物并 tick 一拍（必吃）；用于速度/计分/复现测试。 */
function eatAhead(s) {
  const h = s.snake[0];
  s.food = { x: h.x + 1, y: h.y };
  return Engine.tick(s);
}

/* ---------- createGame 与 Config 校验（API §3.1） ---------- */

describe('createGame 初始状态（API §3.1）', () => {
  test('U-ENG-01 默认 Config 全字段初值', () => {
    const s = Engine.createGame({ seed: 42 });
    assert.equal(s.phase, 'ready');
    assert.equal(s.width, 20);
    assert.equal(s.height, 20);
    assert.deepEqual(s.snake, [cell(8, 10), cell(7, 10), cell(6, 10)]);
    assert.equal(s.direction, 'right');
    assert.equal(s.pendingDirection, null);
    assert.equal(s.score, 0);
    assert.equal(s.foodEaten, 0);
    assert.equal(s.speed, 4);
    assert.equal(s.tickCount, 0);
    /* T-01 修正：createGame 内生成首个食物（API §3.1/§3.5），rngState 已经 nextInt 流转一次，
     * 期望值取参考 mulberry32 的 next(42).state（与 U-ENG-02 同口径）；seed 原值记录在 config.seed。 */
    assert.equal(s.rngState, refNext(42).state);
    assert.equal(s.config.seed, 42);
    assert.equal(s.deathCause, null);
    assert.ok(s.food && Number.isInteger(s.food.x) && Number.isInteger(s.food.y));
    assert.equal(s.config.initialLength, 3);
    assert.equal(s.config.initialSpeed, 4);
    assert.equal(s.config.maxSpeed, 12);
    assert.equal(s.config.foodsPerLevel, 5);
    assert.equal(s.config.scorePerFood, 10);
    assert.ok(Object.isFrozen(s.config), 'config 应为冻结副本');
    /* T-02 修正：本文件为严格模式（'use strict'），对冻结对象写入抛 TypeError（而非 sloppy 模式的静默无效） */
    assert.throws(() => { s.config.width = 5; }, TypeError);
    assert.equal(s.config.width, 20);
  });

  test('U-ENG-02 首个食物 = 行优先空白格[参考 mulberry32 值]，不在蛇身，rngState 流转', () => {
    for (const seed of [0, 1, 42, 123456789, 4294967295]) {
      const s = Engine.createGame({ seed });
      const ref = refFirstFood(seed, 20, 20, [cell(8, 10), cell(7, 10), cell(6, 10)]);
      assert.equal(ref.emptyCount, 397);
      assert.deepEqual(s.food, ref.food, `seed=${seed} 首食物应与参考实现一致`);
      assert.equal(s.rngState, ref.rngState);
      assert.ok(!s.snake.some((c) => c.x === s.food.x && c.y === s.food.y));
    }
  });

  test('U-ENG-03 自定义 Config 生效（8×6、initialLength=2 → 头 (2,3)）', () => {
    const s = Engine.createGame({ width: 8, height: 6, initialLength: 2, seed: 7 });
    assert.equal(s.width, 8);
    assert.equal(s.height, 6);
    assert.deepEqual(s.snake, [cell(2, 3), cell(1, 3)]);
    assert.ok(s.food.x >= 0 && s.food.x < 8 && s.food.y >= 0 && s.food.y < 6);
  });

  test('U-ENG-04 Config 合法边界值（5×5/len1、速度 1..60、seed 0 与 4294967295）', () => {
    const a = Engine.createGame({ width: 5, height: 5, initialLength: 1, seed: 0 });
    assert.deepEqual(a.snake, [cell(0, 2)]);
    const b = Engine.createGame({ initialSpeed: 1, maxSpeed: 1, foodsPerLevel: 1, scorePerFood: 1, seed: 4294967295 });
    assert.equal(b.speed, 1);
    const c = Engine.createGame({ initialSpeed: 60, maxSpeed: 60, seed: 1 });
    assert.equal(c.speed, 60);
    const d = Engine.createGame({ width: 20, initialLength: 9, seed: 2 }); /* floor(20/2)-1=9 */
    assert.equal(d.snake.length, 9);
  });

  test('U-ENG-05 Config 非法 width/height 抛 RangeError', () => {
    for (const bad of [{ width: 4 }, { width: 5.5 }, { width: '20' }, { height: 4 }, { height: 0 }]) {
      assert.throws(() => Engine.createGame(bad), RangeError, JSON.stringify(bad));
    }
  });

  test('U-ENG-06 Config 非法 initialLength 抛 RangeError（0、10>9、1.5）', () => {
    for (const bad of [{ initialLength: 0 }, { initialLength: 10 }, { initialLength: 1.5 }, { width: 5, initialLength: 2 }]) {
      assert.throws(() => Engine.createGame(bad), RangeError, JSON.stringify(bad));
    }
  });

  test('U-ENG-07 Config 非法速度组合抛 RangeError', () => {
    const bads = [
      { initialSpeed: 0 }, { initialSpeed: 13 }, /* > 默认 maxSpeed 12 */
      { maxSpeed: 61 }, { maxSpeed: 3 }, /* < 默认 initialSpeed 4 */
      { initialSpeed: 2.5 }, { initialSpeed: 5, maxSpeed: 4 }
    ];
    for (const bad of bads) {
      assert.throws(() => Engine.createGame(bad), RangeError, JSON.stringify(bad));
    }
  });

  test('U-ENG-08 Config 非法 foodsPerLevel/scorePerFood 抛 RangeError', () => {
    for (const bad of [{ foodsPerLevel: 0 }, { foodsPerLevel: 1.5 }, { scorePerFood: 0 }, { scorePerFood: -1 }]) {
      assert.throws(() => Engine.createGame(bad), RangeError, JSON.stringify(bad));
    }
  });

  test('U-ENG-09 Config 非法 seed 抛 RangeError（非 uint32）', () => {
    for (const seed of [-1, 4294967296, 1.5, '42', null, NaN]) {
      assert.throws(() => Engine.createGame({ seed }), RangeError, `seed=${String(seed)}`);
    }
  });
});

/* ---------- 状态机与 tick 前置检查 ---------- */

describe('phase 状态机（API §3.2）', () => {
  test('U-ENG-10 start/pause/resume 合法迁移', () => {
    const s = Engine.createGame({ seed: 1 });
    assert.equal(Engine.start(s), true);
    assert.equal(s.phase, 'running');
    assert.equal(Engine.pause(s), true);
    assert.equal(s.phase, 'paused');
    assert.equal(Engine.resume(s), true);
    assert.equal(s.phase, 'running');
  });

  test('U-ENG-11 非法迁移返回 false 且无副作用', () => {
    const s = Engine.createGame({ seed: 1 });
    const ready = Engine.snapshot(s);
    assert.equal(Engine.pause(s), false);
    assert.equal(Engine.resume(s), false);
    assert.deepEqual(Engine.snapshot(s), ready);
    Engine.start(s);
    const run = Engine.snapshot(s);
    assert.equal(Engine.start(s), false);
    assert.equal(Engine.resume(s), false);
    assert.deepEqual(Engine.snapshot(s), run);
    Engine.pause(s);
    const paused = Engine.snapshot(s);
    assert.equal(Engine.start(s), false);
    assert.equal(Engine.pause(s), false);
    assert.deepEqual(Engine.snapshot(s), paused);
  });

  test('U-ENG-12 phase≠running 时 tick：ok=false 全空结果，state 完全未变', () => {
    const empty = { ok: false, moved: false, ate: false, died: false, deathCause: null, newFood: null, speedChanged: false, head: null };
    const s = Engine.createGame({ seed: 1 });
    const ready = Engine.snapshot(s);
    assert.deepEqual(Engine.tick(s), empty);
    assert.deepEqual(Engine.snapshot(s), ready);
    Engine.start(s);
    Engine.pause(s);
    const paused = Engine.snapshot(s);
    assert.deepEqual(Engine.tick(s), empty);
    assert.deepEqual(Engine.snapshot(s), paused);
    Engine.resume(s);
    setSnake(s, [[19, 10], [18, 10], [17, 10]], 'right');
    Engine.tick(s); /* 撞墙 → over */
    const over = Engine.snapshot(s);
    assert.deepEqual(Engine.tick(s), empty);
    assert.deepEqual(Engine.snapshot(s), over);
  });
});

/* ---------- FR-02 输入契约（PRD §5 三条验收 + API §3.4 边界表逐行） ---------- */

describe('FR-02 submitDirection / tick 提交（API §3.3、§3.4 边界表）', () => {
  test('U-ENG-13 验收①：蛇向右，按 ↑ → pending=up，下一拍头上移一格', () => {
    const s = running({ seed: 42 });
    assert.equal(Engine.submitDirection(s, 'up'), true);
    assert.equal(s.pendingDirection, 'up');
    const r = Engine.tick(s);
    assert.equal(r.ok, true);
    assert.equal(r.died, false);
    assert.deepEqual(r.head, cell(8, 9));
    assert.equal(s.direction, 'up');
    assert.equal(s.pendingDirection, null);
  });

  test('U-ENG-14 验收②：蛇向右，按 ← → 返回 false，pending=null，下一拍仍向右', () => {
    const s = running({ seed: 42 });
    assert.equal(Engine.submitDirection(s, 'left'), false);
    assert.equal(s.pendingDirection, null);
    const r = Engine.tick(s);
    assert.deepEqual(r.head, cell(9, 10));
    assert.equal(s.direction, 'right');
    assert.equal(r.died, false);
  });

  test('U-ENG-15 验收③：同节拍先 ↑ 后 ← → 仅 ↑ 生效，不自撞死亡', () => {
    const s = running({ seed: 42 });
    assert.equal(Engine.submitDirection(s, 'up'), true);
    assert.equal(Engine.submitDirection(s, 'left'), false); /* ← 相对已提交的右是反向 */
    assert.equal(s.pendingDirection, 'up');
    const r = Engine.tick(s);
    assert.equal(r.died, false);
    assert.equal(s.phase, 'running');
    assert.deepEqual(r.head, cell(8, 9));
  });

  test('U-ENG-16 边界表：↑ 然后 ↓ → 取末次 down；→ 同向忽略；同向不占槽位', () => {
    const s = running({ seed: 42 });
    assert.equal(Engine.submitDirection(s, 'up'), true);
    assert.equal(Engine.submitDirection(s, 'down'), true); /* 均垂直于右，末次覆盖 */
    assert.equal(s.pendingDirection, 'down');
    const r = Engine.tick(s);
    assert.deepEqual(r.head, cell(8, 11));
    assert.equal(s.direction, 'down');
    /* 同向忽略（此时向下，按 down） */
    assert.equal(Engine.submitDirection(s, 'down'), false);
    assert.equal(s.pendingDirection, null);
    /* 同向按键不覆盖已有合法槽位：先 left（垂直于 down 合法）再 down（同向拒绝） */
    assert.equal(Engine.submitDirection(s, 'left'), true);
    assert.equal(Engine.submitDirection(s, 'down'), false);
    assert.equal(s.pendingDirection, 'left');
  });

  test('U-ENG-17 [D-01] 非法枚举一律返回 false 且 state 不变（含原型链键）', () => {
    const s = running({ seed: 42 });
    const before = Engine.snapshot(s);
    const invalid = ['north', '', 'UP', 'Left', null, undefined, 123, {}, 'constructor', 'toString', 'valueOf', 'hasOwnProperty'];
    for (const dir of invalid) {
      assert.equal(Engine.submitDirection(s, dir), false, `非法枚举 ${String(dir)} 应返回 false`);
      assert.deepEqual(Engine.snapshot(s), before, `非法枚举 ${String(dir)} 不得改变 state`);
    }
  });

  test('U-ENG-18 暂停/开始/结束界面方向键全部拒绝（API §3.3 第 1 条）', () => {
    const s = Engine.createGame({ seed: 42 });
    const dirs = ['up', 'down', 'left', 'right'];
    for (const d of dirs) assert.equal(Engine.submitDirection(s, d), false); /* ready */
    assert.equal(s.pendingDirection, null);
    Engine.start(s);
    Engine.pause(s);
    const paused = Engine.snapshot(s);
    for (const d of dirs) assert.equal(Engine.submitDirection(s, d), false); /* paused */
    assert.deepEqual(Engine.snapshot(s), paused);
    assert.deepEqual(Engine.tick(s).ok, false); /* 暂停中不动 */
    Engine.resume(s);
    setSnake(s, [[19, 10], [18, 10], [17, 10]], 'right');
    Engine.tick(s); /* over */
    const over = Engine.snapshot(s);
    for (const d of dirs) assert.equal(Engine.submitDirection(s, d), false); /* over */
    assert.deepEqual(Engine.snapshot(s), over);
  });

  test('U-ENG-19 每次 tick 后 pendingDirection 必为 null（含未按键拍）', () => {
    const s = running({ seed: 42 });
    for (let i = 0; i < 5; i++) {
      Engine.tick(s);
      assert.equal(s.pendingDirection, null);
    }
    Engine.submitDirection(s, 'up');
    Engine.tick(s);
    assert.equal(s.pendingDirection, null);
    assert.equal(s.direction, 'up');
  });

  test('U-ENG-20 死亡拍也提交方向并清空 pending（API §3.4 ②）', () => {
    const s = running({ seed: 42 });
    setSnake(s, [[10, 0], [10, 1], [10, 2]], 'right');
    assert.equal(Engine.submitDirection(s, 'up'), true);
    const r = Engine.tick(s); /* 提交 up 后越上边界 */
    assert.equal(r.died, true);
    assert.equal(r.deathCause, 'wall');
    assert.equal(s.direction, 'up');
    assert.equal(s.pendingDirection, null);
    assert.deepEqual(s.snake, [cell(10, 0), cell(10, 1), cell(10, 2)]); /* newHead 不写入 */
  });

  test('U-ENG-21 重开（createGame 新局）无残留：pending=null、方向 right、tickCount=0', () => {
    const s = running({ seed: 42 });
    Engine.submitDirection(s, 'up');
    Engine.tick(s);
    Engine.pause(s);
    const fresh = Engine.createGame({ seed: 42 });
    assert.equal(fresh.pendingDirection, null);
    assert.equal(fresh.direction, 'right');
    assert.equal(fresh.tickCount, 0);
    assert.equal(fresh.phase, 'ready');
    assert.equal(fresh.score, 0);
    assert.equal(fresh.deathCause, null);
  });
});

/* ---------- FR-03 移动/吃食物/生长/计分 ---------- */

describe('FR-03 移动、吃食物、生长与计分（PRD §5）', () => {
  test('U-ENG-22 空白格移动：整体前移、长度/分数不变、tickCount+1', () => {
    const s = running({ seed: 42 });
    setSnake(s, [[8, 10], [7, 10], [6, 10]], 'right', [0, 0]);
    const r = Engine.tick(s);
    assert.equal(r.ok, true);
    assert.equal(r.moved, true);
    assert.equal(r.ate, false);
    assert.equal(r.died, false);
    assert.equal(r.speedChanged, false);
    assert.equal(r.newFood, null);
    assert.deepEqual(r.head, cell(9, 10));
    assert.deepEqual(s.snake, [cell(9, 10), cell(8, 10), cell(7, 10)]);
    assert.equal(s.score, 0);
    assert.equal(s.foodEaten, 0);
    assert.equal(s.tickCount, 1);
    assert.deepEqual(s.food, cell(0, 0));
  });

  test('U-ENG-23 吃食物：长度+1、分数+10、不弹尾、新食物不在蛇身且等于 result.newFood', () => {
    const s = running({ seed: 42 });
    setSnake(s, [[8, 10], [7, 10], [6, 10]], 'right', [9, 10]);
    const rngBefore = s.rngState;
    const r = Engine.tick(s);
    assert.equal(r.ate, true);
    assert.equal(r.moved, true);
    assert.equal(r.died, false);
    assert.equal(s.score, 10);
    assert.equal(s.foodEaten, 1);
    assert.deepEqual(s.snake, [cell(9, 10), cell(8, 10), cell(7, 10), cell(6, 10)]); /* 尾节保留 */
    assert.ok(r.newFood, '应生成新食物');
    assert.deepEqual(s.food, r.newFood);
    assert.ok(!s.snake.some((c) => c.x === s.food.x && c.y === s.food.y), '新食物不得在蛇身');
    assert.notEqual(s.rngState, rngBefore, '生成新食物应流转 rngState');
    assert.equal(s.tickCount, 1);
  });

  test('U-ENG-24 连续吃 30 个食物：新食物始终不在蛇身、分数恒为 10 的倍数', () => {
    const s = running({ width: 100, height: 5, initialLength: 1, seed: 7 });
    for (let i = 1; i <= 30; i++) {
      const r = eatAhead(s);
      assert.equal(r.ate, true);
      assert.equal(s.score, 10 * i);
      assert.equal(s.foodEaten, i);
      assert.equal(s.snake.length, 1 + i);
      assert.ok(s.food && !s.snake.some((c) => c.x === s.food.x && c.y === s.food.y));
    }
  });
});

/* ---------- FR-04 死亡判定（撞墙四边 / 自撞含尾节 R5 / 死亡拍不写入） ---------- */

describe('FR-04 死亡判定（API §3.4 ④⑤、R5）', () => {
  const sides = [
    { name: '右边界', snake: [[19, 10], [18, 10], [17, 10]], dir: 'right' },
    { name: '左边界', snake: [[0, 10], [1, 10], [2, 10]], dir: 'left' },
    { name: '上边界', snake: [[10, 0], [10, 1], [10, 2]], dir: 'up' },
    { name: '下边界', snake: [[10, 19], [10, 18], [10, 17]], dir: 'down' }
  ];
  for (const side of sides) {
    test(`U-ENG-25 撞墙（${side.name}）：died/wall、newHead 不写入、score/food 保留、tickCount 计死亡拍`, () => {
      const s = running({ seed: 42 });
      setSnake(s, side.snake, side.dir, [5, 5]);
      s.score = 20;
      s.foodEaten = 2;
      const snakeBefore = Engine.snapshot(s).snake;
      const r = Engine.tick(s);
      assert.equal(r.ok, true);
      assert.equal(r.died, true);
      assert.equal(r.deathCause, 'wall');
      assert.equal(r.moved, false);
      assert.equal(r.ate, false);
      assert.equal(r.newFood, null);
      assert.equal(r.speedChanged, false);
      assert.deepEqual(r.head, cell(side.snake[0][0], side.snake[0][1])); /* 死亡前蛇头 */
      assert.equal(s.phase, 'over');
      assert.equal(s.deathCause, 'wall');
      assert.deepEqual(s.snake, snakeBefore); /* 碰撞格不写入蛇身 */
      assert.equal(s.score, 20);
      assert.deepEqual(s.food, cell(5, 5));
      assert.equal(s.tickCount, 1);
    });
  }

  test('U-ENG-26 自撞（非尾节，蛇长 5）：newHead 与蛇身重合 → self', () => {
    const s = running({ seed: 42 });
    setSnake(s, [[2, 2], [2, 1], [1, 1], [1, 2], [1, 3]], 'left', [4, 4]);
    const snakeBefore = Engine.snapshot(s).snake;
    const r = Engine.tick(s); /* newHead=(1,2)=snake[3] */
    assert.equal(r.died, true);
    assert.equal(r.deathCause, 'self');
    assert.equal(r.moved, false);
    assert.deepEqual(r.head, cell(2, 2));
    assert.equal(s.phase, 'over');
    assert.deepEqual(s.snake, snakeBefore);
    assert.equal(s.tickCount, 1);
  });

  test('U-ENG-27 R5 尾节不让位①：newHead=当前尾节 → 判死 self（按 PRD 字面）', () => {
    const s = running({ seed: 42 });
    /* 2×2 环形蛇：头 (1,0) 向下，newHead=(1,1) 恰为即将让位的尾节 */
    setSnake(s, [[1, 0], [0, 0], [0, 1], [1, 1]], 'down', [4, 4]);
    const r = Engine.tick(s);
    assert.equal(r.died, true);
    assert.equal(r.deathCause, 'self');
    assert.equal(s.phase, 'over');
    assert.deepEqual(s.snake, [cell(1, 0), cell(0, 0), cell(0, 1), cell(1, 1)]);
  });

  test('U-ENG-28 R5 尾节不让位②：进入上一拍已让位的尾节格 → 安全存活', () => {
    const s = running({ seed: 42 });
    setSnake(s, [[2, 0], [1, 0], [0, 0], [0, 1]], 'down', [4, 4]);
    const r1 = Engine.tick(s); /* 头 (2,1)，尾节 (0,1) 让位 */
    assert.equal(r1.died, false);
    assert.equal(Engine.submitDirection(s, 'left'), true);
    const r2 = Engine.tick(s); /* 头 (1,1) */
    assert.equal(r2.died, false);
    const r3 = Engine.tick(s); /* 头 (0,1)：上一拍已让位的格子，安全 */
    assert.equal(r3.died, false);
    assert.equal(s.phase, 'running');
    assert.deepEqual(r3.head, cell(0, 1));
  });
});

/* ---------- M1 cleared 拍（API §3.1/§3.4/§3.5 写死取值） ---------- */

describe('M1 cleared：蛇填满棋盘（API §3.5 短路）', () => {
  test('U-ENG-29 5×5 填满前一刻吃最后一格食物：cleared 拍全字段断言', () => {
    const s = running({ width: 5, height: 5, initialLength: 1, seed: 42 });
    /* 行优先蛇形哈密顿路径：path[0..24]，蛇占前 24 格（头在 path[23]=(3,4)），食物在 path[24]=(4,4) */
    const path = [];
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) {
        path.push([y % 2 === 0 ? x : 4 - x, y]);
      }
    }
    const snakeCells = path.slice(0, 24).reverse(); /* 头 (3,4)，身依次相邻延伸至 (0,0) */
    setSnake(s, snakeCells, 'right', path[24]);
    s.score = 40;       /* 已吃 4 个，scorePerFood=10 的倍数 */
    s.foodEaten = 4;
    s.tickCount = 7;
    const rngBefore = s.rngState;
    const r = Engine.tick(s); /* 头入 (4,4) 吃食物 → 无空白格 → cleared */
    assert.equal(r.ok, true);
    assert.equal(r.moved, true);
    assert.equal(r.ate, true);
    assert.equal(r.died, true);
    assert.equal(r.deathCause, 'cleared');
    assert.equal(r.newFood, null);
    assert.deepEqual(r.head, cell(4, 4)); /* 写入后的 newHead */
    assert.equal(r.speedChanged, true);   /* 第 5 个食物：4+floor(5/5)=5 */
    assert.equal(s.phase, 'over');
    assert.equal(s.deathCause, 'cleared');
    assert.equal(s.food, null);
    assert.equal(s.snake.length, 25);
    assert.deepEqual(s.snake[0], cell(4, 4));
    assert.equal(s.score, 50);
    assert.equal(s.foodEaten, 5);
    assert.equal(s.speed, 5);
    assert.equal(s.rngState, rngBefore, 'cleared 分支不得调用 nextInt，rngState 不变');
    assert.equal(s.tickCount, 8);
    /* 蛇恰好覆盖全盘 25 格且不重复 */
    const uniq = new Set(s.snake.map((c) => c.y * 5 + c.x));
    assert.equal(uniq.size, 25);
  });
});

/* ---------- FR-09 速度公式 ---------- */

describe('FR-09 随进度加速（PRD §5、API §3.1 speed 公式）', () => {
  test('U-ENG-30 默认 Config：第 5/10/... 个食物提速，speedChanged 仅在提速拍为 true', () => {
    const s = running({ width: 100, height: 5, initialLength: 1, seed: 7 });
    for (let k = 1; k <= 15; k++) {
      const r = eatAhead(s);
      const expected = Math.min(4 + Math.floor(k / 5), 12);
      assert.equal(s.speed, expected, `第 ${k} 个食物后速度`);
      assert.equal(r.speedChanged, k % 5 === 0, `第 ${k} 拍 speedChanged`);
    }
  });

  test('U-ENG-31 封顶 12：吃满 40 个达 12，继续吃不再增加、计分生长照常', () => {
    const s = running({ width: 100, height: 5, initialLength: 1, seed: 7 });
    for (let k = 1; k <= 45; k++) {
      const r = eatAhead(s);
      assert.equal(s.speed, Math.min(4 + Math.floor(k / 5), 12));
      if (k > 40) {
        assert.equal(s.speed, 12);
        assert.equal(r.speedChanged, false);
        assert.equal(r.ate, true);
        assert.equal(s.score, 10 * k);
        assert.equal(s.snake.length, 1 + k);
      }
    }
  });

  test('U-ENG-32 自定义 foodsPerLevel=2 / initialSpeed=2 / maxSpeed=3', () => {
    const s = running({ width: 60, height: 5, initialLength: 1, initialSpeed: 2, maxSpeed: 3, foodsPerLevel: 2, seed: 1 });
    const expects = [2, 3, 3, 3, 3, 3]; /* k=1..6 */
    for (let k = 1; k <= 6; k++) {
      const r = eatAhead(s);
      assert.equal(s.speed, expects[k - 1], `第 ${k} 个食物后速度`);
      assert.equal(r.speedChanged, k === 2);
    }
  });

  test('U-ENG-33 自定义 scorePerFood=7：每食物 +7 分', () => {
    const s = running({ width: 60, height: 5, initialLength: 1, scorePerFood: 7, seed: 1 });
    for (let k = 1; k <= 3; k++) {
      eatAhead(s);
      assert.equal(s.score, 7 * k);
    }
  });
});

/* ---------- 种子复现与 snapshot 隔离 ---------- */

describe('可复现性与 snapshot（API §3.2/§3.5）', () => {
  test('U-ENG-34 同 seed 同输入序列 → 食物序列与终态完全一致', () => {
    function play(seed) {
      const s = running({ width: 100, height: 5, initialLength: 1, seed });
      const foods = [];
      for (let k = 0; k < 12; k++) {
        const r = eatAhead(s);
        foods.push(r.newFood);
      }
      return { foods, final: Engine.snapshot(s) };
    }
    const a = play(2024);
    const b = play(2024);
    assert.deepEqual(a.foods, b.foods);
    assert.deepEqual(a.final, b.final);
    /* 默认棋盘 + 固定转向序列同样可复现 */
    function playTurns(seed) {
      const s = running({ seed });
      const seq = ['up', 'right', 'down', 'left'];
      for (let i = 0; i < 40; i++) {
        if (i % 5 === 0) Engine.submitDirection(s, seq[(i / 5) % 4]);
        Engine.tick(s);
        if (s.phase !== 'running') break;
      }
      return Engine.snapshot(s);
    }
    assert.deepEqual(playTurns(99), playTurns(99));
  });

  test('U-ENG-35 不同 seed 的食物序列可区分（参考实现推演，非概率断言）', () => {
    const f1 = refFirstFood(1, 20, 20, [cell(8, 10), cell(7, 10), cell(6, 10)]).food;
    const f2 = refFirstFood(2, 20, 20, [cell(8, 10), cell(7, 10), cell(6, 10)]).food;
    const f3 = refFirstFood(123456789, 20, 20, [cell(8, 10), cell(7, 10), cell(6, 10)]).food;
    const distinct = new Set([f1, f2, f3].map((c) => `${c.x},${c.y}`));
    assert.ok(distinct.size >= 2, '三个种子的首食物不应全部相同');
    assert.deepEqual(Engine.createGame({ seed: 1 }).food, f1);
    assert.deepEqual(Engine.createGame({ seed: 2 }).food, f2);
  });

  test('U-ENG-36 snapshot 深拷贝隔离：改快照不影响原 state，JSON 往返等价', () => {
    const s = running({ seed: 42 });
    const snap = Engine.snapshot(s);
    assert.deepEqual(snap, JSON.parse(JSON.stringify(s)));
    snap.snake[0].x = 999;
    snap.snake.push(cell(0, 0));
    snap.phase = 'over';
    snap.config.width = 5;
    snap.food.x = -1;
    assert.equal(s.snake[0].x, 8);
    assert.equal(s.snake.length, 3);
    assert.equal(s.phase, 'running');
    assert.equal(s.config.width, 20);
    assert.notEqual(s.food.x, -1);
  });
});
