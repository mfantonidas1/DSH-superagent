/* rng.test.js — Rng 模块单元测试（node:test + node:assert，CJS 直接 require 纯逻辑层）。
 * 契约依据：docs/API.md §4（mulberry32 参考实现逐位一致）；PRD NFR-06。
 * 执行：npm run test:unit（node --test tests/unit/）。数据自包含，无外部依赖。 */
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const Rng = require('../../frontend/js/rng.js');

/* 独立参考实现：逐字抄自 API.md §4 的算法参考（与被测源码分离书写）。 */
function refNext(s) {
  let t = (s + 0x6D2B79F5) >>> 0;
  let r = Math.imul(t ^ (t >>> 15), t | 1);
  r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
  return { state: t, value: ((r ^ (r >>> 14)) >>> 0) / 4294967296 };
}

const SEEDS = [0, 1, 42, 123456789, 2147483648, 4294967295];

describe('Rng.next（API §4）', () => {
  test('U-RNG-01 value ∈ [0,1)，state 为 uint32', () => {
    for (const seed of SEEDS) {
      let s = seed;
      for (let i = 0; i < 200; i++) {
        const r = Rng.next(s);
        assert.ok(Number.isInteger(r.state) && r.state >= 0 && r.state <= 4294967295,
          `state 越界: seed=${seed} i=${i} state=${r.state}`);
        assert.ok(typeof r.value === 'number' && r.value >= 0 && r.value < 1,
          `value 越界: seed=${seed} i=${i} value=${r.value}`);
        s = r.state;
      }
    }
  });

  test('U-RNG-02 与 API §4 参考实现逐位一致（6 种子 × 200 次迭代）', () => {
    for (const seed of SEEDS) {
      let got = seed;
      let want = seed;
      for (let i = 0; i < 200; i++) {
        const g = Rng.next(got);
        const w = refNext(want);
        assert.equal(g.state, w.state, `state 不一致: seed=${seed} 第 ${i} 次`);
        assert.equal(g.value, w.value, `value 不一致: seed=${seed} 第 ${i} 次`);
        got = g.state;
        want = w.state;
      }
    }
  });

  test('U-RNG-03 纯函数：同一输入恒同一输出，无内部状态', () => {
    const a = Rng.next(42);
    const b = Rng.next(42);
    assert.deepEqual(a, b);
    Rng.next(999); /* 中间调用不影响后续结果 */
    assert.deepEqual(Rng.next(42), a);
  });
});

describe('Rng.nextInt（API §4）', () => {
  test('U-RNG-04 value = floor(next().value × n) ∈ [0, n-1]，state 与 next 一致', () => {
    for (const seed of SEEDS) {
      for (const n of [1, 2, 3, 7, 25, 397, 1000000]) {
        const r = Rng.nextInt(seed, n);
        const ref = refNext(seed);
        assert.equal(r.state, ref.state);
        assert.equal(r.value, Math.floor(ref.value * n));
        assert.ok(Number.isInteger(r.value) && r.value >= 0 && r.value <= n - 1);
      }
    }
  });

  test('U-RNG-05 n=1 时 value 恒为 0', () => {
    for (const seed of SEEDS) {
      assert.equal(Rng.nextInt(seed, 1).value, 0);
    }
  });

  test('U-RNG-06 n<1 抛 RangeError（0、-1、-100）', () => {
    for (const n of [0, -1, -100]) {
      assert.throws(() => Rng.nextInt(42, n), RangeError, `n=${n} 应抛 RangeError`);
    }
  });
});
