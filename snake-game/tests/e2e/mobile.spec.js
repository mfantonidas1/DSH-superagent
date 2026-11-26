/* mobile.spec.js — 移动端 e2e（FR-10 触摸滑动 / FR-11 可玩布局，P1）。
 * 环境：viewport 390×844、hasTouch:true、isMobile:true（chromium）。
 * 滑动助手：CDP Input.dispatchTouchEvent 真实触摸事件，位移 ≥30 CSS px（API §7 bindTouch 阈值）。
 * 反 flaky：方向生效断言走 debug.getState().direction + waitForFunction；
 * 转向序列均为「阶梯形」不回绕路径，避免自撞干扰。 */
'use strict';

const {
  test, expect, getState, openGame, waitPhase, waitDeath, waitTicks, waitDirection, swipe
} = require('./helpers.js');

test.use({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true
});

test('E-M01 FR-11 竖屏布局：棋盘不横向溢出、#btn-pause 首屏可见可点（≥44px）', async ({ page }) => {
  await openGame(page, '?seed=42');
  const box = await page.locator('#board-wrap').boundingBox();
  expect(box).not.toBeNull();
  expect(box.width).toBeLessThanOrEqual(390);
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(390);
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth).toBeLessThanOrEqual(390); /* 页面无横向溢出 */
  const pause = page.locator('#btn-pause');
  await expect(pause).toBeVisible();
  const pauseBox = await pause.boundingBox();
  expect(pauseBox.height).toBeGreaterThanOrEqual(44); /* 触达目标 ≥44px */
  await expect(pause).toBeDisabled(); /* ready 态禁用但可见 */
  await page.tap('#btn-start');
  await waitPhase(page, 'running');
  await expect(pause).toBeEnabled();
});

test('E-M02 FR-10 触摸滑动转向：上/右/下（真实触摸事件，不触发页面滚动）', async ({ page }) => {
  await openGame(page, '?seed=42');
  await page.tap('#btn-start');
  await waitPhase(page, 'running');
  const scrollBefore = await page.evaluate(() => window.scrollY);
  await swipe(page, 0, -60); /* 上滑 */
  await waitDirection(page, 'up');
  await swipe(page, 60, 0); /* 右滑 */
  await waitDirection(page, 'right');
  await swipe(page, 0, 60); /* 下滑 */
  await waitDirection(page, 'down');
  await swipe(page, 60, 0); /* 再右滑 */
  await waitDirection(page, 'right');
  const s = await getState(page);
  expect(s.phase).toBe('running');
  const scrollAfter = await page.evaluate(() => window.scrollY);
  expect(scrollAfter).toBe(scrollBefore); /* 棋盘上滑动不得触发页面滚动 */
});

test('E-M03 FR-10 左滑转向（先上滑脱离初始向右）', async ({ page }) => {
  await openGame(page, '?seed=42');
  await page.tap('#btn-start');
  await waitPhase(page, 'running');
  await swipe(page, 0, -60);
  await waitDirection(page, 'up');
  await swipe(page, -60, 0); /* 左滑 */
  await waitDirection(page, 'left');
  expect((await getState(page)).phase).toBe('running');
});

test('E-M04 FR-10 主导轴判定与 30px 阈值：斜向取主导轴、小于阈值忽略', async ({ page }) => {
  await openGame(page, '?seed=42');
  await page.tap('#btn-start');
  await waitPhase(page, 'running');
  await swipe(page, 0, -60);
  await waitDirection(page, 'up');
  await swipe(page, 60, 40); /* |dx|>|dy| → 水平主导 → right */
  await waitDirection(page, 'right');
  await swipe(page, 40, 60); /* |dy|>|dx| → 垂直主导 → down */
  await waitDirection(page, 'down');
  /* 位移 10px < 30px 阈值：忽略，方向不变 */
  await swipe(page, 0, -10);
  await waitTicks(page, 2);
  const s = await getState(page);
  expect(s.direction).toBe('down');
  expect(s.pendingDirection).toBeNull();
  expect(s.phase).toBe('running');
});

test('E-M05 FR-11 无键盘完整闭环：点开始→滑动→点暂停→点继续→死亡→点重开', async ({ page }) => {
  await openGame(page, '?seed=42');
  await page.tap('#btn-start');
  await waitPhase(page, 'running');
  await swipe(page, 0, -60);
  await waitDirection(page, 'up');
  await page.tap('#btn-pause');
  await waitPhase(page, 'paused');
  await expect(page.locator('#overlay-pause')).toBeVisible();
  await expect(page.locator('#btn-pause')).toHaveText('继续');
  await page.tap('#btn-pause');
  await waitPhase(page, 'running');
  await expect(page.locator('#btn-pause')).toHaveText('暂停');
  await waitDeath(page); /* 向上直行撞墙 */
  await expect(page.locator('#overlay-over')).toBeVisible();
  await page.tap('#btn-restart');
  await waitPhase(page, 'running');
  const fresh = await getState(page);
  expect(fresh.score).toBe(0);
  expect(fresh.snake.length).toBe(3);
  await expect(page.locator('#overlay-over')).toBeHidden();
});
