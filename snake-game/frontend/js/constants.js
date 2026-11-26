/* constants.js — 全部数值/方向/文案/颜色常量（纯常量，无依赖）。
 * 契约：docs/API.md §2。UMD 式双端导出（API §1）：浏览器挂 window.SnakeGame.Constants，Node 走 module.exports。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SnakeGame = root.SnakeGame || {};
    root.SnakeGame.Constants = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  return Object.freeze({
    GRID_WIDTH: 20,
    GRID_HEIGHT: 20,
    CELL_SIZE: 30,
    INITIAL_LENGTH: 3,
    INITIAL_SPEED: 4,
    MAX_SPEED: 12,
    FOODS_PER_LEVEL: 5,
    SCORE_PER_FOOD: 10,
    MAX_FRAME_DELTA_MS: 250,
    STORAGE_KEY: 'snake-game.highScore.v1',
    DIRECTION: Object.freeze({ UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right' }),
    OPPOSITE: Object.freeze({ up: 'down', down: 'up', left: 'right', right: 'left' }),
    DELTA: Object.freeze({
      up: Object.freeze({ x: 0, y: -1 }),
      down: Object.freeze({ x: 0, y: 1 }),
      left: Object.freeze({ x: -1, y: 0 }),
      right: Object.freeze({ x: 1, y: 0 })
    }),
    COLORS: Object.freeze({
      boardLight: '#f3f7f0',
      boardDark: '#e8efe3',
      snakeHead: '#1b7a3d',
      snakeBody: '#3fae62',
      food: '#d94f3d'
    }),
    TEXT: Object.freeze({
      title: '贪食蛇',
      start: '开始游戏',
      pause: '暂停',
      paused: '已暂停',
      resume: '继续',
      over: '游戏结束',
      restart: '重新开始',
      record: '新纪录！',
      scoreLabel: '分数',
      highLabel: '最高分',
      speedPrefix: '速度 x',
      help: '方向键 / WASD 转向，空格暂停，回车开始/重开'
    })
  });
});