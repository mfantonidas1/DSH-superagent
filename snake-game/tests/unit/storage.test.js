/* storage.test.js — Storage 模块单元测试（node:test + node:assert）。
 * 契约依据：docs/API.md v1.2 §5（注入后端、降级语义、键名/值格式）；PRD FR-08、NFR-04。
 * 执行：npm run test:unit。后端全部为自包含内存假实现（可注入抛异常行为），不触碰真实 localStorage。
 * 契约澄清：U-STO-08 前导零取值按 API §5 字面正则 /^\d+$/ 断言（'007'→7），
 *           与 QA 任务简报「前导零按 0」存在出入，见 docs/TEST-PLAN.md 澄清项 C-01。 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Storage = require('../../frontend/js/storage.js');
const Constants = require('../../frontend/js/constants.js');

const KEY = Constants.STORAGE_KEY; /* 'snake-game.highScore.v1' */

/* ---------- 可注入行为的内存后端 ---------- */

function memBackend(initial) {
  const map = new Map(Object.entries(initial || {}));
  const calls = { get: 0, set: 0 };
  const flags = { throwOnGet: false, throwOnSet: false };
  return {
    map, calls, flags,
    getItem(k) {
      calls.get++;
      if (flags.throwOnGet) throw new Error('模拟 getItem 异常');
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      calls.set++;
      if (flags.throwOnSet) throw new Error('模拟 setItem 异常');
      map.set(k, String(v));
    }
  };
}

describe('Storage 正常路径（API §5）', () => {
  test('U-STO-01 新后端：load=0、isPersistent=true', () => {
    const st = Storage.createStorage(memBackend());
    assert.equal(st.loadHighScore(), 0);
    assert.equal(st.isPersistent(), true);
  });

  test('U-STO-02 读写往返：键名=Constants.STORAGE_KEY，值为无前导零十进制字符串', () => {
    assert.equal(Storage.STORAGE_KEY, KEY);
    assert.equal(KEY, 'snake-game.highScore.v1');
    const be = memBackend();
    const st = Storage.createStorage(be);
    assert.equal(st.saveHighScore(100), true);
    assert.equal(be.map.get(KEY), '100');
    assert.equal(be.map.size, 1, 'NFR-04：仅一个存储键');
    assert.equal(st.loadHighScore(), 100);
    /* 新实例从同一后端恢复 */
    const st2 = Storage.createStorage(be);
    assert.equal(st2.loadHighScore(), 100);
  });

  test('U-STO-03 score ≤ 当前最高分：返回 false 且不写后端', () => {
    const be = memBackend({ [KEY]: '100' });
    const st = Storage.createStorage(be);
    const setsBefore = be.calls.set;
    assert.equal(st.saveHighScore(100), false); /* 等于 */
    assert.equal(st.saveHighScore(50), false);  /* 小于 */
    assert.equal(st.saveHighScore(0), false);
    assert.equal(be.calls.set, setsBefore, '不得触发 setItem');
    assert.equal(be.map.get(KEY), '100');
    assert.equal(st.saveHighScore(200), true);
    assert.equal(be.map.get(KEY), '200');
  });

  test('U-STO-04 loadHighScore = max(内存值, 持久值)', () => {
    const be = memBackend({ [KEY]: '500' });
    const st = Storage.createStorage(be);
    assert.equal(st.loadHighScore(), 500);
    assert.equal(st.saveHighScore(600), true);
    be.map.set(KEY, '50'); /* 外部把持久值改小 */
    assert.equal(st.loadHighScore(), 600, '内存值 600 应兜底');
  });

  test('U-STO-05 非法 score 抛 RangeError（负数/小数/字符串/NaN/Infinity）', () => {
    const st = Storage.createStorage(memBackend());
    for (const bad of [-1, 0.5, '10', NaN, Infinity, null, undefined]) {
      assert.throws(() => st.saveHighScore(bad), RangeError, `score=${String(bad)}`);
    }
  });
});

describe('Storage 损坏持久值（API §5：仅接受 /^\\d+$/ 且安全整数，否则按 0）', () => {
  test('U-STO-06 非数字串按 0（abc/空串/负号/小数/科学计数/带空格）', () => {
    for (const raw of ['abc', '', '-5', '1.5', '1e3', ' 12', '12 ', '0x10']) {
      const st = Storage.createStorage(memBackend({ [KEY]: raw }));
      assert.equal(st.loadHighScore(), 0, `持久值 ${JSON.stringify(raw)} 应按 0`);
      assert.equal(st.isPersistent(), true, '损坏值不应触发降级');
    }
  });

  test('U-STO-07 超安全整数按 0；MAX_SAFE_INTEGER 本身可接受', () => {
    for (const raw of ['9007199254740992', '99999999999999999999']) {
      const st = Storage.createStorage(memBackend({ [KEY]: raw }));
      assert.equal(st.loadHighScore(), 0, `持久值 ${raw} 应按 0`);
    }
    const ok = Storage.createStorage(memBackend({ [KEY]: '9007199254740991' }));
    assert.equal(ok.loadHighScore(), 9007199254740991);
  });

  test('U-STO-08 [C-01] 前导零：按 API §5 字面正则 /^\\d+$/ 接受（007→7）', () => {
    /* API §5 的接受条件仅为「/^\d+$/ 且安全整数」，'007' 满足两者 → 7。
     * 「无前导零」在 API 中是对*写入值格式*的约束（saveHighScore 写 String(score)），
     * 并非读取拒绝条件。QA 任务简报期望按 0，与契约字面冲突 → 记录澄清项 C-01，
     * 本断言以 API.md v1.2 为准；若架构师改判「前导零按 0」，仅需改本用例与实现一处。 */
    const st = Storage.createStorage(memBackend({ [KEY]: '007' }));
    assert.equal(st.loadHighScore(), 7);
    /* 写入侧确无前导零 */
    const be = memBackend();
    const st2 = Storage.createStorage(be);
    st2.saveHighScore(7);
    assert.equal(be.map.get(KEY), '7');
  });
});

describe('Storage 降级（FR-08：存储不可用游戏仍可玩，会话内最高分正确）', () => {
  test('U-STO-09 backend=null：内存模式，save 返回 false 但会话内 load 正确', () => {
    const st = Storage.createStorage(null);
    assert.equal(st.isPersistent(), false);
    assert.equal(st.loadHighScore(), 0);
    assert.equal(st.saveHighScore(50), false);
    assert.equal(st.loadHighScore(), 50);
    assert.equal(st.saveHighScore(30), false); /* ≤ 不更新 */
    assert.equal(st.loadHighScore(), 50);
    assert.equal(st.saveHighScore(80), false);
    assert.equal(st.loadHighScore(), 80);
  });

  test('U-STO-10 构造探测抛异常 → 降级内存模式', () => {
    const be = memBackend({ [KEY]: '999' });
    be.flags.throwOnGet = true;
    const st = Storage.createStorage(be);
    assert.equal(st.isPersistent(), false);
    assert.equal(st.loadHighScore(), 0, '探测失败不得读出持久值');
    assert.equal(st.saveHighScore(60), false);
    assert.equal(st.loadHighScore(), 60, '会话内存值仍更新');
  });

  test('U-STO-11 读取抛异常 → 按 0 并置 persistent=false', () => {
    const be = memBackend({ [KEY]: '100' });
    const st = Storage.createStorage(be);
    assert.equal(st.loadHighScore(), 100);
    be.flags.throwOnGet = true;
    assert.equal(st.loadHighScore(), 0);
    assert.equal(st.isPersistent(), false);
  });

  test('U-STO-12 写入抛异常 → 返回 false、persistent=false，内存值已更新', () => {
    const be = memBackend();
    const st = Storage.createStorage(be);
    be.flags.throwOnSet = true;
    assert.equal(st.saveHighScore(100), false);
    assert.equal(st.isPersistent(), false);
    assert.equal(st.loadHighScore(), 100, '内存值已更新，会话内仍正确');
    /* 降级后继续破纪录：仍返回 false，但会话值继续更新 */
    assert.equal(st.saveHighScore(200), false);
    assert.equal(st.loadHighScore(), 200);
  });

  test('U-STO-13 isPersistent 状态迁移：true →（写失败）false，且不再恢复', () => {
    const be = memBackend();
    const st = Storage.createStorage(be);
    assert.equal(st.isPersistent(), true);
    assert.equal(st.saveHighScore(10), true);
    be.flags.throwOnSet = true;
    assert.equal(st.saveHighScore(20), false);
    assert.equal(st.isPersistent(), false);
    be.flags.throwOnSet = false; /* 后端恢复也不得自动回到持久模式 */
    assert.equal(st.isPersistent(), false);
    assert.equal(st.saveHighScore(30), false);
    assert.equal(st.loadHighScore(), 30);
  });
});
