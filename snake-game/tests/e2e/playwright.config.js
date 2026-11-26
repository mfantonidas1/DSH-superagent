/* playwright.config.js — e2e 配置（@playwright/test 1.59.0，chromium-1217 本机已缓存）。
 * 执行：npm run test:e2e（cwd = snake-game 根）。
 * 端口约定：4173 已被 Lead 冒烟服务器占用，本套件固定使用 4174。
 * 反 flaky 约定：workers=1、fullyParallel=false；游戏进度断言一律走
 * window.SnakeGame.debug.getState() + waitForFunction，禁止固定 sleep。 */
'use strict';

const path = require('path');
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: __dirname,
  workers: 1,
  fullyParallel: false,
  reporter: 'list',
  timeout: 90000,
  expect: { timeout: 5000 },
  use: {
    baseURL: 'http://127.0.0.1:4174',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'python3 -m http.server 4174 --bind 127.0.0.1 --directory frontend',
    cwd: path.resolve(__dirname, '../..'),
    url: 'http://127.0.0.1:4174',
    reuseExistingServer: true,
    timeout: 30000
  }
});
