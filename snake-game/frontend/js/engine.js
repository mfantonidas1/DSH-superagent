/* engine.js — 核心游戏逻辑状态机（纯逻辑，无 DOM/计时器依赖，Node 可直接 require 测试）。
 * 契约：docs/API.md §3（v1.2）。依赖：constants、rng。
 * 关键语义（评审 approved，不得偏离）：
 *  - submitDirection 校验基准恒为 state.direction（已提交方向），单槽位末次有效覆盖（FR-02）；
 *  - 自撞含即将让位的尾节（R5，按 PRD FR-04 字面）；
 *  - 棋盘填满走 cleared 分支：不调 nextInt、rngState 不变（M1）；
 *  - 死亡拍 newHead 不写入 snake（wall/self），tickCount 计入死亡拍。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./constants.js'), require('./rng.js'));
  } else {
    root.SnakeGame = root.SnakeGame || {};
    root.SnakeGame.Engine = factory(root.SnakeGame.Constants, root.SnakeGame.Rng);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Constants, Rng) {
  'use strict';

  var OPPOSITE = Constants.OPPOSITE;
  var DELTA = Constants.DELTA;
  /* 无原型字典：防止 'constructor'/'toString' 等原型链键穿透枚举校验（QA 缺陷 D-01，API §3.3 非法枚举必须返回 false） */
  var DIRECTIONS = Object.assign(Object.create(null), { up: true, down: true, left: true, right: true });

  function isUint32(v) {
    return Number.isInteger(v) && v >= 0 && v <= 4294967295;
  }

  /* Config 归一化 + 校验（API §3.1：违反约束抛 RangeError）。 */
  function normalizeConfig(config) {
    config = config || {};
    function pick(name, dflt) { return config[name] !== undefined ? config[name] : dflt; }
    var c = {
      width: pick('width', Constants.GRID_WIDTH),
      height: pick('height', Constants.GRID_HEIGHT),
      initialLength: pick('initialLength', Constants.INITIAL_LENGTH),
      initialSpeed: pick('initialSpeed', Constants.INITIAL_SPEED),
      maxSpeed: pick('maxSpeed', Constants.MAX_SPEED),
      foodsPerLevel: pick('foodsPerLevel', Constants.FOODS_PER_LEVEL),
      scorePerFood: pick('scorePerFood', Constants.SCORE_PER_FOOD),
      seed: pick('seed', Date.now() >>> 0)
    };
    if (!Number.isInteger(c.width) || c.width < 5) throw new RangeError('config.width 必须为 >=5 的整数');
    if (!Number.isInteger(c.height) || c.height < 5) throw new RangeError('config.height 必须为 >=5 的整数');
    if (!Number.isInteger(c.initialLength) || c.initialLength < 1 || c.initialLength > Math.floor(c.width / 2) - 1) {
      throw new RangeError('config.initialLength 必须满足 1 <= 值 <= floor(width/2)-1');
    }
    if (!Number.isInteger(c.initialSpeed) || !Number.isInteger(c.maxSpeed) ||
        c.initialSpeed < 1 || c.initialSpeed > c.maxSpeed || c.maxSpeed > 60) {
      throw new RangeError('config 速度必须满足 1 <= initialSpeed <= maxSpeed <= 60');
    }
    if (!Number.isInteger(c.foodsPerLevel) || c.foodsPerLevel < 1) throw new RangeError('config.foodsPerLevel 必须为 >=1 的整数');
    if (!Number.isInteger(c.scorePerFood) || c.scorePerFood < 1) throw new RangeError('config.scorePerFood 必须为 >=1 的整数');
    if (!isUint32(c.seed)) throw new RangeError('config.seed 必须为 uint32');
    return Object.freeze(c);
  }

  /* 食物生成（API §3.5）：行优先枚举空白格；empty.length===0 时不调 nextInt、rngState 不变，返回 null 由调用方走 cleared。 */
  function spawnFood(state) {
    var occupied = Object.create(null);
    var i, s;
    for (i = 0; i < state.snake.length; i++) {
      s = state.snake[i];
      occupied[s.y * state.width + s.x] = true;
    }
    var empty = [];
    for (var y = 0; y < state.height; y++) {
      for (var x = 0; x < state.width; x++) {
        if (!occupied[y * state.width + x]) empty.push({ x: x, y: y });
      }
    }
    if (empty.length === 0) return null;
    var r = Rng.nextInt(state.rngState, empty.length);
    state.rngState = r.state;
    return empty[r.value];
  }

  /* createGame(config?) -> GameState（phase='ready'，蛇/首个食物已生成）。 */
  function createGame(config) {
    var c = normalizeConfig(config);
    var headX = Math.floor(c.width / 2) - 2;
    var headY = Math.floor(c.height / 2);
    var snake = [];
    for (var i = 0; i < c.initialLength; i++) snake.push({ x: headX - i, y: headY });
    var state = {
      phase: 'ready',
      width: c.width,
      height: c.height,
      snake: snake,
      direction: 'right',
      pendingDirection: null,
      food: null,
      score: 0,
      foodEaten: 0,
      speed: c.initialSpeed,
      tickCount: 0,
      rngState: c.seed,
      deathCause: null,
      config: c
    };
    state.food = spawnFood(state); /* width/height>=5 且 initialLength<=floor(w/2)-1，必有空白格 */
    return state;
  }

  function start(state) {
    if (state.phase !== 'ready') return false;
    state.phase = 'running';
    return true;
  }

  function pause(state) {
    if (state.phase !== 'running') return false;
    state.phase = 'paused';
    return true;
  }

  function resume(state) {
    if (state.phase !== 'paused') return false;
    state.phase = 'running';
    return true;
  }

  /* 输入契约（API §3.3，FR-02）：基准恒为 state.direction；同向/反向/非法枚举拒绝；有效则单槽覆盖。 */
  function submitDirection(state, dir) {
    if (state.phase !== 'running') return false;
    if (!DIRECTIONS[dir]) return false;
    var base = state.direction;
    if (dir === base || dir === OPPOSITE[base]) return false;
    state.pendingDirection = dir;
    return true;
  }

  function emptyResult() {
    return { ok: false, moved: false, ate: false, died: false, deathCause: null, newFood: null, speedChanged: false, head: null };
  }

  /* tick(state) -> TickResult。结算顺序严格按 API §3.4 ①~⑧。 */
  function tick(state) {
    var result = emptyResult();
    if (state.phase !== 'running') return result; /* ① ok=false，state 完全未变 */
    result.ok = true;

    /* ② 提交方向（死亡拍也先提交并清空 pending） */
    if (state.pendingDirection !== null) {
      state.direction = state.pendingDirection;
      state.pendingDirection = null;
    }

    /* ③ 新蛇头 */
    var head = state.snake[0];
    var d = DELTA[state.direction];
    var nx = head.x + d.x;
    var ny = head.y + d.y;

    /* ④ 越界 -> wall（newHead 不写入） */
    if (nx < 0 || nx >= state.width || ny < 0 || ny >= state.height) {
      state.phase = 'over';
      state.deathCause = 'wall';
      state.tickCount += 1;
      result.died = true;
      result.deathCause = 'wall';
      result.head = { x: head.x, y: head.y };
      return result;
    }

    /* ⑤ 撞自身任一节（含尾节，R5）-> self（newHead 不写入） */
    for (var i = 0; i < state.snake.length; i++) {
      if (state.snake[i].x === nx && state.snake[i].y === ny) {
        state.phase = 'over';
        state.deathCause = 'self';
        state.tickCount += 1;
        result.died = true;
        result.deathCause = 'self';
        result.head = { x: head.x, y: head.y };
        return result;
      }
    }

    /* ⑥ 头入 snake */
    state.snake.unshift({ x: nx, y: ny });
    result.moved = true;

    /* ⑦ 吃食物：不弹尾、加分、重算速度、生成新食物；否则弹尾 */
    if (state.food !== null && state.food.x === nx && state.food.y === ny) {
      state.score += state.config.scorePerFood;
      state.foodEaten += 1;
      var newSpeed = Math.min(
        state.config.initialSpeed + Math.floor(state.foodEaten / state.config.foodsPerLevel),
        state.config.maxSpeed
      );
      result.speedChanged = newSpeed !== state.speed;
      state.speed = newSpeed;
      result.ate = true;
      var f = spawnFood(state);
      if (f === null) {
        /* cleared（M1）：newHead 已写入、蛇填满棋盘、rngState 不变、同走死亡结算 */
        state.food = null;
        state.phase = 'over';
        state.deathCause = 'cleared';
        result.died = true;
        result.deathCause = 'cleared';
        result.newFood = null;
      } else {
        state.food = f;
        result.newFood = { x: f.x, y: f.y };
      }
    } else {
      state.snake.pop();
    }

    /* ⑧ */
    state.tickCount += 1;
    result.head = { x: state.snake[0].x, y: state.snake[0].y };
    return result;
  }

  /* snapshot(state) -> 深拷贝（JSON 往返等价），供 debug 钩子与测试断言。 */
  function snapshot(state) {
    return JSON.parse(JSON.stringify(state));
  }

  return {
    createGame: createGame,
    start: start,
    pause: pause,
    resume: resume,
    submitDirection: submitDirection,
    tick: tick,
    snapshot: snapshot
  };
});