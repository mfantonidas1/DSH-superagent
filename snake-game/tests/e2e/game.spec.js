/* game.spec.js — 桌面端 e2e（http://127.0.0.1:4174，chromium，viewport 1280×800）。
 * 需求依据：docs/PRD.md §5 P0 验收；契约依据：docs/API.md v1.2 §7（DOM id/测试钩子/phase×输入表/B1）。
 * 必测路径（ARCHITECTURE §9）：B1 焦点冲突、FR-01/FR-08 统一断言 #hud-high、M2 HUD 常显与遮罩不盖 HUD。
 * 反 flaky：全部游戏进度断言走 debug.getState() + waitForFunction；吃食物用 BFS 助手真实按键驱动。 */
'use strict';

const {
  test, expect, KEY, DELTA,
  getState, openGame, waitPhase, clickStart, waitDeath,
  waitTicks, waitDirection, waitFrames, eatFood, eatFoods
} = require('./helpers.js');

function intersects(a, b) {
  return !!a && !!b &&
    a.x < b.x + b.width && b.x < a.x + a.width &&
    a.y < b.y + b.height && b.y < a.y + a.height;
}

test('E-G01 FR-01 开始界面：标题/说明/最高分/遮罩/按钮初态', async ({ page }) => {
  await openGame(page, '?seed=42');
  await expect(page.locator('#game-title')).toHaveText('贪食蛇');
  await expect(page.locator('#game-help')).toHaveText('方向键 / WASD 转向，空格暂停，回车开始/重开');
  await expect(page.locator('#hud-score')).toHaveText('0');
  await expect(page.locator('#hud-high')).toHaveText('0'); /* 无记录显示 0（FR-01/FR-08 统一断言点） */
  await expect(page.locator('#hud-speed')).toHaveText('速度 x4');
  await expect(page.locator('#overlay-start')).toBeVisible();
  await expect(page.locator('#overlay-pause')).toBeHidden();
  await expect(page.locator('#overlay-over')).toBeHidden();
  await expect(page.locator('#btn-start')).toHaveText('开始游戏');
  await expect(page.locator('#btn-pause')).toBeDisabled();
  await expect(page.locator('#btn-pause')).toHaveText('暂停');
  const s = await getState(page);
  expect(s.phase).toBe('ready');
  expect(s.snake.length).toBe(3);
  expect(s.food).not.toBeNull();
});

test('E-G02 FR-01 点击开始：20×20、蛇长 3 向右、1 个食物、分数 0', async ({ page }) => {
  await openGame(page, '?seed=42');
  await clickStart(page);
  const s = await getState(page);
  expect(s.phase).toBe('running');
  expect(s.width).toBe(20);
  expect(s.height).toBe(20);
  expect(s.snake.length).toBe(3);
  expect(s.direction).toBe('right');
  expect(s.score).toBe(0);
  expect(s.food).not.toBeNull();
  await expect(page.locator('#overlay-start')).toBeHidden();
  await expect(page.locator('#btn-pause')).toBeEnabled();
});

test('E-G03 FR-01 回车开始', async ({ page }) => {
  await openGame(page, '?seed=42');
  await page.keyboard.press('Enter');
  await waitPhase(page, 'running');
});

test('E-G04 FR-01 空格开始', async ({ page }) => {
  await openGame(page, '?seed=42');
  await page.keyboard.press('Space');
  await waitPhase(page, 'running');
});

test('E-G05 FR-02 方向键与 WASD 全部 8 键转向生效（真实键盘）', async ({ page }) => {
  /* 每个场景独立开局，至多 2 次转向，避免路径回绕引发自撞干扰断言 */
  const cases = [
    { keys: ['ArrowUp'], want: 'up' },
    { keys: ['w'], want: 'up' },
    { keys: ['ArrowDown'], want: 'down' },
    { keys: ['s'], want: 'down' },
    { keys: ['w', 'ArrowLeft'], want: 'left' },
    { keys: ['w', 'a'], want: 'left' },
    { keys: ['w', 'ArrowRight'], want: 'right' },
    { keys: ['w', 'd'], want: 'right' }
  ];
  for (const c of cases) {
    await openGame(page, '?seed=42');
    await clickStart(page);
    for (let i = 0; i < c.keys.length; i++) {
      await page.keyboard.press(c.keys[i]);
      const expectDir = i === c.keys.length - 1 ? c.want : 'up';
      await waitDirection(page, expectDir);
    }
    const s = await getState(page);
    expect(s.phase, `键序列 ${c.keys.join('+')} 后应存活`).toBe('running');
    expect(s.direction).toBe(c.want);
  }
});

test('E-G06 FR-02 180° 反向被忽略（方向不变、不自撞）', async ({ page }) => {
  await openGame(page, '?seed=42');
  await clickStart(page);
  /* 向右时按 ← / A：忽略 */
  await page.keyboard.press('ArrowLeft');
  await waitTicks(page, 2);
  let s = await getState(page);
  expect(s.direction).toBe('right');
  expect(s.pendingDirection).toBeNull();
  expect(s.phase).toBe('running');
  await page.keyboard.press('a');
  await waitTicks(page, 2);
  s = await getState(page);
  expect(s.direction).toBe('right');
  expect(s.phase).toBe('running');
  /* 转为向上后按 ↓：同样忽略 */
  await page.keyboard.press('w');
  await waitDirection(page, 'up');
  await page.keyboard.press('ArrowDown');
  await waitTicks(page, 2);
  s = await getState(page);
  expect(s.direction).toBe('up');
  expect(s.phase).toBe('running');
});

test('E-G07 FR-06 空格暂停：画面静止/遮罩/按钮文案/暂停中方向键无效/再按恢复', async ({ page }) => {
  await openGame(page, '?seed=42');
  await clickStart(page);
  await waitTicks(page, 1);
  await page.keyboard.press('Space');
  await waitPhase(page, 'paused');
  const frozen = await getState(page);
  await waitFrames(page, 40); /* 观测约 40 帧（>1 个节拍时长），断言画面静止 */
  const still = await getState(page);
  expect(still.tickCount).toBe(frozen.tickCount);
  expect(still.phase).toBe('paused');
  await expect(page.locator('#overlay-pause')).toBeVisible();
  await expect(page.locator('#btn-pause')).toHaveText('继续');
  /* 暂停中方向键无效：方向不变、不占槽位、不恢复 */
  await page.keyboard.press('ArrowUp');
  const afterKey = await getState(page);
  expect(afterKey.phase).toBe('paused');
  expect(afterKey.direction).toBe(frozen.direction);
  expect(afterKey.pendingDirection).toBeNull();
  expect(afterKey.tickCount).toBe(frozen.tickCount);
  /* 再按空格恢复，节拍继续 */
  await page.keyboard.press('Space');
  await waitPhase(page, 'running');
  await waitTicks(page, 1);
  const resumed = await getState(page);
  expect(resumed.tickCount).toBeGreaterThan(frozen.tickCount);
  await expect(page.locator('#overlay-pause')).toBeHidden();
});

test('E-G08 FR-06 P 键与空格同语义（p 暂停 / P 继续）', async ({ page }) => {
  await openGame(page, '?seed=42');
  await clickStart(page);
  await page.keyboard.press('p');
  await waitPhase(page, 'paused');
  await expect(page.locator('#overlay-pause')).toBeVisible();
  await page.keyboard.press('P');
  await waitPhase(page, 'running');
  await expect(page.locator('#overlay-pause')).toBeHidden();
});

test('E-G09 FR-03/04/05/07 吃食物加分→撞墙死亡→结束界面→回车重开', async ({ page }) => {
  await openGame(page, '?seed=42');
  await clickStart(page);
  const before = await getState(page);
  const ate = await eatFood(page); /* BFS 助手真实按键驱动吃到食物 */
  expect(ate.score).toBe(before.score + 10);
  expect(ate.foodEaten).toBe(before.foodEaten + 1);
  expect(ate.snake.length).toBe(before.snake.length + 1);
  expect(ate.food).not.toBeNull();
  expect(ate.snake.some((c) => c.x === ate.food.x && c.y === ate.food.y)).toBe(false);
  /* FR-07：HUD 分数即时更新为契约值 */
  await page.waitForFunction(() => document.getElementById('hud-score').textContent === '10');
  /* 直行撞墙死亡 */
  await waitDeath(page);
  const dead = await getState(page);
  expect(dead.phase).toBe('over');
  expect(dead.deathCause).toBe('wall');
  await expect(page.locator('#overlay-over')).toBeVisible();
  await expect(page.locator('#over-score')).toHaveText(String(dead.score));
  await expect(page.locator('#over-high')).toHaveText(String(dead.score)); /* 新上下文最高分=本局得分 */
  await expect(page.locator('#btn-restart')).toHaveText('重新开始');
  /* FR-05：回车立即重开 */
  await page.keyboard.press('Enter');
  await waitPhase(page, 'running');
  const fresh = await getState(page);
  expect(fresh.score).toBe(0);
  expect(fresh.snake.length).toBe(3);
  expect(fresh.speed).toBe(4);
  await expect(page.locator('#overlay-over')).toBeHidden();
  await expect(page.locator('#hud-score')).toHaveText('0');
  await expect(page.locator('#hud-high')).toHaveText(String(dead.score)); /* 最高分保留 */
});

test('E-G10 [B1] 焦点冲突必测路径：点暂停→点继续→死亡→Enter 重开必须 running', async ({ page }) => {
  await openGame(page, '?seed=42');
  await page.click('#btn-start');
  await waitPhase(page, 'running');
  await page.click('#btn-pause'); /* 鼠标暂停，焦点残留风险场景 */
  await waitPhase(page, 'paused');
  await expect(page.locator('#btn-pause')).toHaveText('继续');
  await page.click('#btn-pause'); /* 鼠标继续 */
  await waitPhase(page, 'running');
  await expect(page.locator('#btn-pause')).toHaveText('暂停');
  await waitDeath(page);
  await page.keyboard.press('Enter'); /* 若 Enter 默认行为未阻断，新局会被聚焦按钮误暂停 */
  await waitPhase(page, 'running');
  await waitTicks(page, 2); /* 再走 2 拍确认新局未被误暂停 */
  const s = await getState(page);
  expect(s.phase).toBe('running');
  expect(s.score).toBe(0);
  await expect(page.locator('#overlay-pause')).toBeHidden();
  await expect(page.locator('#btn-pause')).toHaveText('暂停');
});

test('E-G11 FR-08 破纪录提示→刷新保留→未破纪录不显示徽标', async ({ page }) => {
  await openGame(page, '?seed=42');
  await clickStart(page);
  await eatFood(page);
  await waitDeath(page);
  const dead = await getState(page);
  expect(dead.score).toBeGreaterThanOrEqual(10);
  await expect(page.locator('#over-record')).toBeVisible();
  await expect(page.locator('#over-record')).toHaveText('新纪录！');
  await expect(page.locator('#hud-high')).toHaveText(String(dead.score));
  /* 刷新后开始界面仍显示该最高分（FR-08 持久化） */
  await page.reload();
  await page.waitForFunction(() => !!(window.SnakeGame && window.SnakeGame.debug));
  await expect(page.locator('#hud-high')).toHaveText(String(dead.score));
  const ready = await getState(page);
  expect(ready.phase).toBe('ready');
  /* 第二局：按结算契约断言徽标显隐（score>appHigh 才显示） */
  await clickStart(page);
  await waitDeath(page);
  const dead2 = await getState(page);
  await expect(page.locator('#over-high')).toHaveText(String(Math.max(dead.score, dead2.score)));
  if (dead2.score > dead.score) {
    await expect(page.locator('#over-record')).toBeVisible();
  } else {
    await expect(page.locator('#over-record')).toBeHidden();
  }
});

test('E-G12 FR-08 localStorage  getter 抛异常：游戏仍可玩、会话内最高分更新、无 pageerror', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() { throw new DOMException('模拟 localStorage 不可用', 'SecurityError'); }
    });
  });
  await openGame(page, '?seed=42');
  await expect(page.locator('#hud-high')).toHaveText('0');
  await clickStart(page);
  await eatFood(page);
  await waitDeath(page);
  const dead = await getState(page);
  expect(dead.score).toBeGreaterThanOrEqual(10);
  /* 降级为会话内存：结算仍更新最高分显示与破纪录提示 */
  await expect(page.locator('#over-high')).toHaveText(String(dead.score));
  await expect(page.locator('#hud-high')).toHaveText(String(dead.score));
  await expect(page.locator('#over-record')).toBeVisible();
  /* 重开后仍可玩（fixture 收尾断言全程无 pageerror / console error） */
  await page.keyboard.press('Enter');
  await waitPhase(page, 'running');
  await waitTicks(page, 1);
});

test('E-G13 FR-09 吃满 5 个食物：界面速度指示更新为「速度 x5」', async ({ page }) => {
  test.setTimeout(180000);
  await openGame(page, '?seed=42');
  await expect(page.locator('#hud-speed')).toHaveText('速度 x4');
  await clickStart(page);
  const s = await eatFoods(page, 5);
  expect(s.foodEaten).toBe(5);
  expect(s.score).toBe(50);
  expect(s.speed).toBe(5);
  await page.waitForFunction(() => document.getElementById('hud-speed').textContent === '速度 x5');
});

test('E-G14 [M2] HUD 全 phase 常显、遮罩仅盖棋盘不盖 HUD、分数纯数字、按钮状态机', async ({ page }) => {
  await openGame(page, '?seed=42');
  const hudIds = ['#hud-score', '#hud-high', '#hud-speed'];
  const hudHigh = page.locator('#hud-high');
  /* ready */
  for (const id of hudIds) await expect(page.locator(id)).toBeVisible();
  expect(await page.locator('#hud-score').textContent()).toMatch(/^\d+$/);
  let overlayBox = await page.locator('#overlay-start').boundingBox();
  let hudBox = await hudHigh.boundingBox();
  expect(intersects(overlayBox, hudBox), '开始遮罩不得覆盖最高分区域').toBe(false);
  await expect(page.locator('#btn-pause')).toBeDisabled();
  /* running */
  await clickStart(page);
  for (const id of hudIds) await expect(page.locator(id)).toBeVisible();
  await expect(page.locator('#btn-pause')).toBeEnabled();
  await expect(page.locator('#btn-pause')).toHaveText('暂停');
  /* paused */
  await page.keyboard.press('Space');
  await waitPhase(page, 'paused');
  for (const id of hudIds) await expect(page.locator(id)).toBeVisible();
  overlayBox = await page.locator('#overlay-pause').boundingBox();
  hudBox = await hudHigh.boundingBox();
  expect(intersects(overlayBox, hudBox), '暂停遮罩不得覆盖最高分区域').toBe(false);
  await expect(page.locator('#btn-pause')).toBeEnabled();
  await expect(page.locator('#btn-pause')).toHaveText('继续');
  /* over */
  await page.keyboard.press('Space');
  await waitPhase(page, 'running');
  await waitDeath(page);
  for (const id of hudIds) await expect(page.locator(id)).toBeVisible();
  expect(await page.locator('#hud-score').textContent()).toMatch(/^\d+$/);
  overlayBox = await page.locator('#overlay-over').boundingBox();
  hudBox = await hudHigh.boundingBox();
  expect(intersects(overlayBox, hudBox), '结束遮罩不得覆盖最高分区域').toBe(false);
  await expect(page.locator('#btn-pause')).toBeDisabled();
  await expect(page.locator('#btn-pause')).toHaveText('暂停');
});

test('E-G15 [FR-12] running 中 window blur → 自动暂停，回来需手动继续', async ({ page }) => {
  await openGame(page, '?seed=42');
  await clickStart(page);
  await waitTicks(page, 1);
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  await waitPhase(page, 'paused');
  await expect(page.locator('#overlay-pause')).toBeVisible();
  const frozen = await getState(page);
  await waitFrames(page, 30);
  const still = await getState(page);
  expect(still.tickCount).toBe(frozen.tickCount); /* 失焦后画面静止 */
  await page.keyboard.press('Space'); /* 手动继续 */
  await waitPhase(page, 'running');
});

test('E-G16 [NFR-03] 零跨源网络请求：全部请求同源', async ({ page }) => {
  await openGame(page, '?seed=42');
  await clickStart(page);
  await waitTicks(page, 3);
  await waitDeath(page);
  await page.keyboard.press('Enter');
  await waitPhase(page, 'running');
  const requests = page.__mon.requests;
  expect(requests.length).toBeGreaterThanOrEqual(9); /* html + css + 7 个 js */
  for (const url of requests) {
    expect(url.startsWith('http://127.0.0.1:4174/'), `发现跨源请求: ${url}`).toBe(true);
  }
});

test('E-G17 URL ?seed 复现与重开复用；非法种子忽略（m1，http 场景）', async ({ page }) => {
  await openGame(page, '?seed=42');
  const s1 = await getState(page);
  expect(s1.config.seed).toBe(42);
  await page.reload();
  await page.waitForFunction(() => !!(window.SnakeGame && window.SnakeGame.debug));
  const s2 = await getState(page);
  expect(s2.food).toEqual(s1.food); /* 同 seed → 首食物一致 */
  expect(s2.rngState).toBe(s1.rngState);
  /* 重开复用 URL seed：新局首食物与初始一致 */
  await clickStart(page);
  await waitDeath(page);
  await page.keyboard.press('Enter');
  await waitPhase(page, 'running');
  const s3 = await getState(page);
  expect(s3.config.seed).toBe(42);
  expect(s3.food).toEqual(s1.food);
  /* m1：超 uint32 上限与非数字种子均忽略，不崩溃、可正常开局 */
  await openGame(page, '?seed=99999999999');
  expect((await getState(page)).phase).toBe('ready');
  await clickStart(page);
  await openGame(page, '?seed=abc');
  expect((await getState(page)).phase).toBe('ready');
  await clickStart(page);
});
