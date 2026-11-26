/* renderer.js — Canvas 2D 绘制（仅浏览器）。
 * 契约：docs/API.md §6。只画棋盘/蛇/食物，不画任何文字（文字全在 DOM），不修改 state。
 * 逻辑画布 width*cellSize × height*cellSize；backing store 乘 devicePixelRatio；resize(cssWidth) 保持纵横比。 */
(function (root) {
  'use strict';
  var Constants = root.SnakeGame.Constants;

  function createRenderer(canvas, opts) {
    opts = opts || {};
    var cellSize = opts.cellSize || Constants.CELL_SIZE;
    var ctx = canvas.getContext('2d');
    var logicalW = 0;
    var logicalH = 0;
    var scale = 1;
    var cssWidth = null; /* null = 默认逻辑宽度 */
    var lastState = null;

    function applySize(state) {
      logicalW = state.width * cellSize;
      logicalH = state.height * cellSize;
      var w = cssWidth === null ? logicalW : cssWidth;
      var h = w * logicalH / logicalW;
      var dpr = root.devicePixelRatio || 1;
      canvas.style.width = w + 'px';
      canvas.style.height = h + 'px';
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      scale = canvas.width / logicalW;
    }

    /* resize(cssWidth)：设置 CSS 宽度并保持比例（FR-11）。 */
    function resize(w) {
      cssWidth = w;
      if (lastState) applySize(lastState);
    }

    function roundedRect(x, y, w, h, r) {
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }

    /* draw(state)：清屏 -> 棋盘格 -> 食物 -> 蛇（头深身浅）。state 的纯函数。 */
    function draw(state) {
      lastState = state;
      if (logicalW !== state.width * cellSize || logicalH !== state.height * cellSize) applySize(state);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.clearRect(0, 0, logicalW, logicalH);

      var x, y, i, s;
      for (y = 0; y < state.height; y++) {
        for (x = 0; x < state.width; x++) {
          ctx.fillStyle = (x + y) % 2 === 0 ? Constants.COLORS.boardLight : Constants.COLORS.boardDark;
          ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
      }

      if (state.food) {
        ctx.fillStyle = Constants.COLORS.food;
        ctx.beginPath();
        ctx.arc((state.food.x + 0.5) * cellSize, (state.food.y + 0.5) * cellSize, cellSize * 0.35, 0, Math.PI * 2);
        ctx.fill();
      }

      var inset = Math.max(1, cellSize * 0.06);
      var radius = cellSize * 0.22;
      for (i = state.snake.length - 1; i >= 0; i--) {
        s = state.snake[i];
        ctx.fillStyle = i === 0 ? Constants.COLORS.snakeHead : Constants.COLORS.snakeBody;
        roundedRect(s.x * cellSize + inset, s.y * cellSize + inset, cellSize - inset * 2, cellSize - inset * 2, radius);
        ctx.fill();
      }
    }

    return { draw: draw, resize: resize };
  }

  root.SnakeGame = root.SnakeGame || {};
  root.SnakeGame.Renderer = { createRenderer: createRenderer };
})(typeof window !== 'undefined' ? window : this);