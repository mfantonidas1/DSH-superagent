/* storage.js — 最高分存储（纯逻辑 + 注入后端，无 DOM 依赖，Node 可直接 require 测试）。
 * 契约：docs/API.md §5。键名固定 'snake-game.highScore.v1'（与 Constants.STORAGE_KEY 同值，契约固定）。
 * 降级语义（FR-08）：backend=null / 探测抛异常 / 读写抛异常 -> 内存模式，游戏功能不受影响。 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.SnakeGame = root.SnakeGame || {};
    root.SnakeGame.Storage = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var STORAGE_KEY = 'snake-game.highScore.v1';

  /* createStorage(backend: StorageBackend|null) -> Storage */
  function createStorage(backend) {
    var memory = 0;
    var persistent = false;
    if (backend) {
      try {
        backend.getItem(STORAGE_KEY); /* 构造探测 */
        persistent = true;
      } catch (e) {
        persistent = false;
      }
    }

    function readPersisted() {
      if (!persistent) return 0;
      try {
        var raw = backend.getItem(STORAGE_KEY);
        if (typeof raw === 'string' && /^\d+$/.test(raw)) {
          var n = Number(raw);
          if (Number.isSafeInteger(n)) return n;
        }
        return 0;
      } catch (e) {
        persistent = false;
        return 0;
      }
    }

    /* loadHighScore() -> max(内存值, 持久值)，>=0 */
    function loadHighScore() {
      return Math.max(memory, readPersisted());
    }

    /* saveHighScore(score) -> boolean；非法 score 抛 RangeError；
     * score<=当前最高分不写；否则先更新内存再 try 持久化（失败时内存值已更新，会话内仍正确）。 */
    function saveHighScore(score) {
      if (!Number.isInteger(score) || score < 0) {
        throw new RangeError('saveHighScore: score 必须为 >=0 的整数');
      }
      if (score <= loadHighScore()) return false;
      memory = score;
      if (!persistent) return false;
      try {
        backend.setItem(STORAGE_KEY, String(score));
        return true;
      } catch (e) {
        persistent = false;
        return false;
      }
    }

    function isPersistent() {
      return persistent;
    }

    return { loadHighScore: loadHighScore, saveHighScore: saveHighScore, isPersistent: isPersistent };
  }

  return { createStorage: createStorage, STORAGE_KEY: STORAGE_KEY };
});