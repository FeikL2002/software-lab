import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDollars, parsePercent, calculateFee, quotePayment, quoteWithdrawal, summarizeLedger, DEFAULT_FEES } from '../public/money.mjs';

test('dollar and percentage parsing is exact and rejects unsafe or ambiguous input', () => {
  assert.equal(parseDollars(' 25.5 '), 2550);
  assert.equal(parseDollars('0.01'), 1);
  assert.equal(parseDollars('1000000'), 100000000);
  assert.equal(parseDollars('0', { allowZero: true }), 0);
  assert.equal(parsePercent('1.25'), 125);
  for (const input of ['0', '-1', '1.001', '1e3', 'Infinity', 'NaN', '', '$25', '1,000', '01', '1000000.01']) {
    assert.throws(() => parseDollars(input), undefined, input);
  }
  assert.throws(() => parseDollars(25));
  assert.throws(() => parsePercent('20.01', { maxBps: 2000 }));
});

test('fees round half up in integer cents and payment components reconcile', () => {
  assert.equal(calculateFee(50, { percentBps: 100, fixedCents: 0 }), 1);
  assert.equal(calculateFee(49, { percentBps: 100, fixedCents: 0 }), 0);
  const quote = quotePayment(10000, DEFAULT_FEES.payment);
  assert.deepEqual(quote, { grossCents: 10000, platformFeeCents: 100, providerEstimateCents: 320, netCents: 9580 });
  assert.equal(quote.netCents + quote.platformFeeCents + quote.providerEstimateCents, quote.grossCents);
});

test('withdrawal amount is the balance debit, with the fee deducted from bank receipt', () => {
  assert.deepEqual(quoteWithdrawal(50000, DEFAULT_FEES.withdrawal, 70000), { debitCents: 50000, platformFeeCents: 275, bankReceivesCents: 49725 });
  assert.throws(() => quoteWithdrawal(70001, DEFAULT_FEES.withdrawal, 70000), /greater than/);
  assert.throws(() => quoteWithdrawal(0, DEFAULT_FEES.withdrawal, 70000));
  assert.throws(() => quoteWithdrawal(-1, DEFAULT_FEES.withdrawal, 70000));
  assert.throws(() => quoteWithdrawal(20, DEFAULT_FEES.withdrawal, 70000), /greater than its/);
});

test('pending funds cannot be withdrawn and platform revenue excludes pending fees', () => {
  const paid = { ...quotePayment(10000, DEFAULT_FEES.payment), status: 'paid' };
  const pending = { ...quotePayment(20000, DEFAULT_FEES.payment), status: 'pending' };
  const before = summarizeLedger([paid, pending], []);
  assert.equal(before.availableCents, 9580);
  assert.equal(before.pendingCents, pending.netCents);
  assert.equal(before.platformRevenueCents, 100);
  assert.throws(() => quoteWithdrawal(10000, DEFAULT_FEES.withdrawal, before.availableCents), /greater than/);
  const payout = quoteWithdrawal(5000, DEFAULT_FEES.withdrawal, before.availableCents);
  const after = summarizeLedger([paid, pending], [payout]);
  assert.equal(after.availableCents, 4580);
  assert.equal(after.platformRevenueCents, 150);
  assert.equal(after.paidOutCents, 4950);
  assert.equal(after.pendingCents, before.pendingCents);
});

test('invalid rates, insufficient economic amounts and corrupted ledgers are rejected', () => {
  for (const rate of [{ percentBps: -1, fixedCents: 0 }, { percentBps: 10001, fixedCents: 0 }, { percentBps: 1.5, fixedCents: 0 }, { percentBps: 100, fixedCents: -1 }]) {
    assert.throws(() => calculateFee(10000, rate));
  }
  assert.throws(() => quotePayment(1, DEFAULT_FEES.payment), /too small/);
  assert.throws(() => quotePayment(NaN, DEFAULT_FEES.payment));
  assert.throws(() => summarizeLedger([{ grossCents: 100, platformFeeCents: 10, providerEstimateCents: 10, netCents: 90, status: 'paid' }], []), /does not balance/);
  assert.throws(() => summarizeLedger([{ ...quotePayment(10000, DEFAULT_FEES.payment), status: 'paid' }], [{ debitCents: 10000, platformFeeCents: 50, bankReceivesCents: 9950 }]), /exceed/);
});
