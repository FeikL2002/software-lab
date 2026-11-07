import test from 'node:test';
import assert from 'node:assert/strict';
import { drawResultsQuery, officialDrawPath, normalizeOfficialDraw, fetchDrawResults, createDrawResultsHandler } from '../server/draw-results.mjs';

const query = (game = 'Powerball', date = '2026-10-26', session) => drawResultsQuery(new URL(`https://example.test/api/draw-results?${new URLSearchParams({ game, date, ...(session ? { session } : {}) })}`));
const balls = values => values.map((value, index) => ({ position: index + 1, value }));
const row = (values, overrides = {}) => ({ drawDate: '2026-10-26T00:00:00', approved: true, modifier: 0, numbers: balls(values), ...overrides });
const envelope = (...draws) => ({ draws, errorMessage: null });
const checkedAt = '2026-10-28T12:00:00.000Z';

test('only a public game, exact calendar date and required Pick session are accepted', () => {
  assert.equal(query('Mega Millions').gameKey, 'megamillions');
  assert.equal(query('RollingCashFive').game, 'Rolling Cash 5');
  assert.equal(query('Pick 3', '2026-10-27', 'midday').session, 'midday');
  for (const suffix of [
    '?game=Powerball&date=2026-02-29',
    '?game=Pick3&date=2026-10-27',
    '?game=Powerball&date=2026-10-27&numbers=1,2,3',
    '?game=Powerball&date=2026-10-27&date=2026-10-28',
    '?game=../../private&date=2026-10-27',
    '?game=Powerball&date=2026-10-27&session=midday',
  ]) assert.throws(() => drawResultsQuery(new URL(`https://example.test/api/draw-results${suffix}`)));
  assert.equal(officialDrawPath(query()), '/1.0/Games/DrawGames/PowerBall/SearchDrawDateRange?sinceDate=10-26-2026&toDate=10-26-2026');
});

test('Powerball uses published positions, separating Powerball and Power Play', () => {
  const shuffled = balls([18, 26, 49, 50, 54, 1, 3]).reverse();
  const result = normalizeOfficialDraw(envelope(row([], { numbers: shuffled })), query(), checkedAt);
  assert.deepEqual(result.numbers, [18, 26, 49, 50, 54]);
  assert.equal(result.bonus, 1);
  assert.equal(result.multiplier, 3);
  assert.equal(result.official, true);
  assert.equal(result.retrievedAt, checkedAt);
  assert.equal(result.drawDate, '2026-10-26');
  assert.match(result.sourceURL, /^https:\/\/www\.ohiolottery\.com\//);
  assert.equal(JSON.stringify(result).includes('approvedBy'), false);
});

test('the exact Pick date and midday/evening modifier prevent wrong-session comparisons', () => {
  const data = envelope(
    row([6, 4, 6], { drawDate: '2026-10-27T00:00:00', modifier: 2 }),
    row([0, 6, 6], { drawDate: '2026-10-27T00:00:00', modifier: 1 }),
    row([1, 2, 3], { drawDate: '2026-10-26T00:00:00', modifier: 1 }),
  );
  const result = normalizeOfficialDraw(data, query('Pick3', '2026-10-27', 'midday'), checkedAt);
  assert.deepEqual(result.numbers, [0, 6, 6]);
  assert.equal(result.session, 'midday');
  assert.equal(normalizeOfficialDraw(data, query('Pick3', '2026-10-28', 'evening'), checkedAt), null);
});

test('Mega Millions rules follow draw date and never invent a post-April-2025 drawn multiplier', () => {
  const oldQuery = query('Mega Millions', '2025-04-04');
  const old = normalizeOfficialDraw(envelope(row([11, 28, 35, 37, 69, 25, 2], { drawDate: '2025-04-04T00:00:00' })), oldQuery, checkedAt);
  assert.equal(old.bonus, 25);
  assert.equal(old.multiplier, 2);
  assert.equal(old.ruleVersion, 'mega-millions-2017');
  const modernQuery = query('Mega Millions', '2025-04-08');
  const modern = normalizeOfficialDraw(envelope(row([10, 16, 50, 60, 61, 17, -1], { drawDate: '2025-04-08T00:00:00' })), modernQuery, checkedAt);
  assert.equal(modern.multiplier, null);
  assert.equal(modern.ruleVersion, 'mega-millions-2025');
  assert.throws(() => normalizeOfficialDraw(envelope(row([10, 16, 50, 60, 61, 25, -1], { drawDate: '2025-04-08T00:00:00' })), modernQuery, checkedAt));
  assert.throws(() => normalizeOfficialDraw(envelope(row([10, 16, 50, 60, 61, 17, 3], { drawDate: '2025-04-08T00:00:00' })), modernQuery, checkedAt));
});

test('Classic Lotto preserves Kicker as ordered digits, including leading zeroes', () => {
  const result = normalizeOfficialDraw(envelope(row([12, 23, 34, 39, 42, 43], { extendedNumbers: balls([0, 5, 9, 2, 3, 5]) })), query('Classic Lotto'), checkedAt);
  assert.deepEqual(result.kicker, [0, 5, 9, 2, 3, 5]);
  assert.equal(result.bonus, null);
});

test('non-jackpot amounts come only from unambiguous exact-draw published tiers', () => {
  const result = normalizeOfficialDraw(envelope(row([6, 9, 13, 21, 23], { prizes: [
    { description: 'Match 5 of 5', payout: 120000 },
    { description: 'Match 4 of 5', payout: 300 },
    { description: 'Match 3 of 5', payout: 10 },
    { description: 'Match 2 of 5', payout: 1 },
    { description: '<script>other</script>', payout: 999 },
    { description: 'Match 1 of 5', payout: 7 },
  ] })), query('Rolling Cash 5'), checkedAt);
  assert.deepEqual(result.prizes.map(prize => [prize.matchCount, prize.potentialCents]), [[4, 30000], [3, 1000], [2, 100]]);
  assert.ok(result.prizes.every(prize => prize.sourceURL === result.sourceDataURL));
  assert.equal(result.prizes.some(prize => prize.matchCount === 5), false);
  const ambiguous = normalizeOfficialDraw(envelope(row([6, 9, 13, 21, 23], { prizes: [
    { description: 'Match 4 of 5', payout: 300 }, { description: 'Match 4 of 5', payout: 900 },
  ] })), query('Rolling Cash 5'), checkedAt);
  assert.deepEqual(ambiguous.prizes, []);
});

test('unapproved, duplicate, missing-position and out-of-range feeds cannot become results', () => {
  assert.equal(normalizeOfficialDraw(envelope(row([18, 26, 49, 50, 54, 1, 3], { approved: false })), query(), checkedAt), null);
  assert.throws(() => normalizeOfficialDraw(envelope(row([18, 26, 49, 50, 54, 1, 3]), row([18, 26, 49, 50, 54, 1, 3])), query(), checkedAt));
  for (const values of [[18, 18, 49, 50, 54, 1, 3], [18, 26, 49, 50, 70, 1, 3], [18, 26, 49, 50, 54, 27, 3], [18, 26, 49, 50, 54]]) assert.throws(() => normalizeOfficialDraw(envelope(row(values)), query(), checkedAt));
  assert.throws(() => normalizeOfficialDraw({ draws: [], errorMessage: 'upstream problem' }, query(), checkedAt));
});

test('unsupported historical rules and ended Lucky for Life are explicit and do not fetch', async () => {
  const load = () => { throw new Error('Must not fetch.'); };
  const now = () => new Date(checkedAt);
  const ended = await fetchDrawResults(query('Lucky for Life', '2026-02-22'), { load, now });
  assert.equal(ended.status, 'game-ended');
  assert.equal(ended.result, null);
  const earlier = await fetchDrawResults(query('Powerball', '2015-10-03'), { load, now });
  assert.equal(earlier.status, 'unsupported-date');
  const missing = await fetchDrawResults(query(), { load: async () => envelope(), now });
  assert.equal(missing.status, 'not-published');
  assert.deepEqual(missing.records, []);
});

test('handler coalesces same public draw requests and never serves a stale result on failure', async () => {
  let time = Date.parse(checkedAt), calls = 0, fail = false;
  const fixtureResult = normalizeOfficialDraw(envelope(row([18, 26, 49, 50, 54, 1, 3])), query(), checkedAt);
  const handler = createDrawResultsHandler({ now: () => time, loader: async () => { calls++; if (fail) throw new Error('secret upstream detail'); return { status: 'fresh', checkedAt, stale: false, records: [fixtureResult], result: fixtureResult }; } });
  const request = () => new Request('https://example.test/api/draw-results?game=Powerball&date=2026-10-26');
  const [one, two] = await Promise.all([handler(request()), handler(request())]);
  assert.equal(one.status, 200); assert.equal(two.status, 200); assert.equal(calls, 1);
  assert.match(one.headers.get('netlify-cdn-cache-control'), /max-age=120/);
  time += 300_001; fail = true;
  const unavailable = await handler(request());
  assert.equal(unavailable.status, 503);
  const payload = await unavailable.json();
  assert.equal(payload.result, null); assert.deepEqual(payload.records, []); assert.equal(payload.stale, true);
  assert.equal(JSON.stringify(payload).includes('secret'), false);
  assert.equal(unavailable.headers.get('cache-control'), 'no-store');
  assert.equal((await handler(new Request(request().url, { method: 'POST' }))).status, 405);
  assert.equal((await handler(new Request(`${request().url}&barcode=private`))).status, 400);
});
