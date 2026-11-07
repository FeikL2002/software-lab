import { ohioData } from './ohio-api.mjs';

// These are the public, date-based feeds used by Ohio Lottery's own archive.
// Only game, draw date and session reach this adapter. Ticket numbers, barcodes,
// photos, wagers and identifying details are never needed by this endpoint.
const OFFICIAL_ORIGIN = 'https://www.ohiolottery.com';
const API_ORIGIN = 'https://api-solutions.ohiolottery.com';
const ARCHIVE_URL = `${OFFICIAL_ORIGIN}/winning-numbers/winning-numbers-archive`;
const MAX_CACHE_ENTRIES = 128;
const FIVE_MINUTES = 300_000;
const THIRTY_SECONDS = 30_000;
const GAMES = Object.freeze({
  powerball: { name: 'Powerball', api: 'PowerBall', count: 5, max: 69, bonus: 26, since: '2015-10-07', rules: 'powerball-2015', page: 'powerball' },
  megamillions: { name: 'Mega Millions', api: 'MegaMillions', count: 5, max: 70, bonus: 24, since: '2017-10-31', rules: 'mega-millions-2025', page: 'mega-millions' },
  classiclotto: { name: 'Classic Lotto', api: 'ClassicLotto', count: 6, max: 49, since: '2007-01-22', rules: 'classic-lotto', page: 'classic-lotto' },
  rollingcash5: { name: 'Rolling Cash 5', api: 'RollingCashFive', count: 5, max: 39, since: '2004-10-04', rules: 'rolling-cash-5', page: 'rolling-cash-5' },
  pick3: { name: 'Pick 3', api: 'Pick3', count: 3, max: 9, digit: true, since: '2000-01-01', rules: 'ohio-pick-3', page: 'pick-3' },
  pick4: { name: 'Pick 4', api: 'Pick4', count: 4, max: 9, digit: true, since: '2000-01-01', rules: 'ohio-pick-4', page: 'pick-4' },
  pick5: { name: 'Pick 5', api: 'Pick5', count: 5, max: 9, digit: true, since: '2012-08-12', rules: 'ohio-pick-5', page: 'pick-5' },
  luckyforlife: { name: 'Lucky for Life', api: 'LuckyForLife', count: 5, max: 48, bonus: 18, since: '2015-11-16', until: '2026-02-21', rules: 'lucky-for-life', page: 'lucky-for-life' },
  millionaireforlife: { name: 'Millionaire for Life', api: 'MillionaireForLife', count: 5, max: 58, bonus: 5, since: '2026-02-22', rules: 'millionaire-for-life-2026', page: 'millionaire-for-life' },
});
const ALIASES = Object.freeze({ pball: 'powerball', megamil: 'megamillions', rollingcashfive: 'rollingcash5', rolling5: 'rollingcash5', luckylife: 'luckyforlife', millionairelife: 'millionaireforlife' });
const own = (value, lower, upper) => value?.[lower] ?? value?.[upper];

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function drawResultsQuery(url) {
  for (const key of url.searchParams.keys()) {
    if (!['game', 'date', 'session'].includes(key) || url.searchParams.getAll(key).length !== 1) throw new Error('Use only a game, one draw date and an optional draw session.');
  }
  const raw = url.searchParams.get('game') || '';
  const compact = raw.toLowerCase().replace(/[\s_-]/g, '');
  const key = ALIASES[compact] || compact;
  if (!raw || raw.length > 40 || !Object.hasOwn(GAMES, key)) throw new Error('Choose a supported Ohio draw game.');
  const date = url.searchParams.get('date');
  if (!validDate(date) || date < '2000-01-01' || date > '2100-12-31') throw new Error('Use one valid draw date in YYYY-MM-DD format.');
  const definition = GAMES[key];
  const requestedSession = url.searchParams.get('session');
  let session = null;
  if (definition.digit) {
    if (!['midday', 'evening'].includes(requestedSession)) throw new Error('Choose midday or evening for a Pick game.');
    session = requestedSession;
  } else if (requestedSession !== null && requestedSession !== '' && requestedSession !== 'evening') {
    throw new Error('This game has one drawing per draw date.');
  }
  return { game: definition.name, gameKey: key, date, session };
}

function definitionFor(query) {
  const definition = GAMES[query.gameKey];
  if (!definition || definition.name !== query.game || !validDate(query.date) || (definition.digit && !['midday', 'evening'].includes(query.session))) throw new Error('Invalid draw request.');
  return definition;
}

function apiDate(iso) {
  return `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;
}

export function officialDrawPath(query) {
  const definition = definitionFor(query);
  const date = apiDate(query.date);
  return `/1.0/Games/DrawGames/${definition.api}/SearchDrawDateRange?sinceDate=${date}&toDate=${date}`;
}

function positionedNumbers(raw) {
  if (!Array.isArray(raw) || raw.length > 10) throw new Error('Invalid official draw numbers.');
  const numbers = raw.map(item => ({ position: own(item, 'position', 'Position'), value: own(item, 'value', 'Value') }));
  if (numbers.some(item => !Number.isSafeInteger(item.position) || !Number.isSafeInteger(item.value)) || new Set(numbers.map(item => item.position)).size !== numbers.length) throw new Error('Invalid official draw positions.');
  return numbers.sort((a, b) => a.position - b.position);
}

function exactPositions(raw, count, min, max) {
  if (raw.length !== count || raw.some((item, index) => item.position !== index + 1 || item.value < min || item.value > max)) throw new Error('Incomplete official draw.');
  return raw.map(item => item.value);
}

/** Accept only one approved draw with the exact date and Pick session requested. */
export function normalizeOfficialDraw(data, query, checkedAt = new Date().toISOString()) {
  const definition = definitionFor(query);
  if (query.date < definition.since || (definition.until && query.date > definition.until)) throw new Error('Unsupported draw date.');
  const rows = own(data, 'draws', 'Draws');
  if (!Array.isArray(rows) || rows.length > 10 || (own(data, 'errorMessage', 'ErrorMessage') ?? '') !== '') throw new Error('The official draw feed has changed.');
  if (!Number.isFinite(Date.parse(checkedAt))) throw new Error('Invalid check time.');
  const matches = rows.filter(row => {
    const date = own(row, 'drawDate', 'DrawDate');
    const modifier = own(row, 'modifier', 'Modifier');
    return typeof date === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(date) && date.slice(0, 10) === query.date && (!definition.digit || modifier === (query.session === 'midday' ? 1 : 2));
  });
  if (matches.length > 1) throw new Error('The official draw feed is ambiguous.');
  if (!matches.length || own(matches[0], 'approved', 'Approved') !== true) return null;
  const row = matches[0];
  const positioned = positionedNumbers(own(row, 'numbers', 'Numbers'));
  const expectedLength = definition.count + (definition.bonus ? 1 : 0);
  const supportsMultiplier = query.gameKey === 'powerball' || query.gameKey === 'megamillions';
  if (positioned.length !== expectedLength && !(supportsMultiplier && positioned.length === expectedLength + 1)) throw new Error('Incomplete official draw.');
  const main = exactPositions(positioned.slice(0, definition.count), definition.count, definition.digit ? 0 : 1, definition.max);
  if (!definition.digit && new Set(main).size !== main.length) throw new Error('Invalid official draw values.');
  let bonus = null;
  let ruleVersion = definition.rules;
  let bonusMax = definition.bonus;
  if (query.gameKey === 'megamillions' && query.date < '2025-04-08') {
    bonusMax = 25;
    ruleVersion = 'mega-millions-2017';
  }
  if (definition.bonus) {
    const item = positioned[definition.count];
    if (item.position !== definition.count + 1 || item.value < 1 || item.value > bonusMax) throw new Error('Invalid official bonus ball.');
    bonus = item.value;
  }
  let multiplier = null;
  if (supportsMultiplier && positioned.length === expectedLength + 1) {
    const item = positioned[expectedLength];
    if (item.position !== expectedLength + 1) throw new Error('Invalid official multiplier position.');
    if (query.gameKey === 'megamillions' && query.date >= '2025-04-08') {
      // Since April 8, 2025 each Mega Millions play has its own printed
      // multiplier. A draw-wide value would be unsafe to apply to a ticket.
      if (![-1, 0].includes(item.value)) throw new Error('Unexpected Mega Millions draw multiplier.');
    } else {
      const allowed = query.gameKey === 'powerball' ? [2, 3, 4, 5, 10] : [2, 3, 4, 5];
      if (!allowed.includes(item.value)) throw new Error('Invalid official multiplier.');
      multiplier = item.value;
    }
  }
  let kicker = null;
  if (query.gameKey === 'classiclotto') {
    const extended = own(row, 'extendedNumbers', 'ExtendedNumbers');
    if (Array.isArray(extended) && extended.length) kicker = exactPositions(positionedNumbers(extended), 6, 0, 9);
  }
  const sourceDataURL = `${API_ORIGIN}${officialDrawPath(query)}`;
  const prizes = [];
  // These two games publish unambiguous main-number tiers on each approved
  // draw. Keep amounts tied to that draw; never import stale generic game JSON
  // or mistake a jackpot pool, Pick stake basis, or lifetime annuity for cash.
  if (['classiclotto', 'rollingcash5'].includes(query.gameKey)) {
    const publishedPrizes = own(row, 'prizes', 'Prizes');
    if (Array.isArray(publishedPrizes) && publishedPrizes.length <= 40) {
      const seenTiers = new Set();
      for (const prize of publishedPrizes) {
        const description = own(prize, 'description', 'Description');
        const match = typeof description === 'string' && description.match(/^Match (\d) of (\d)$/i);
        const payout = own(prize, 'payout', 'Payout');
        const cents = Math.round(payout * 100);
        if (!match || Number(match[2]) !== definition.count || Number(match[1]) >= definition.count || Number(match[1]) < 2 || typeof payout !== 'number' || !Number.isFinite(payout) || !Number.isSafeInteger(cents) || cents <= 0 || cents > 100_000_000 || Math.abs(payout * 100 - cents) > 0.00001) continue;
        if (seenTiers.has(Number(match[1]))) {
          const previous = prizes.findIndex(existing => existing.matchCount === Number(match[1]));
          if (previous >= 0) prizes.splice(previous, 1);
          continue;
        }
        seenTiers.add(Number(match[1]));
        prizes.push({ matchCount: Number(match[1]), bonusMatch: false, potentialCents: cents, sourceURL: sourceDataURL });
      }
    }
  }
  return {
    game: definition.name, gameKey: query.gameKey, drawDate: query.date,
    session: definition.digit ? query.session : null,
    numbers: main, bonus, multiplier, kicker, ruleVersion, prizes,
    source: 'Ohio Lottery', sourceURL: ARCHIVE_URL,
    sourceDataURL,
    rulesURL: `${OFFICIAL_ORIGIN}/games/draw-games/${definition.page}`,
    retrievedAt: checkedAt, checkedAt, official: true, approved: true,
  };
}

export async function fetchDrawResults(query, { load = ohioData, now = () => new Date() } = {}) {
  const definition = definitionFor(query);
  const checkedAt = now().toISOString();
  const envelope = { game: query.game, gameKey: query.gameKey, drawDate: query.date, session: query.session, source: 'Ohio Lottery', sourceURL: ARCHIVE_URL, checkedAt, stale: false, records: [], result: null };
  if (query.date < definition.since) return { ...envelope, status: 'unsupported-date', message: 'This draw predates the supported game rules. Check the official Ohio archive.' };
  if (definition.until && query.date > definition.until) return { ...envelope, status: 'game-ended', message: 'Lucky for Life ended after the February 21, 2026 drawing. Check the printed game and draw date.' };
  const result = normalizeOfficialDraw(await load(officialDrawPath(query)), query, checkedAt);
  return result ? { ...envelope, status: 'fresh', records: [result], result } : { ...envelope, status: 'not-published', message: 'No approved result for this exact draw is published in the Ohio feed yet. Keep the ticket and check again.' };
}

export function createDrawResultsHandler({ loader = fetchDrawResults, now = () => Date.now() } = {}) {
  const cache = new Map();
  const pending = new Map();
  const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store', 'Netlify-Vary': 'query=game|date|session', ...(status === 200 ? { 'Netlify-CDN-Cache-Control': `public, durable, max-age=${data.status === 'fresh' ? 120 : 30}` } : {}), ...headers } });
  return async function drawResultsHandler(request) {
    if (request.method !== 'GET') return json({ status: 'invalid-request', error: 'Use GET for public draw results.' }, 405, { Allow: 'GET' });
    let query;
    try { query = drawResultsQuery(new URL(request.url)); } catch (error) { return json({ status: 'invalid-request', error: error.message }, 400); }
    const key = `${query.gameKey}/${query.date}/${query.session || 'single'}`;
    let cached = cache.get(key);
    if (cached && now() - cached.savedAt < cached.ttl) return json(cached.data);
    try {
      if (!pending.has(key)) {
        if (pending.size >= MAX_CACHE_ENTRIES) throw new Error('Too many in-flight public requests.');
        const task = Promise.resolve().then(() => loader(query)).then(data => {
          if (!['fresh', 'not-published', 'game-ended', 'unsupported-date'].includes(data?.status) || !Array.isArray(data.records)) throw new Error('Invalid draw result.');
          cache.delete(key);
          cache.set(key, { data, savedAt: now(), ttl: data.status === 'fresh' ? FIVE_MINUTES : THIRTY_SECONDS });
          while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value);
          return data;
        }).finally(() => pending.delete(key));
        pending.set(key, task);
      }
      return json(await pending.get(key));
    } catch {
      // Never use stale or partial results to label a ticket a winner/loser.
      return json({ status: 'unavailable', stale: true, records: [], result: null, source: 'Ohio Lottery', sourceURL: ARCHIVE_URL, checkedAt: new Date(now()).toISOString(), error: 'Ohio Lottery results could not be checked. Keep the ticket and try again.' }, 503, { 'Retry-After': '60' });
    }
  };
}

export const drawResultsHandler = createDrawResultsHandler();
