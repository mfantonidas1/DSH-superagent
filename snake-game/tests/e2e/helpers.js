/* helpers.js — e2e 公共助手（被 game/file/mobile 三个 spec 复用）。
 * 反 flaky 核心约定（docs/ARCHITECTURE.md §9、API §7 测试钩子）：
 *  - 游戏状态断言一律 window.SnakeGame.debug.getState()（只读深拷贝）+ page.waitForFunction；
 *  - 不用固定 sleep 猜测游戏进度；「画面静止」用 rAF 帧数等待（waitFrames）后断言 tickCount 不变；
 *  - 吃食物助手：BFS 规划（避开蛇身含尾节 R5、尽量贴离边缘）+ 真实 keyboard.press，
 *    每拍 waitForFunction tickCount 递增后再按下一键。
 * 错误监控 fixture：每个用例结束自动断言 pageerror / console error 为空（favicon 404 除外）。 */
'use strict';

const path = require('path');
const base = require('@playwright/test');
const { expect } = base;

const KEY = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };
const OPPOSITE = { up: 'down', down: 'up', left: 'right', right: 'left' };
const DELTA = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
const DIRS = ['up', 'down', 'left', 'right'];

/* 扩展 fixture：收集 pageerror / console error / 全部请求；用例收尾统一断言无错误。
 * 收集器挂在 page.__mon 上，供「零网络请求」等用例做逐条断言。 */
const test = base.test.extend({
  page: async ({ page }, use) => {
    const mon = { pageErrors: [], consoleErrors: [], requests: [] };
    page.on('pageerror', (e) => mon.pageErrors.push(String(e)));
    page.on('console', (m) => {
      /* 浏览器自发的 favicon 404 不属于游戏代码错误（python http.server 无 favicon） */
      if (m.type() === 'error' && !/favicon/i.test(m.text())) mon.consoleErrors.push(m.text());
    });
    page.on('request', (r) => mon.requests.push(r.url()));
    page.__mon = mon;
    await use(page);
    expect(mon.pageErrors, '运行期间不得出现 pageerror').toEqual([]);
    expect(mon.consoleErrors, '运行期间不得出现 console error（favicon 除外）').toEqual([]);
  }
});

/* ---------- 状态读取与等待 ---------- */

async function getState(page) {
  return page.evaluate(() => window.SnakeGame.debug.getState());
}

async function openGame(page, query) {
  await page.goto('/' + (query || ''));
  await page.waitForFunction(() => !!(window.SnakeGame && window.SnakeGame.debug));
}

function fileUrl(query) {
  return 'file://' + path.resolve(__dirname, '../../frontend/index.html') + (query || '');
}

async function openFile(page, query) {
  await page.goto(fileUrl(query));
  await page.waitForFunction(() => !!(window.SnakeGame && window.SnakeGame.debug));
}

async function waitPhase(page, phase) {
  await page.waitForFunction((p) => window.SnakeGame.debug.getState().phase === p, phase);
}

async function clickStart(page) {
  await page.click('#btn-start');
  await waitPhase(page, 'running');
}

/* 蛇沿当前方向直行必撞墙（棋盘有限宽），无需按键即可确定性死亡。 */
async function waitDeath(page) {
  await page.waitForFunction(() => window.SnakeGame.debug.getState().phase === 'over', null, { timeout: 20000 });
}

async function waitTicks(page, n) {
  const t = (await getState(page)).tickCount;
  await page.waitForFunction((k) => window.SnakeGame.debug.getState().tickCount >= k, t + n);
}

async function waitDirection(page, dir) {
  await page.waitForFunction((d) => window.SnakeGame.debug.getState().direction === d, dir);
}

/* 等待 n 个渲染帧（约 n×16.7ms）：用于「暂停画面静止」类断言的时间流逝观测，
 * 不是用 sleep 猜游戏进度，而是给足帧数后断言 tickCount 不变。 */
async function waitFrames(page, n) {
  await page.evaluate((k) => new Promise((resolve) => {
    let i = 0;
    const step = () => { if (++i >= k) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  }), n);
}

/* ---------- BFS 吃食物助手 ---------- */

function keyOf(c) { return c.x + ',' + c.y; }

function safeCell(s, x, y) {
  return x >= 0 && x < s.width && y >= 0 && y < s.height &&
    !s.snake.some((c) => c.x === x && c.y === y);
}

/* BFS：蛇身（含尾节，R5 不让位）为障碍；avoidEdges=true 时尽量不走边缘格（食物格除外），
 * 降低「按键与节拍竞态」导致的撞墙风险。返回首步方向。 */
function bfsFirstDir(s, avoidEdges) {
  const head = s.snake[0];
  const food = s.food;
  const blocked = new Set(s.snake.map(keyOf));
  const seen = new Set([keyOf(head)]);
  const queue = [[head]];
  while (queue.length) {
    const p = queue.shift();
    const cur = p[p.length - 1];
    if (cur.x === food.x && cur.y === food.y) {
      if (p.length < 2) return null;
      const dx = p[1].x - head.x;
      const dy = p[1].y - head.y;
      return DIRS.find((d) => DELTA[d].x === dx && DELTA[d].y === dy) || null;
    }
    for (const d of DIRS) {
      const nx = cur.x + DELTA[d].x;
      const ny = cur.y + DELTA[d].y;
      if (nx < 0 || nx >= s.width || ny < 0 || ny >= s.height) continue;
      const k = nx + ',' + ny;
      if (seen.has(k) || blocked.has(k)) continue;
      const isEdge = nx === 0 || ny === 0 || nx === s.width - 1 || ny === s.height - 1;
      const isFood = nx === food.x && ny === food.y;
      if (avoidEdges && isEdge && !isFood) continue;
      seen.add(k);
      queue.push(p.concat([{ x: nx, y: ny }]));
    }
  }
  return null;
}

/* 前瞻安全：首步格安全，且沿该方向的第二格也安全（或首步即食物），
 * 保证「按键落地前恰好结算一拍」时旧方向也不致死。 */
function lookaheadOk(s, d) {
  const h = s.snake[0];
  const c1x = h.x + DELTA[d].x;
  const c1y = h.y + DELTA[d].y;
  if (!safeCell(s, c1x, c1y)) return false;
  if (s.food && c1x === s.food.x && c1y === s.food.y) return true;
  return safeCell(s, c1x + DELTA[d].x, c1y + DELTA[d].y);
}

function planDir(s) {
  for (const avoidEdges of [true, false]) {
    const d = bfsFirstDir(s, avoidEdges);
    if (d && d !== OPPOSITE[s.direction] && lookaheadOk(s, d)) return d;
  }
  for (const d of DIRS) {
    if (d !== OPPOSITE[s.direction] && lookaheadOk(s, d)) return d;
  }
  for (const d of DIRS) {
    const h = s.snake[0];
    if (d !== OPPOSITE[s.direction] && safeCell(s, h.x + DELTA[d].x, h.y + DELTA[d].y)) return d;
  }
  return null;
}

/* 真实按键驱动蛇吃到 1 个食物：每拍读快照 → BFS 规划 → keyboard.press →
 * waitForFunction tickCount 递增（或 phase 变化）后再进入下一拍。 */
async function eatFood(page, maxSteps) {
  const limit = maxSteps || 300;
  const target = (await getState(page)).foodEaten + 1;
  for (let i = 0; i < limit; i++) {
    const s = await getState(page);
    if (s.foodEaten >= target) return s;
    if (s.phase !== 'running') throw new Error('eatFood: 意外 phase=' + s.phase + '（deathCause=' + s.deathCause + '）');
    const d = planDir(s);
    if (d && d !== s.direction) await page.keyboard.press(KEY[d]);
    await page.waitForFunction((t) => {
      const st = window.SnakeGame.debug.getState();
      return st.tickCount > t || st.phase !== 'running';
    }, s.tickCount, { timeout: 5000 });
  }
  throw new Error('eatFood: 超过 ' + limit + ' 拍仍未吃到食物');
}

async function eatFoods(page, n) {
  let s = null;
  for (let i = 0; i < n; i++) s = await eatFood(page);
  return s;
}

/* ---------- 移动端触摸滑动（CDP 真实触摸事件，FR-10） ---------- */

async function swipe(page, dx, dy) {
  const client = await page.context().newCDPSession(page);
  try {
    const box = await page.locator('#board-wrap').boundingBox();
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx * 0.5, y: y + dy * 0.5 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + dx, y: y + dy }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await client.detach();
  }
}

module.exports = {
  test, expect, KEY, OPPOSITE, DELTA,
  getState, openGame, openFile, fileUrl, waitPhase, clickStart, waitDeath,
  waitTicks, waitDirection, waitFrames, eatFood, eatFoods, swipe
};
