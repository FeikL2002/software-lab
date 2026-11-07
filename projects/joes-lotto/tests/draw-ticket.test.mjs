import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const context = vm.createContext({ window: {}, URL, Date });
vm.runInContext(await readFile(new URL('../dist/draw-ticket.js', import.meta.url), 'utf8'), context);
const api = context.window.JoeDrawTicket;
const plain = value => JSON.parse(JSON.stringify(value));
const parse = text => plain(api.parse(text));
const compare = (ticket, result) => plain(api.compare(ticket, result));
const sourceURL = 'https://www.ohiolottery.com/winning-numbers/winning-numbers-archive';
const result = (game = 'Powerball', extra = {}) => ({ game, drawDate: '2026-10-26', session: null, numbers: [1, 2, 3, 4, 5], bonus: 6, multiplier: 3, sourceURL, official: true, ...extra });
const ticket = (game = 'Powerball', extra = {}) => ({ game, jurisdiction: 'OH', drawDates: ['2026-10-26'], session: null, plays: [{ label: 'A', numbers: [1, 2, 3, 4, 5], bonus: 7 }], reviewed: true, powerPlay: false, kicker: false, doublePlay: false, megaplier: false, ...extra });

test('OCR extracts explicit printed fields without retaining private text or skipping review', () => {
  const parsed = parse('OHIO LOTTERY\nPOWERBALL\nPURCHASED: 10/25/2026 12:33\nDRAW DATE: 10/26/2026\nA. 01 02 03 04 05 PB 06 QP\nB. 10 11 12 13 14 PB 15\nPOWER PLAY: YES\nDOUBLE PLAY: NO\nPLAYS: 2\nDRAWS: 1\nTOTAL COST: $6.00\nSERIAL 1234567890099887766');
  assert.equal(parsed.game, 'Powerball'); assert.equal(parsed.jurisdiction, 'OH');
  assert.deepEqual(parsed.drawDates, ['2026-10-26']);
  assert.deepEqual(parsed.plays[0].numbers, [1, 2, 3, 4, 5]); assert.equal(parsed.plays[0].bonus, 6);
  assert.equal(parsed.powerPlay, true); assert.equal(parsed.doublePlay, false);
  assert.equal(parsed.totalPriceCents, 600); assert.equal(parsed.declaredPlayCount, 2);
  assert.equal(parsed.reviewed, false); assert.equal(parsed.confirmationRequired, true);
  assert.equal(JSON.stringify(parsed).includes('1234567890099887766'), false);
  assert.equal(compare(parsed, result()).reason, 'review-ticket-details-first');
});

test('only labelled draw dates and played rows qualify; purchase timestamps and serial digits do not', () => {
  const parsed = parse('OHIO LOTTERY POWERBALL\nPURCHASE DATE: 10/26/2026\n01 02 03 04 05 06\nBARCODE: 010203040506\nTOTAL: $2.00');
  assert.deepEqual(parsed.drawDates, []); assert.deepEqual(parsed.plays, []);
  assert.ok(parsed.needsReview.includes('draw-date-needed')); assert.ok(parsed.needsReview.includes('played-numbers-needed'));
});

test('OCR accepts ISO, US and month-name labelled dates but never expands an ambiguous range', () => {
  for (const dateText of ['2026-10-26', '10/26/26', 'October 26, 2026']) {
    const parsed = parse(`OHIO LOTTERY POWERBALL\nDRAW DATE: ${dateText}\nA. 01 02 03 04 05 PB 06`);
    assert.deepEqual(parsed.drawDates, ['2026-10-26']);
  }
  const multi = parse('OHIO LOTTERY POWERBALL\nDRAW DATES: 10/26/2026 THROUGH 10/31/2026\nA. 01 02 03 04 05 PB 06');
  assert.equal(multi.dateRangeUnresolved, true); assert.ok(multi.needsReview.includes('draw-date-range-needs-review'));
  assert.deepEqual(parse('OHIO LOTTERY POWERBALL\nDRAW DATE: 02/30/2026\nA. 01 02 03 04 05 PB 06').drawDates, []);
});

test('ambiguous/malformed OCR plays remain unresolved; no digit correction or extra-play inference', () => {
  for (const row of ['A. O1 02 03 04 05 PB 06', 'A. 01 01 03 04 05 PB 06', 'A. 01 02 03 04 70 PB 06', 'A. 01 02 03 04 05 PB 27', 'A. 01 02 03 04 05 PB 06 07']) {
    const parsed = parse(`OHIO LOTTERY POWERBALL\nDRAW DATE: 10/26/2026\n${row}`);
    assert.equal(parsed.plays.length, 0); assert.equal(parsed.incompletePlays, true);
  }
  const count = parse('OHIO LOTTERY POWERBALL\nDRAW DATE: 10/26/2026\nA. 01 02 03 04 05 PB 06\nPLAYS: 2');
  assert.ok(count.needsReview.includes('play-count-conflict'));
  const duplicate = parse('OHIO LOTTERY POWERBALL\nA. 01 02 03 04 05 PB 06\nA. 01 02 03 04 05 PB 06');
  assert.equal(duplicate.plays.length, 1); assert.equal(duplicate.incompletePlays, true);
});

test('Pick OCR preserves leading zeroes, explicit stake, bet type and session', () => {
  const parsed = parse('OHIO LOTTERY PICK 3\nDRAW DATE: 10/27/2026 MIDDAY\nA. 001 STRAIGHT $0.50 AP\nB. 321 6-WAY BOX $1.00\nTOTAL COST: $1.50');
  assert.equal(parsed.session, 'midday'); assert.deepEqual(parsed.plays[0].numbers, [0, 0, 1]);
  assert.equal(parsed.plays[0].stakeCents, 50); assert.equal(parsed.plays[0].playType, 'straight');
  assert.equal(parsed.plays[1].playType, 'box'); assert.equal(parsed.totalPriceCents, 150);
  assert.deepEqual(parsed.needsReview, []);
  const ambiguous = parse('OHIO LOTTERY PICK 3\nDRAW DATE: 10/27/2026 MIDDAY EVENING\nA. 123 STRAIGHT $1.00');
  assert.equal(ambiguous.session, null); assert.equal(ambiguous.unsupportedOption, true);
});

test('Mega OCR preserves different per-play multipliers, names alone never invent them', () => {
  const parsed = parse('OHIO LOTTERY MEGA MILLIONS\nDRAW DATE: 10/27/2026\nA. 01 02 03 04 05 MB 06 2X\nB. 10 11 12 13 14 MB 15 MULTIPLIER 10X\nTOTAL: $10.00');
  assert.equal(parsed.plays[0].multiplier, 2); assert.equal(parsed.plays[1].multiplier, 10);
  assert.equal(parse('OHIO LOTTERY MEGA MILLIONS\nA. 01 02 03 04 05 MB 06').plays[0].multiplier, null);
});

test('validation sanitizes backups, rejects bad bounds, mixed game fields and malformed payloads', () => {
  const normalized = plain(api.validate({ ...ticket(), rawText: 'private', barcode: 'secret', officiallyVerified: true, image: 'private' }));
  assert.equal(normalized.rawText, undefined); assert.equal(normalized.barcode, undefined); assert.equal(normalized.officiallyVerified, undefined);
  for (const bad of [null, [], { ...ticket(), game: 'fake' }, { ...ticket(), jurisdiction: 'CA' }, { ...ticket(), drawDates: ['2026-02-30'] }, { ...ticket(), drawDates: ['2026-10-26', '2026-10-26'] }, { ...ticket(), plays: [{ numbers: [1, 1, 3, 4, 5], bonus: 6 }] }, { ...ticket(), plays: [{ numbers: [1, 2, 3, 4, 5], bonus: 6, multiplier: 7 }] }, { ...ticket(), plays: [{ numbers: [1, 2, 3, 4, 5], bonus: 6, stakeCents: -1 }] }, { ...ticket(), powerPlay: 'false' }]) assert.equal(api.validate(bad), null);
  assert.ok(plain(api.validate(ticket('Rolling Cash 5', { powerPlay: true, plays: [{ numbers: [1, 2, 3, 4, 5] }] }))).needsReview.includes('unsupported-option-needs-review'));
});

test('Powerball published tiers, no-win and jackpot classification never imply official verification', () => {
  const table = [[0, false, 0], [1, false, 0], [2, false, 0], [3, false, 700], [4, false, 10000], [5, false, 100000000], [0, true, 400], [1, true, 400], [2, true, 700], [3, true, 10000], [4, true, 5000000]];
  for (const [matches, bonus, cents] of table) {
    const nums = [...[1, 2, 3, 4, 5].slice(0, matches), ...[11, 12, 13, 14, 15].slice(matches)];
    const check = compare(ticket('Powerball', { plays: [{ numbers: nums, bonus: bonus ? 6 : 7 }] }), result());
    assert.equal(check.status, cents ? 'potential-winner' : 'potential-loser', `${matches}+${bonus}`);
    assert.equal(check.potentialCents, cents); assert.equal(check.officiallyVerified, false);
  }
  const jackpot = compare(ticket('Powerball', { plays: [{ numbers: [5, 4, 3, 2, 1], bonus: 6 }] }), result());
  assert.equal(jackpot.status, 'potential-winner'); assert.equal(jackpot.potentialCents, null); assert.equal(jackpot.details[0].jackpot, true);
});

test('Power Play uses draw multiplier except Match 5 fixed two-million prize', () => {
  assert.equal(compare(ticket('Powerball', { powerPlay: true }), result('Powerball', { multiplier: 10 })).potentialCents, 200000000);
  const oneBonus = ticket('Powerball', { powerPlay: true, plays: [{ numbers: [11, 12, 13, 14, 15], bonus: 6 }] });
  assert.equal(compare(oneBonus, result('Powerball', { multiplier: 10 })).potentialCents, 4000);
  assert.equal(compare(oneBonus, result('Powerball', { multiplier: null })).potentialCents, null);
  assert.equal(compare({ ...oneBonus, powerPlay: null }, result()).potentialCents, null);
});

test('Mega current tiers apply the printed per-play multiplier, not the drawn value', () => {
  const table = [[0, true, 5], [1, true, 7], [2, true, 10], [3, true, 200], [4, true, 10000], [3, false, 10], [4, false, 500], [5, false, 1000000], [2, false, 0]];
  for (const [matches, bonus, dollars] of table) {
    const nums = [...[1, 2, 3, 4, 5].slice(0, matches), ...[11, 12, 13, 14, 15].slice(matches)];
    const check = compare(ticket('Mega Millions', { plays: [{ numbers: nums, bonus: bonus ? 6 : 7, multiplier: 2 }] }), result('Mega Millions', { multiplier: 10 }));
    assert.equal(check.status, dollars ? 'potential-winner' : 'potential-loser'); assert.equal(check.potentialCents, dollars * 200);
  }
  const two = ticket('Mega Millions', { plays: [{ label: 'A', numbers: [1, 2, 3, 11, 12], bonus: 7, multiplier: 2 }, { label: 'B', numbers: [1, 2, 3, 11, 12], bonus: 7, multiplier: 10 }] });
  assert.equal(compare(two, result('Mega Millions')).potentialCents, 12000);
  assert.equal(compare(ticket('Mega Millions'), result('Mega Millions')).potentialCents, null);
});

test('Mega April 2025 boundary retains legacy Megaplier and rejects out-of-range new bonus', () => {
  const old = ticket('Mega Millions', { drawDates: ['2025-04-04'], megaplier: true, plays: [{ numbers: [11, 12, 13, 14, 15], bonus: 25 }] });
  const oldResult = result('Mega Millions', { drawDate: '2025-04-04', bonus: 25, multiplier: 2 });
  assert.equal(compare(old, oldResult).potentialCents, 400);
  assert.equal(api.validate({ ...old, drawDates: ['2025-04-08'] }), null);
  assert.equal(compare(ticket('Mega Millions', { drawDates: ['2025-04-08'], megaplier: true }), result('Mega Millions', { drawDate: '2025-04-08' })).status, 'pending');
});

test('missing, future, wrong-date/session, unapproved and unofficial source results cannot mark a loser', () => {
  const losing = ticket('Powerball', { plays: [{ numbers: [11, 12, 13, 14, 15], bonus: 7 }] });
  for (const official of [null, [], result('Powerball', { drawDate: '2026-10-28' }), result('Powerball', { official: false }), result('Powerball', { sourceURL: 'https://ohiolottery.com.attacker.test/numbers' }), result('Powerball', { sourceURL: 'http://www.ohiolottery.com/numbers' }), result('Powerball', { numbers: [1, 1, 3, 4, 5] })]) assert.equal(compare(losing, official).status, 'pending');
  const picked = ticket('Pick 3', { session: 'midday', plays: [{ numbers: [0, 0, 1], stakeCents: 50, playType: 'straight' }] });
  assert.equal(compare(picked, result('Pick 3', { session: 'evening', numbers: [0, 0, 2], bonus: null, multiplier: null })).status, 'pending');
  assert.equal(compare(losing, [result(), result('Powerball', { numbers: [6, 7, 8, 9, 10] })]).status, 'pending');
});

test('all draws and all reviewed plays must be checked before a potential loss', () => {
  const multi = ticket('Powerball', { drawDates: ['2026-10-26', '2026-10-28'], plays: [{ numbers: [11, 12, 13, 14, 15], bonus: 7 }] });
  assert.equal(compare(multi, result()).status, 'pending');
  assert.equal(compare(multi, [result(), result('Powerball', { drawDate: '2026-10-28' })]).status, 'potential-loser');
  const partialWinner = compare(ticket('Powerball', { drawDates: ['2026-10-26', '2026-10-28'] }), result());
  assert.equal(partialWinner.status, 'potential-winner'); assert.equal(partialWinner.partial, true); assert.equal(partialWinner.potentialCents, null);
  for (const flag of ['incompletePlays', 'dateRangeUnresolved', 'unsupportedOption']) assert.equal(compare({ ...multi, [flag]: true }, result()).status, 'pending');
});

test('Classic Lotto cannot mark the entire ticket a loser when Kicker is unchecked', () => {
  const classic = ticket('Classic Lotto', { kicker: null, plays: [{ numbers: [11, 12, 13, 14, 15, 16] }] });
  const draw = result('Classic Lotto', { numbers: [1, 2, 3, 4, 5, 6], bonus: null, multiplier: null });
  assert.equal(compare(classic, draw).reason, 'add-on-needs-official-check');
  assert.equal(compare({ ...classic, kicker: false }, draw).status, 'potential-loser');
  assert.equal(compare({ ...classic, plays: [{ numbers: [1, 2, 3, 11, 12, 13] }] }, draw).status, 'potential-winner');
  assert.equal(compare(ticket('Powerball', { doublePlay: true, plays: [{ numbers: [11, 12, 13, 14, 15], bonus: 7 }] }), result()).status, 'pending');
});

test('simple Classic, Rolling, Pick straight and box match rules; unsupported bet types remain pending', () => {
  const classic = result('Classic Lotto', { numbers: [1, 2, 3, 4, 5, 6], bonus: null });
  assert.equal(compare(ticket('Classic Lotto', { plays: [{ numbers: [1, 2, 3, 11, 12, 13] }] }), classic).status, 'potential-winner');
  const rolling = result('Rolling Cash 5', { bonus: null });
  assert.equal(compare(ticket('Rolling Cash 5', { plays: [{ numbers: [1, 2, 11, 12, 13] }] }), rolling).status, 'potential-winner');
  assert.equal(compare(ticket('Rolling Cash 5', { plays: [{ numbers: [1, 11, 12, 13, 14] }] }), rolling).status, 'potential-loser');
  for (const game of ['Pick 3', 'Pick 4', 'Pick 5']) {
    const count = Number(game.at(-1)); const numbers = Array.from({ length: count }, (_, i) => i);
    const draw = result(game, { session: 'midday', numbers, bonus: null, multiplier: null });
    const picked = ticket(game, { session: 'midday', plays: [{ numbers, stakeCents: 50, playType: 'straight' }] });
    assert.equal(compare(picked, draw).status, 'potential-winner');
    const reversed = { ...picked, plays: [{ numbers: numbers.toReversed(), stakeCents: 100, playType: 'box' }] };
    assert.equal(compare(reversed, draw).status, 'potential-winner');
    assert.equal(compare({ ...reversed, plays: [{ ...reversed.plays[0], playType: 'straight' }] }, draw).status, 'potential-loser');
    assert.equal(compare({ ...reversed, plays: [{ ...reversed.plays[0], playType: 'straight-box' }] }, draw).status, 'pending');
  }
});

test('Lucky for Life legacy bounds work while ended-game dates and KENO stay pending', () => {
  const lucky = ticket('Lucky for Life', { drawDates: ['2026-02-21'], plays: [{ numbers: [1, 2, 3, 4, 5], bonus: 6 }] });
  const draw = result('Lucky for Life', { drawDate: '2026-02-21' });
  assert.equal(compare(lucky, draw).status, 'potential-winner'); assert.equal(compare(lucky, draw).potentialCents, null);
  assert.equal(compare({ ...lucky, drawDates: ['2026-02-22'] }, { ...draw, drawDate: '2026-02-22' }).status, 'pending');
  assert.equal(compare(ticket('KENO', { plays: [{ numbers: [1, 2, 3] }] }), { ...result('KENO'), numbers: [1, 2, 3], bonus: null }).status, 'pending');
});

test('Ohio jurisdiction and review are explicit; parser never adopts another state', () => {
  const parsed = parse('CALIFORNIA LOTTERY POWERBALL\nDRAW DATE: 10/26/2026\nA. 01 02 03 04 05 PB 06');
  assert.equal(parsed.jurisdiction, null); assert.ok(parsed.needsReview.includes('ohio-jurisdiction-needs-review'));
  assert.equal(compare({ ...parsed, reviewed: true }, result()).status, 'pending');
  assert.equal(compare({ ...ticket(), reviewed: false }, result()).status, 'pending');
});

test('Kicker uses first consecutive digits, explicit Yes and one activation per ticket', () => {
  const parsed = parse('OHIO LOTTERY CLASSIC LOTTO\nDRAW DATE: 10/26/2026\nA. 11 12 13 14 15 16\nKICKER: YES\nKICKER NUMBER: 123456');
  assert.deepEqual(parsed.kickerNumbers, [1, 2, 3, 4, 5, 6]); assert.equal(parsed.kicker, true);
  const classic = ticket('Classic Lotto', { kicker: true, kickerNumbers: [1, 2, 3, 4, 5, 6], plays: [{ label: 'A', numbers: [11, 12, 13, 14, 15, 16] }, { label: 'B', numbers: [21, 22, 23, 24, 25, 26] }] });
  const draw = result('Classic Lotto', { numbers: [1, 2, 3, 4, 5, 6], bonus: null, kicker: [1, 2, 3, 4, 5, 6] });
  assert.equal(compare(classic, draw).potentialCents, 10000000);
  assert.equal(compare(classic, draw).details.filter(detail => detail.option === 'kicker').length, 1);
  for (const [digits, expected] of [[[1, 2, 9, 9, 9, 9], 1000], [[1, 2, 3, 9, 9, 9], 10000], [[1, 2, 3, 4, 9, 9], 100000], [[1, 2, 3, 4, 5, 9], 500000]]) assert.equal(compare(classic, { ...draw, kicker: digits }).potentialCents, expected);
  const trailing = compare(classic, { ...draw, kicker: [9, 9, 3, 4, 5, 6] });
  assert.equal(trailing.status, 'potential-loser'); assert.equal(trailing.potentialCents, 0);
  assert.equal(compare({ ...classic, kickerNumbers: null }, draw).status, 'pending');
  assert.equal(compare({ ...classic, kicker: false }, draw).status, 'potential-loser');
  assert.equal(compare(classic, { ...draw, kicker: null }).status, 'pending');
});

test('dated Classic and Rolling published tiers supply potential amounts without pricing a jackpot', () => {
  const prizesURL = 'https://api-solutions.ohiolottery.com/1.0/Games/DrawGames/ClassicLotto/SearchDrawDateRange?sinceDate=10-26-2026&toDate=10-26-2026';
  const prizes = [{ matchCount: 3, bonusMatch: false, potentialCents: 200, sourceURL: prizesURL }];
  const classic = ticket('Classic Lotto', { plays: [{ numbers: [1, 2, 3, 11, 12, 13] }] });
  const draw = result('Classic Lotto', { numbers: [1, 2, 3, 4, 5, 6], bonus: null, prizes });
  assert.equal(compare(classic, draw).potentialCents, 200);
  assert.equal(compare(classic, { ...draw, prizes: [...prizes, ...prizes] }).potentialCents, null);
  assert.equal(compare(classic, { ...draw, prizes: [{ ...prizes[0], sourceURL: 'https://attacker.test/prizes' }] }).potentialCents, null);
  assert.equal(compare({ ...classic, plays: [{ numbers: [1, 2, 3, 4, 5, 6] }] }, draw).potentialCents, null);
  const rolling = ticket('Rolling Cash 5', { plays: [{ numbers: [1, 2, 11, 12, 13] }] });
  assert.equal(compare(rolling, result('Rolling Cash 5', { bonus: null, prizes: [{ matchCount: 2, bonusMatch: false, potentialCents: 100, sourceURL: prizesURL.replace('ClassicLotto', 'RollingCashFive') }] })).potentialCents, 100);
  assert.equal(compare(ticket(), result('Powerball', { approved: false })).status, 'pending');
  assert.equal(compare(ticket(), { status: 'unavailable', stale: true, records: [result()] }).status, 'pending');
});

test('notification eligibility requires exact approved official draw matrices and session independently of prize comparison',()=>{
  const query={game:'Powerball',drawDate:'2026-10-26',session:null};
  const published={...result(),approved:true};
  assert.equal(api.isPublishedResult(published,query),true);
  for(const bad of [{...published,approved:false},{...published,approved:undefined},{...published,official:false},{...published,stale:true},{...published,drawDate:'2026-10-28'},{...published,game:'Mega Millions'},{...published,numbers:[1,1,3,4,5]},{...published,bonus:27},{...published,sourceURL:'https://attacker.test/results'}])assert.equal(api.isPublishedResult(bad,query),false);
  const picked={...published,game:'Pick 3',session:'midday',numbers:[0,0,1],bonus:null,multiplier:null};
  assert.equal(api.isPublishedResult(picked,{game:'Pick 3',drawDate:'2026-10-26',session:'midday'}),true);
  assert.equal(api.isPublishedResult(picked,{game:'Pick 3',drawDate:'2026-10-26',session:'evening'}),false);
  assert.equal(api.isPublishedResult(picked,{game:'Pick 3',drawDate:'2026-10-26',session:null}),false);
});
