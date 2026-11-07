/** Harbor demo accounting. All stored money is integer cents; percentages are basis points. */
export const MAX_CENTS = 100_000_000;
export const EXAMPLE_PROVIDER_RATE = Object.freeze({ percentBps: 290, fixedCents: 30 });
export const DEFAULT_FEES = Object.freeze({
  payment: Object.freeze({ percentBps: 100, fixedCents: 0 }),
  withdrawal: Object.freeze({ percentBps: 50, fixedCents: 25 }),
});

export function assertCents(value, { allowZero = true, label = 'Amount' } = {}) {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1) || value > MAX_CENTS) {
    throw new RangeError(`${label} must be ${allowZero ? 'a nonnegative' : 'a positive'} whole number of cents, up to $1,000,000.`);
  }
  return value;
}

/** Parse dollars from text without floating-point multiplication or hidden rounding. */
export function parseDollars(value, { allowZero = false } = {}) {
  if (typeof value !== 'string') throw new TypeError('Enter an amount in dollars.');
  const text = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(text)) {
    throw new RangeError('Enter dollars with no more than two decimal places, such as 25.50.');
  }
  const [whole, fraction = ''] = text.split('.');
  const centsBig = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (centsBig > BigInt(MAX_CENTS)) throw new RangeError('The demo amount limit is $1,000,000.');
  return assertCents(Number(centsBig), { allowZero });
}

export function parsePercent(value, { maxBps = 10_000 } = {}) {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value.trim())) {
    throw new RangeError('Enter a percentage with no more than two decimal places.');
  }
  const [whole, fraction = ''] = value.trim().split('.');
  const bpsBig = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (bpsBig > BigInt(maxBps)) throw new RangeError(`Enter a percentage between 0 and ${maxBps / 100}.`);
  return Number(bpsBig);
}

export function validateRate(rate, { maxBps = 10_000 } = {}) {
  if (!rate || !Number.isSafeInteger(rate.percentBps) || rate.percentBps < 0 || rate.percentBps > maxBps) {
    throw new RangeError('Fee percentage is outside the supported range.');
  }
  assertCents(rate.fixedCents, { label: 'Fixed fee' });
  return { percentBps: rate.percentBps, fixedCents: rate.fixedCents };
}

/** Half-up rounding once per percentage component, then add the fixed fee. */
export function calculateFee(amountCents, rate) {
  assertCents(amountCents);
  const validated = validateRate(rate);
  const rounded = (BigInt(amountCents) * BigInt(validated.percentBps) + 5_000n) / 10_000n;
  const total = rounded + BigInt(validated.fixedCents);
  if (total > BigInt(MAX_CENTS)) throw new RangeError('Calculated fee exceeds the demo limit.');
  return Number(total);
}

export function quotePayment(grossCents, rate, providerRate = EXAMPLE_PROVIDER_RATE) {
  assertCents(grossCents, { allowZero: false, label: 'Customer payment' });
  const platformFeeCents = calculateFee(grossCents, rate);
  const providerEstimateCents = calculateFee(grossCents, providerRate);
  if (platformFeeCents + providerEstimateCents >= grossCents) {
    throw new RangeError('This payment is too small for the example fees. Increase the amount or lower the platform fee.');
  }
  return { grossCents, platformFeeCents, providerEstimateCents, netCents: grossCents - platformFeeCents - providerEstimateCents };
}

export function quoteWithdrawal(debitCents, rate, availableCents) {
  assertCents(debitCents, { allowZero: false, label: 'Withdrawal' });
  assertCents(availableCents, { label: 'Available balance' });
  if (debitCents > availableCents) throw new RangeError('This amount is greater than your available demo balance.');
  const platformFeeCents = calculateFee(debitCents, rate);
  if (platformFeeCents >= debitCents) throw new RangeError('The withdrawal must be greater than its example fee.');
  return { debitCents, platformFeeCents, bankReceivesCents: debitCents - platformFeeCents };
}

/** Pending transaction funds never enter the withdrawable balance. */
export function summarizeLedger(transactions, payouts) {
  let grossCents = 0, availableCents = 0, pendingCents = 0, paymentFeeCents = 0;
  let providerEstimateCents = 0, withdrawalFeeCents = 0, paidOutCents = 0;
  for (const transaction of transactions) {
    const { grossCents: gross, platformFeeCents: fee, providerEstimateCents: provider, netCents: net, status } = transaction;
    [gross, fee, provider, net].forEach(value => assertCents(value));
    if (gross !== fee + provider + net || gross === 0 || net === 0) throw new RangeError('Transaction accounting does not balance.');
    if (!['paid', 'pending'].includes(status)) throw new RangeError('Unsupported transaction status.');
    grossCents += gross;
    if (status === 'paid') {
      availableCents += net;
      paymentFeeCents += fee;
      providerEstimateCents += provider;
    } else pendingCents += net;
  }
  for (const payout of payouts) {
    const { debitCents, platformFeeCents, bankReceivesCents } = payout;
    [debitCents, platformFeeCents, bankReceivesCents].forEach(value => assertCents(value));
    if (debitCents !== platformFeeCents + bankReceivesCents || bankReceivesCents === 0) throw new RangeError('Payout accounting does not balance.');
    availableCents -= debitCents;
    withdrawalFeeCents += platformFeeCents;
    paidOutCents += bankReceivesCents;
  }
  if (availableCents < 0) throw new RangeError('Payouts exceed settled funds.');
  const totals = { grossCents, availableCents, pendingCents, paymentFeeCents, providerEstimateCents, withdrawalFeeCents, paidOutCents,
    platformRevenueCents: paymentFeeCents + withdrawalFeeCents };
  Object.values(totals).forEach(value => assertCents(value));
  return totals;
}
