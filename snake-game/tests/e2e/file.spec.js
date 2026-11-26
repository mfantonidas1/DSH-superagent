/* file.spec.js — file:// 直开场景 e2e（PRD A6/NFR-03、ARCHITECTURE R3、m1 非法种子）。
 * URL 用 path.resolve 构造（helpers.fileUrl），不硬编码绝对路径。
 * file:// 下 localStorage 可能受限：storage 降级语义由 game.spec E-G12 与单元测试覆盖，
 * 本文件只断言「可玩、无 pageerror、无 http(s) 网络请求」。 */
'use strict';

const { test, expect, getState, openFile, clickStart, waitPhase, waitTicks } = require('./helpers.js');

test('E-F01 file:// 直开：ready → 开始 → running，零 http(s) 请求', async ({ page }) => {
  await openFile(page, '?seed=123');
  const ready = await getState(page);
  expect(ready.phase).toBe('ready');
  expect(ready.config.seed).toBe(123); /* file:// 下 seed 钩子同样可用 */
  await expect(page.locator('#overlay-start')).toBeVisible();
  await expect(page.locator('#hud-high')).toHaveText(/^\d+$/);
  await clickStart(page);
  await waitTicks(page, 2);
  const s = await getState(page);
  expect(s.phase).toBe('running');
  expect(s.tickCount).toBeGreaterThanOrEqual(2);
  /* NFR-03：file:// 场景不得发起任何 http(s) 请求 */
  for (const url of page.__mon.requests) {
    expect(/^https?:/i.test(url), `file:// 场景发现网络请求: ${url}`).toBe(false);
  }
});

test('E-F02 [m1] file:// 非法种子（超 uint32 上限 / 非数字）不崩溃、可正常开局', async ({ page }) => {
  await openFile(page, '?seed=99999999999');
  expect((await getState(page)).phase).toBe('ready');
  await clickStart(page);
  await waitTicks(page, 1);
  expect((await getState(page)).phase).toBe('running');
  await openFile(page, '?seed=abc');
  expect((await getState(page)).phase).toBe('ready');
  await clickStart(page);
  expect((await getState(page)).phase).toBe('running');
  /* fixture 收尾断言全程无 pageerror / console error */
});
