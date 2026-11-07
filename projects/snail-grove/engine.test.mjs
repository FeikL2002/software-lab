import assert from 'node:assert/strict';
import test from 'node:test';
import { PAYTABLE, pickOutcome, resolveRound, makeReels } from './dist/engine.js';

test('published probabilities total 1 with a 99% theoretical return', () => {
  const totalProbability = PAYTABLE.reduce((sum, item) => sum + item.probability, 0);
  const expectedReturn = PAYTABLE.reduce((sum, item) => sum + item.probability * item.multiplier, 0);
  assert.ok(Math.abs(totalProbability - 1) < 1e-12);
  assert.ok(Math.abs(expectedReturn - 0.99) < 1e-12);
  assert.equal(Object.isFrozen(PAYTABLE), true);
  assert.equal(PAYTABLE.every(Object.isFrozen), true);
});

test('outcome bands include their lower boundary and exclude their upper boundary', () => {
  for (const [random, expected] of [
    [0, 0], [0.549999999, 0],
    [0.55, 1], [0.799999999, 1],
    [0.8, 2], [0.919999999, 2],
    [0.92, 5], [0.979999999, 5],
    [0.98, 10], [0.999999999, 10],
  ]) {
    assert.equal(pickOutcome(random), expected, `random value ${random}`);
  }
  for (const invalid of [-1, 1, Infinity, NaN, undefined, '0.5']) {
    assert.throws(() => pickOutcome(invalid), RangeError);
  }
});

test('settlement reports gross return and net profit accurately', () => {
  assert.deepEqual(resolveRound({ balance: 1, stake: 0.01, multiplier: 10 }), {
    balance: 1.09, stake: 0.01, returned: 0.1, profit: 0.09,
  });
  assert.deepEqual(resolveRound({ balance: 1, stake: 0.25, multiplier: 0 }), {
    balance: 0.75, stake: 0.25, returned: 0, profit: -0.25,
  });
  assert.deepEqual(resolveRound({ balance: 1, stake: 0.33, multiplier: 1 }), {
    balance: 1, stake: 0.33, returned: 0.33, profit: 0,
  });
  assert.equal(resolveRound({ balance: 0.29, stake: 0.29, multiplier: 0 }).balance, 0);
});

test('repeated minimum-stake losses remain cent-accurate and cannot overdraw', () => {
  let balance = 1;
  for (let index = 0; index < 100; index++) {
    balance = resolveRound({ balance, stake: 0.01, multiplier: 0 }).balance;
    assert.equal(balance, (99 - index) / 100);
  }
  assert.equal(balance, 0);
  assert.throws(() => resolveRound({ balance, stake: 0.01, multiplier: 0 }), RangeError);
});

test('invalid money and unsupported outcomes are rejected', () => {
  for (const change of [
    { balance: -1 }, { balance: NaN }, { balance: Infinity },
    { balance: 0 }, { balance: 1.001 }, { balance: '1' },
    { stake: 0 }, { stake: -0.01 }, { stake: 1.01 },
    { stake: 0.001 }, { stake: NaN },
    { multiplier: 3 }, { multiplier: -1 }, { multiplier: '2' },
  ]) {
    assert.throws(() => resolveRound({ balance: 1, stake: 0.01, multiplier: 2, ...change }), RangeError);
  }
});

test('reels show each selected winning symbol on the centerline', () => {
  for (const { multiplier, symbol } of PAYTABLE.filter((entry) => entry.multiplier > 0)) {
    const reels = makeReels(multiplier, () => 0.5);
    assert.equal(reels.length, 3);
    assert.equal(reels.every((column) => column.length === 3), true);
    assert.deepEqual(reels.map((column) => column[1]), [symbol, symbol, symbol]);
    assert.equal(reels.flat().every((item) => PAYTABLE.some((entry) => entry.symbol === item)), true);
  }
});

test('losing reels never accidentally show a centerline match', () => {
  for (const random of [0, 0.2, 0.4, 0.6, 0.8, 0.999999]) {
    const centers = makeReels(0, () => random).map((column) => column[1]);
    assert.equal(new Set(centers).size > 1, true);
  }
  assert.throws(() => makeReels(3), RangeError);
  assert.throws(() => makeReels(2, () => 1), RangeError);
  assert.throws(() => makeReels(2, 0.5), TypeError);
});
