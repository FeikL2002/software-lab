import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateActual, calculateQuote } from '../dist/engine.mjs';

const example = {
  hours: 6, hourlyPay: 25, supplies: 12, travel: 8, overhead: 10,
  margin: 20, feeRate: 0, fixedFee: 0, discount: 0, taxRate: 0,
};
const cent = n => Math.round(n * 100);

test('six total cleaner-hours pay the owner $150, separate from business profit', () => {
  const q = calculateQuote(example);
  assert.equal(q.labor, 150);
  assert.equal(q.ownerCompensation, 150);
  assert.equal(q.costs, 180);
  assert.equal(q.subtotal, 225);
  assert.equal(q.profit, 45);
  assert.equal(q.marginActual, 20);
});

test('discount lowers agreed price and business profit rather than inflating the starting price', () => {
  const q = calculateQuote({ ...example, discount: 10 });
  assert.equal(q.basePrice, 225);
  assert.equal(q.discountAmount, 22.5);
  assert.equal(q.subtotal, 202.5);
  assert.equal(q.profit, 22.5);
  assert.equal(q.marginActual, 11.11);
});

test('tax is excluded from profit, but card fee includes the customer tax payment', () => {
  const q = calculateQuote({ ...example, feeRate: 2.9, fixedFee: .3, taxRate: 8 });
  assert.equal(q.basePrice, 234.56);
  assert.equal(q.tax, 18.76);
  assert.equal(q.total, 253.32);
  assert.equal(q.processingFee, 7.65);
  assert.equal(q.profit, 46.91);
  assert.equal(q.marginActual, 20);
  assert.equal(cent(q.total), cent(q.subtotal) + cent(q.tax));
  assert.equal(cent(q.profit), cent(q.subtotal) - cent(q.costs) - cent(q.processingFee));
});

test('each monetary component reconciles in cents on awkward decimals', () => {
  const q = calculateQuote({
    ...example, hours: 2.333, hourlyPay: 24.17, supplies: 1.005,
    travel: 7.177, overhead: 2.779, discount: 7.6, taxRate: 6.75,
    feeRate: 2.9, fixedFee: .3, margin: 23.5,
  });
  assert.equal(q.supplies, 1.01);
  assert.equal(cent(q.basePrice) - cent(q.discountAmount), cent(q.subtotal));
  assert.equal(cent(q.labor) + cent(q.supplies) + cent(q.travel) + cent(q.overhead), cent(q.costs));
  assert.equal(cent(q.profit), cent(q.subtotal) - cent(q.costs) - cent(q.processingFee));
});

test('completed job retains its quoted price while extra hours reduce profit', () => {
  const actual = calculateActual(example, { hours: 8, supplies: 15 });
  assert.equal(actual.subtotal, 225);
  assert.equal(actual.total, 225);
  assert.equal(actual.ownerCompensation, 200);
  assert.equal(actual.costs, 233);
  assert.equal(actual.profit, -8);
  assert.equal(actual.profitDifference, -53);
  assert.equal(actual.plannedProfit, 45);
  assert.equal(actual.plannedHours, 6);
  assert.equal(actual.actualHours, 8);
});

test('actual-cost input does not mutate the quote or change processing fees', () => {
  const input = { ...example, feeRate: 2.9, fixedFee: .3, taxRate: 8, discount: 5 };
  const before = structuredClone(input);
  const quoted = calculateQuote(input);
  const actual = calculateActual(input, {});
  assert.deepEqual(input, before);
  assert.equal(actual.processingFee, quoted.processingFee);
  assert.equal(actual.tax, quoted.tax);
  assert.equal(actual.profitDifference, 0);
});

test('free quote has finite totals; a full discount exposes the loss', () => {
  const q = calculateQuote({});
  assert.equal(q.total, 0);
  assert.equal(q.marginActual, 0);
  const discounted = calculateQuote({ ...example, discount: 100, fixedFee: .3 });
  assert.equal(discounted.total, 0);
  assert.equal(discounted.profit, -180.3);
});

test('rejects negative, nonfinite, string and out-of-range values', () => {
  for (const value of [-1, NaN, Infinity, '3', null]) {
    assert.throws(() => calculateQuote({ ...example, hours: value }));
  }
  for (const input of [null, [], undefined, 'input']) assert.throws(() => calculateQuote(input));
  assert.throws(() => calculateQuote({ ...example, margin: 81 }));
  assert.throws(() => calculateQuote({ ...example, discount: 101 }));
  assert.throws(() => calculateQuote({ ...example, taxRate: 101 }));
  assert.throws(() => calculateActual(example, { supplies: -1 }));
});

test('rejects combinations that cannot cover cost and excessive totals', () => {
  assert.throws(() => calculateQuote({ ...example, margin: 80, feeRate: 10, taxRate: 100 }), /no room/);
  assert.throws(() => calculateQuote({ ...example, hours: 10_000, hourlyPay: 100_000 }), /costs/);
  assert.throws(() => calculateQuote({ ...example, supplies: 900_000, margin: 80 }), /exceeds/);
});
