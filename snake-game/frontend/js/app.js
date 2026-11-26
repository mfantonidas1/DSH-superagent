/* app.js — 唯一编排者（仅浏览器）：rAF 游戏循环、输入接线、HUD/遮罩、死亡结算、失焦暂停。
 * 契约：docs/API.md §7（v1.2）；视觉与交互：docs/UI-SPEC.md v1.0。
 * B1 双保险：① input.js 对 Enter preventDefault；② 本文件所有按钮 click 处理后立即 blur()。 */
(function (root) {
  'use strict';
  var SG = root.SnakeGame;
  var C = SG.Constants;
  var Engine = SG.Engine;
  var Storage = SG.Storage;
  var Renderer = SG.Renderer;
  var Input = SG.Input;

  /* URL ?seed=<uint32>：/^\d+$/ 且 <=4294967295，非法忽略（m1）。file:// 下同样可用。 */
  function parseUrlSeed() {
    try {
      var raw = new URLSearchParams(root.location.search).get('seed');
      if (raw !== null && /^\d+$/.test(raw) && Number(raw) <= 4294967295) return Number(raw) >>> 0;
    } catch (e) { /* 非法忽略，回退默认 */ }
    return null;
  }

  function boot() {
    var doc = root.document;
    function byId(id) { return doc.getElementById(id); }
    var canvas = byId('board');
    var boardWrap = byId('board-wrap');
    var hudScore = byId('hud-score');
    var hudHigh = byId('hud-high');
    var hudSpeed = byId('hud-speed');
    var overlayStart = byId('overlay-start');
    var overlayPause = byId('overlay-pause');
    var overlayOver = byId('overlay-over');
    var btnStart = byId('btn-start');
    var btnPause = byId('btn-pause');
    var btnRestart = byId('btn-restart');
    var overScore = byId('over-score');
    var overHigh = byId('over-high');
    var overRecord = byId('over-record');

    var urlSeed = parseUrlSeed();
    function newSeed() { return urlSeed !== null ? urlSeed : (Date.now() >>> 0); }

    /* 存储后端：取 window.localStorage 本身须 try/catch（file:// 部分场景抛异常，FR-08 降级） */
    var backend = null;
    try { backend = root.localStorage; } catch (e) { backend = null; }
    var storage = Storage.createStorage(backend);
    var appHigh = storage.loadHighScore(); /* 会话最高分（R7：游玩中 HUD 显示此值） */

    var state = Engine.createGame({ seed: newSeed() });
    var renderer = Renderer.createRenderer(canvas);

    var acc = 0;          /* 时间累加器（ms）；start/restart/pause/resume 一律清零 */
    var last = null;      /* 上一帧时间戳 */
    var shownPhase = null;

    function updateHud() {
      hudScore.textContent = String(state.score);
      hudHigh.textContent = String(appHigh);
      hudSpeed.textContent = C.TEXT.speedPrefix + state.speed;
    }

    /* 遮罩显隐只用 hidden；HUD 常显；遮罩出现时焦点移到对应主按钮（UI-SPEC §4）。 */
    function syncOverlays() {
      overlayStart.hidden = state.phase !== 'ready';
      overlayPause.hidden = state.phase !== 'paused';
      overlayOver.hidden = state.phase !== 'over';
      btnPause.disabled = state.phase === 'ready' || state.phase === 'over';
      btnPause.textContent = state.phase === 'paused' ? C.TEXT.resume : C.TEXT.pause;
      if (state.phase !== shownPhase) {
        shownPhase = state.phase;
        if (state.phase === 'ready') btnStart.focus();
        else if (state.phase === 'paused') btnPause.focus();
        else if (state.phase === 'over') btnRestart.focus();
      }
    }

    /* 死亡结算（wall/self/cleared 同一路径）：破纪录则更新会话最高分并持久化。 */
    function settle() {
      var isRecord = state.score > appHigh;
      if (isRecord) {
        appHigh = state.score;
        storage.saveHighScore(appHigh);
      }
      overScore.textContent = String(state.score);
      overHigh.textContent = String(appHigh);
      overRecord.hidden = !isRecord;
      updateHud();
      syncOverlays();
    }

    function startGame() {
      if (Engine.start(state)) {
        acc = 0;
        updateHud();
        syncOverlays();
      }
    }

    /* restart：createGame(同 config)，URL 未指定 seed 时取新 seed；直接 running（FR-05）。 */
    function restart() {
      var config = Object.assign({}, state.config, { seed: newSeed() });
      state = Engine.createGame(config);
      Engine.start(state);
      acc = 0;
      overRecord.hidden = true;
      updateHud();
      syncOverlays();
    }

    function togglePause() {
      if (state.phase === 'running') {
        Engine.pause(state);
        acc = 0;
        syncOverlays();
      } else if (state.phase === 'paused') {
        Engine.resume(state);
        acc = 0;
        syncOverlays();
      }
    }

    /* 主循环：rAF；dt 钳制 250ms；仅 running 累积；补拍循环按 API §7 写死（m2）。 */
    function frame(now) {
      root.requestAnimationFrame(frame);
      if (last === null) last = now;
      var dt = Math.min(now - last, C.MAX_FRAME_DELTA_MS);
      last = now;
      if (state.phase === 'running') {
        acc += dt;
        var interval = 1000 / state.speed;
        var ticked = false;
        while (acc >= interval && state.phase === 'running') {
          var r = Engine.tick(state);
          acc -= interval;
          interval = 1000 / state.speed; /* 每次迭代按当前 speed 重算，提速即时生效 */
          ticked = true;
          if (r.died) settle();
        }
        if (ticked) updateHud(); /* tick 后同帧更新 HUD（FR-07） */
      }
      renderer.draw(state);
    }

    /* phase × 输入语义表（API §7） */
    Input.bindKeyboard(root, {
      onDirection: function (dir) { Engine.submitDirection(state, dir); },
      onSpace: function () {
        if (state.phase === 'ready') startGame();
        else if (state.phase === 'over') restart();
        else togglePause();
      },
      onEnter: function () {
        if (state.phase === 'ready') startGame();
        else if (state.phase === 'over') restart();
      },
      onPauseKey: togglePause
    });

    /* B1 防线②：click 处理完成后立即 blur() */
    function onClick(btn, fn) {
      btn.addEventListener('click', function () { fn(); btn.blur(); });
    }
    onClick(btnStart, function () { if (state.phase === 'ready') startGame(); });
    onClick(btnPause, togglePause);
    onClick(btnRestart, function () { if (state.phase === 'over') restart(); });

    /* 触摸滑动区 = 棋盘容器（FR-10） */
    Input.bindTouch(boardWrap, {
      onDirection: function (dir) { Engine.submitDirection(state, dir); }
    });

    /* 失焦自动暂停（FR-12）：回来需手动继续 */
    function autoPause() {
      if (state.phase === 'running') {
        Engine.pause(state);
        acc = 0;
        syncOverlays();
      }
    }
    root.addEventListener('blur', autoPause);
    doc.addEventListener('visibilitychange', function () {
      if (doc.visibilityState === 'hidden') autoPause();
    });

    /* 棋盘自适应（FR-11）：CSS 宽度取容器内容宽，backing store 乘 dpr */
    function fit() {
      var w = boardWrap.clientWidth;
      if (w > 0) {
        renderer.resize(w);
        renderer.draw(state);
      }
    }
    root.addEventListener('resize', fit);

    /* 测试钩子（API §7）：只读深拷贝快照 */
    SG.debug = { getState: function () { return Engine.snapshot(state); } };

    updateHud();
    syncOverlays();
    renderer.draw(state);
    fit();
    root.requestAnimationFrame(frame);
  }

  if (root.document.readyState === 'loading') {
    root.document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(typeof window !== 'undefined' ? window : this);