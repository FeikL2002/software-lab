/**
 * CleanQuote cost model. Amounts are USD; percentages use 20 for 20%.
 * `hours` is total cleaner-hours, not elapsed appointment time.
 * User-entered cost amounts and labor are rounded to cents before calculation.
 * Revenue, tax and card fees are also rounded to cents, so every displayed
 * monetary total reconciles. Tax collected is never counted as profit.
 */

const MAX_MONEY = 1_000_000;
const LIMITS = Object.freeze({
  hours: 10_000,
  hourlyPay: 100_000,
  supplies: MAX_MONEY,
  travel: MAX_MONEY,
  overhead: MAX_MONEY,
  margin: 80,
  feeRate: 50,
  fixedFee: MAX_MONEY,
  discount: 100,
  taxRate: 100,
});

function record(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
}

function number(value, name, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  if (value < 0 || value > maximum) {
    throw new RangeError(`${name} must be between 0 and ${maximum}.`);
  }
  return value;
}

function normalize(input) {
  record(input, 'Quote input');
  return Object.fromEntries(Object.entries(LIMITS).map(([name, maximum]) => [
    name,
    number(input[name] === undefined ? 0 : input[name], name, maximum),
  ]));
}

function cents(amount) {
  return Math.round((amount + Number.EPSILON) * 100);
}

function dollars(amount) {
  return amount / 100;
}

function costAmounts(input) {
  const labor = cents(input.hours * input.hourlyPay);
  const supplies = cents(input.supplies);
  const travel = cents(input.travel);
  const overhead = cents(input.overhead);
  const costs = labor + supplies + travel + overhead;
  if (costs > cents(MAX_MONEY)) {
    throw new RangeError('Total estimated costs must not exceed $1,000,000.');
  }
  return { labor, supplies, travel, overhead, costs };
}

function result(amounts, pricing, input) {
  const processingFee = Math.round(pricing.total * input.feeRate / 100) + cents(input.fixedFee);
  const profit = pricing.subtotal - amounts.costs - processingFee;
  return {
    ...Object.fromEntries(Object.entries(amounts).map(([key, value]) => [key, dollars(value)])),
    ...Object.fromEntries(Object.entries(pricing).map(([key, value]) => [key, dollars(value)])),
    processingFee: dollars(processingFee),
    profit: dollars(profit),
    marginActual: pricing.subtotal === 0 ? 0 : Math.round(profit / pricing.subtotal * 10_000) / 100,
    ownerCompensation: dollars(amounts.labor),
  };
}

/**
 * Solve the undiscounted pre-tax price for the requested business-profit margin.
 * Processing percentage applies to the full customer payment, including tax.
 * A discount then lowers revenue and profit; it does not silently raise price.
 * The model assumes the user-entered payment fee; it does not collect payments.
 */
export function calculateQuote(input) {
  const values = normalize(input);
  const amounts = costAmounts(values);
  const denominator = 1 - values.margin / 100 - values.feeRate / 100 * (1 + values.taxRate / 100);
  if (denominator <= 0) {
    throw new RangeError('Margin, processing fee and tax leave no room to cover job costs. Reduce the margin or fees.');
  }
  const rawBase = (amounts.costs + cents(values.fixedFee)) / denominator;
  if (!Number.isFinite(rawBase) || rawBase > cents(MAX_MONEY)) {
    throw new RangeError('The calculated pre-tax quote exceeds $1,000,000. Reduce costs, margin or fees.');
  }
  const basePrice = Math.round(rawBase);
  const discountAmount = Math.round(basePrice * values.discount / 100);
  const subtotal = basePrice - discountAmount;
  const tax = Math.round(subtotal * values.taxRate / 100);
  return result(amounts, { basePrice, discountAmount, subtotal, tax, total: subtotal + tax }, values);
}

/**
 * Compare a completed job with its quote, retaining the agreed revenue, tax,
 * discount and payment fee. Missing actual cost fields retain quoted values.
 * Actual hours are paid at the same hourly owner-pay target as the quote.
 */
export function calculateActual(quoteInput, actual) {
  const values = normalize(quoteInput);
  record(actual, 'Actual job costs');
  const quoted = calculateQuote(values);
  const actualValues = { ...values };
  for (const key of ['hours', 'supplies', 'travel', 'overhead']) {
    if (actual[key] !== undefined) actualValues[key] = number(actual[key], key, LIMITS[key]);
  }
  const amounts = costAmounts(actualValues);
  const pricing = Object.fromEntries(
    ['basePrice', 'discountAmount', 'subtotal', 'tax', 'total'].map(key => [key, cents(quoted[key])]),
  );
  const calculated = result(amounts, pricing, values);
  return {
    ...calculated,
    plannedHours: values.hours,
    actualHours: actualValues.hours,
    plannedProfit: quoted.profit,
    profitDifference: dollars(cents(calculated.profit) - cents(quoted.profit)),
  };
}
