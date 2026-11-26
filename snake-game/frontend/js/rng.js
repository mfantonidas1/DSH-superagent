/* rng.js — 可设种子随机数（mulberry32，纯函数，无依赖）。
 * 契约：docs/API.md §4。随机状态经返回值流转，不持内部状态，保证同 seed 同序列可复现。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SnakeGame = root.SnakeGame || {};
    root.SnakeGame.Rng = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* next(rngState:uint32) -> {state:uint32, value:[0,1)}。算法与 API §4 逐字一致。 */
  function next(s) {
    var t = (s + 0x6D2B79F5) >>> 0;
    var r = Math.imul(t ^ (t >>> 15), t | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return { state: t, value: ((r ^ (r >>> 14)) >>> 0) / 4294967296 };
  }

  /* nextInt(rngState:uint32, n:integer>=1) -> {state:uint32, value:[0,n-1]}；n<1 抛 RangeError。 */
  function nextInt(s, n) {
    if (!Number.isInteger(n) || n < 1) {
      throw new RangeError('Rng.nextInt: n 必须为 >=1 的整数');
    }
    var r = next(s);
    return { state: r.state, value: Math.floor(r.value * n) };
  }

  return { next: next, nextInt: nextInt };
});