/**
 * Snail Grove is a local, pretend-credit demonstration.
 * These transparent odds describe the simulation; credits have no cash value.
 */
export const PAYTABLE = Object.freeze([
  Object.freeze({ multiplier: 0, probability: 0.55, symbol: 'berry' }),
  Object.freeze({ multiplier: 1, probability: 0.25, symbol: 'mushroom' }),
  Object.freeze({ multiplier: 2, probability: 0.12, symbol: 'leaf' }),
  Object.freeze({ multiplier: 5, probability: 0.06, symbol: 'moon' }),
  Object.freeze({ multiplier: 10, probability: 0.02, symbol: 'snail' }),
]);

const SYMBOLS = PAYTABLE.map(({ symbol }) => symbol);
const SUPPORTED_MULTIPLIERS = new Set(PAYTABLE.map(({ multiplier }) => multiplier));
// Explicit boundaries keep exact values such as 0.98 in the intended band.
const OUTCOME_BANDS = [0.55, 0.8, 0.92, 0.98, 1];

function validateRandomFloat(value) {
  if (!Number.isFinite(value) || value < 0 || value >= 1) {
    throw new RangeError('The random value must be a finite number from 0 (inclusive) to 1 (exclusive).');
  }
  return value;
}

function validateMultiplier(multiplier) {
  if (!SUPPORTED_MULTIPLIERS.has(multiplier)) {
    throw new RangeError('The multiplier must be one of 0, 1, 2, 5, or 10.');
  }
}

function toCents(value, name) {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a finite, nonnegative number.`);
  }
  const scaled = value * 100;
  const cents = Math.round(scaled);
  // Accept floating-point representations of cents, but not fractional cents.
  if (!Number.isSafeInteger(cents) || Math.abs(scaled - cents) > 1e-7) {
    throw new RangeError(`${name} must have at most two decimal places and fit within safe integer cents.`);
  }
  return cents;
}

/** Choose a multiplier using a supplied number in [0, 1). */
export function pickOutcome(randomFloat) {
  const value = validateRandomFloat(randomFloat);
  const index = OUTCOME_BANDS.findIndex((boundary) => value < boundary);
  return PAYTABLE[index].multiplier;
}

/** Settle one pretend-credit round, using integer cents throughout. */
export function resolveRound({ balance, stake, multiplier } = {}) {
  const balanceCents = toCents(balance, 'Balance');
  const stakeCents = toCents(stake, 'Stake');
  validateMultiplier(multiplier);
  if (stakeCents < 1) {
    throw new RangeError('Stake must be at least 0.01 pretend credits.');
  }
  if (stakeCents > balanceCents) {
    throw new RangeError('Stake cannot exceed the pretend-credit balance.');
  }
  const returnedCents = stakeCents * multiplier;
  const nextBalanceCents = balanceCents - stakeCents + returnedCents;
  if (!Number.isSafeInteger(returnedCents) || !Number.isSafeInteger(nextBalanceCents)) {
    throw new RangeError('The result exceeds safe integer cents.');
  }
  return {
    balance: nextBalanceCents / 100,
    stake: stakeCents / 100,
    returned: returnedCents / 100,
    profit: (returnedCents - stakeCents) / 100,
  };
}

/**
 * Return three columns of three symbols each.
 * Only the middle row is a payline: reels[column][1].
 * Visual symbols illustrate an already selected result and do not decide it.
 */
export function makeReels(multiplier, randomFloat = Math.random) {
  validateMultiplier(multiplier);
  if (typeof randomFloat !== 'function') {
    throw new TypeError('The reel random source must be a function.');
  }
  const sampleSymbol = () => SYMBOLS[Math.floor(validateRandomFloat(randomFloat()) * SYMBOLS.length)];
  const reels = Array.from({ length: 3 }, () => Array.from({ length: 3 }, sampleSymbol));
  if (multiplier > 0) {
    const winningSymbol = PAYTABLE.find((entry) => entry.multiplier === multiplier).symbol;
    for (const column of reels) column[1] = winningSymbol;
  } else if (reels[0][1] === reels[1][1] && reels[1][1] === reels[2][1]) {
    const firstIndex = SYMBOLS.indexOf(reels[0][1]);
    reels[2][1] = SYMBOLS[(firstIndex + 1) % SYMBOLS.length];
  }
  return reels;
}
