/* input.js — 键盘/触摸 -> 语义回调（仅浏览器，不含游戏规则）。
 * 契约：docs/API.md §7。
 * B1 双保险之一：方向键、空格与 Enter 均 preventDefault（Enter 默认行为会激活聚焦按钮）。
 * 带修饰键（Ctrl/Meta/Alt）的组合键一律放行，不劫持浏览器快捷键。 */
(function (root) {
  'use strict';

  /* 无原型字典：与 engine DIRECTIONS 同类加固，合成事件的原型链键不得命中映射（D-01 同类） */
  var KEYMAP = Object.assign(Object.create(null), {
    ArrowUp: 'up', w: 'up', W: 'up',
    ArrowDown: 'down', s: 'down', S: 'down',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right'
  });

  /* bindKeyboard(target: Window, handlers: KeyHandlers) -> 解绑函数。仅 keydown；e.repeat 忽略。 */
  function bindKeyboard(target, handlers) {
    function onKeyDown(e) {
      if (e.repeat) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      var dir = KEYMAP[e.key];
      if (dir) {
        e.preventDefault();
        handlers.onDirection(dir);
        return;
      }
      if (e.key === ' ') {
        e.preventDefault();
        handlers.onSpace();
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handlers.onEnter();
        return;
      }
      if (e.key === 'p' || e.key === 'P') {
        handlers.onPauseKey();
      }
    }
    target.addEventListener('keydown', onKeyDown);
    return function () { target.removeEventListener('keydown', onKeyDown); };
  }

  /* bindTouch(el, {onDirection}) -> 解绑函数（P1，FR-10）：
   * 位移 max(|dx|,|dy|) >= 30 CSS px 才触发，取主导轴（|dx|>|dy| 水平）；
   * el 设 touch-action:none 且 touchmove preventDefault 防滚动。 */
  function bindTouch(el, handlers) {
    var startX = 0;
    var startY = 0;
    var tracking = false;

    function onStart(e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      tracking = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    }
    function onMove(e) {
      e.preventDefault();
    }
    function onEnd(e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 30) return;
      var dir;
      if (Math.abs(dx) > Math.abs(dy)) dir = dx > 0 ? 'right' : 'left';
      else dir = dy > 0 ? 'down' : 'up';
      handlers.onDirection(dir);
    }

    el.style.touchAction = 'none';
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    return function () {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
    };
  }

  root.SnakeGame = root.SnakeGame || {};
  root.SnakeGame.Input = { bindKeyboard: bindKeyboard, bindTouch: bindTouch };
})(typeof window !== 'undefined' ? window : this);