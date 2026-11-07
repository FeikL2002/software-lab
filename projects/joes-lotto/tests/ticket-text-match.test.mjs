import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const catalog = JSON.parse(await readFile(new URL('../dist/data/ohio-games.json', import.meta.url), 'utf8'));
const source = await readFile(new URL('../dist/ticket-text-match.js', import.meta.url), 'utf8');
const context = vm.createContext({ window: {} });
vm.runInContext(source, context);
const { match, matchDraw } = context.window.JoeTicketTextMatch;
const scratch = text => match(text, catalog.games);
const copy = value => JSON.parse(JSON.stringify(value));

test('printed exact game number and matching title fill catalog price without reading prizes as prices', () => {
  const result = scratch('OHIO LOTTERY\nHOLIDAY CASH\nWIN UP TO $500\nGame #1106');
  assert.equal(result.gameMatch.gameNumber, '1106');
  assert.equal(result.gameMatch.unitPriceCents, 100);
  assert.equal(result.confidence, 'printed-game-id');
  assert.equal(result.gameMatch.source, catalog.games.find(game => game.gameNumber === '1106').source);
  assert.ok(!JSON.stringify(result).includes('WIN UP TO'));
  assert.equal(scratch('HOLIDAY CASH\nGAME No. 11O6').gameMatch.gameNumber, '1106');
});

test('every catalog game can match its printed title plus explicitly labelled exact game number', () => {
  for (const row of catalog.games) {
    const name = row.name.replace(/\s+#\s*\d{3,4}\s*$/, '');
    const result = scratch(`Ohio Lottery\n${name}\nGame Number: ${row.gameNumber}`);
    assert.equal(result.gameMatch?.gameNumber, row.gameNumber, `${row.gameNumber} ${row.name}: ${result.reason}`);
    assert.equal(result.gameMatch?.unitPriceCents, row.unitPriceCents);
  }
});

test('exact unique title plus explicit unit price supports unknown product barcode games', () => {
  const result = scratch('OHIO LOTTERY\nMonopoly\n200X\nTicket price: $30.00\nTOP PRIZE $2,000,000');
  assert.equal(result.gameMatch.gameNumber, '696');
  assert.equal(result.gameMatch.unitPriceCents, 3000);
  assert.equal(result.confidence, 'printed-title-and-price');
  assert.equal(scratch('BINGO 50X\n$10').gameMatch.gameNumber, '847');
  assert.equal(scratch('JOKER’S WILD\nPRICE $5').gameMatch.gameNumber, '1030');
  assert.equal(scratch('MONOPOLY® 200X™\n$30').gameMatch.gameNumber, '696');
  assert.equal(scratch('Win Big\n$5').gameMatch.gameNumber, '1041');
  assert.equal(scratch('Bingo Multiplier\n$2').gameMatch.gameNumber, '1080');
  assert.equal(scratch('Ohio Millionaire’s Club\n$20').gameMatch.gameNumber, '1043');
});

test('same title and same price stay ambiguous until exact printed game number is available', () => {
  const ambiguous = scratch('HOLIDAY CASH\n$1');
  assert.equal(ambiguous.gameMatch, null);
  assert.equal(ambiguous.reason, 'game-version-ambiguous');
  assert.deepEqual(copy(ambiguous.candidates).map(game => game.gameNumber).sort(), ['1044', '1106']);
  assert.equal(scratch('Holiday Cash\n$1\n#1044').gameMatch.gameNumber, '1044');
  assert.equal(scratch('$500,000 Cashword\n$10').gameMatch, null);
  assert.equal(scratch('$500,000 Cashword\n$10\nGame No.1118').gameMatch.gameNumber, '1118');
});

test('same title with different prices resolves only a unique exact title-price pair', () => {
  for (const [price, game] of [[1, '1069'], [2, '1070'], [5, '1071'], [10, '1072'], [20, '1073']]) {
    assert.equal(scratch(`SET FOR LIFE\n$${price}`).gameMatch.gameNumber, game);
  }
  assert.equal(scratch('Set For Life\nWIN $10').gameMatch, null);
  assert.equal(scratch('Set For Life\nPrice: $30').gameMatch, null);
});

test('numeric titles and prize dollar amounts cannot masquerade as unit prices', () => {
  for (const text of [
    '$100 In A Flash',
    '$100 In A Flash\nWIN $2',
    '$100 In A Flash\nWIN UP TO\n$2',
    '$100 In A Flash\nTOP PRIZE\n$2',
    '$5, $20 or $100',
    'Royal Riches\nWin $30',
    'Royal Riches\nBONUS\n$30',
    'Royal Riches\nWIN PRICE $30',
    'Royal Riches\n$30000',
    '$500,000 Cashword\nWIN UP TO $10',
  ]) assert.equal(scratch(text).gameMatch, null, text);
  assert.equal(scratch('$100 In A Flash\nTicket Cost: $2').gameMatch.gameNumber, '1100');
  assert.equal(scratch('$300 Million Diamond Dazzler\nPrice $20\nWin up to $1,000,000').gameMatch.gameNumber, '1028');
  assert.equal(scratch('$2,000,000 Cashword\nPrice $30').gameMatch.gameNumber, '1051');
});

test('longer exact names do not accidentally select their shorter names', () => {
  const result = scratch('LUCK OF THE IRISH TRIPLER\n$1');
  assert.equal(result.gameMatch.gameNumber, '1063');
  assert.equal(scratch('HOLIDAY CASH VAULT\nTicket Price: $10').gameMatch.gameNumber, '1047');
  assert.equal(scratch('Luck of the Irish\n$1\nLuck of the Irish Tripler\n$1').reason, 'multiple-game-titles');
  assert.equal(scratch('Holiday Cash\n$1\nHoliday Cash Vault\n$10').gameMatch, null);
});

test('game number, title and explicitly printed price conflicts never silently select a game', () => {
  for (const text of [
    'Holiday Cash\nGame #1118',
    '$500,000 Cashword\nGame #1106',
    'Holiday Cash\nGame #1106\nGame #1044',
    'Holiday Cash\nGame #9999',
    'Holiday Cash\nGame #1106\nTicket Price: $5',
    'Royal Riches\nTicket Price: $30\nPrice: $20',
    'Royal Riches\n$30\n$20',
  ]) assert.equal(scratch(text).gameMatch, null, text);
  assert.equal(scratch('Holiday Cash\nGame #1106\nRoyal Riches').reason, 'multiple-game-titles');
});

test('unlabelled barcodes, missing title and fuzzy title guesses cannot become automatic identities', () => {
  for (const text of [
    'Game #1106',
    '1106\nHoliday Cash',
    '1106-0000123-001-2\nHoliday Cash',
    'Holiday Cosh\nGame #1106',
    'Royal Rlches\n$30',
    'Play Royal Riches for big prizes\n$30',
    'Royal Riches\nGAME 99999',
  ]) assert.equal(scratch(text).gameMatch, null, text);
  assert.equal(scratch('game #1106').reason, 'game-title-needed');
  assert.equal(scratch('Royal Riches').reason, 'printed-price-needed');
  assert.equal(scratch('Royal Riches\n$0').gameMatch, null);
});

test('empty, excessive and malformed input/catalog remain safe and expose no OCR text', () => {
  assert.equal(scratch(null).reason, 'no-text');
  assert.equal(scratch('x'.repeat(40001)).reason, 'text-too-long');
  assert.equal(match('Royal Riches\n$30', []).reason, 'catalog-unavailable');
  assert.equal(match('Royal Riches\n$30', [null, {}, { gameNumber: '1024', name: 'Royal Riches', unitPriceCents: -1 }]).gameMatch, null);
  assert.equal(match('Royal Riches\n$30', [catalog.games[0], catalog.games[0]]).gameMatch, null);
});

test('Ohio draw games require an explicit printed total and retain cents exactly', () => {
  for (const game of ['Pick 3', 'Pick 4', 'Pick 5', 'Rolling Cash 5', 'Classic Lotto', 'Powerball', 'Mega Millions', 'KENO']) {
    const result = matchDraw(`OHIO LOTTERY\n${game}\n$0.50 PER PLAY\nTOTAL COST: $4.50`);
    assert.equal(result.gameMatch.game, game);
    assert.equal(result.gameMatch.name, game);
    assert.equal(result.gameMatch.totalPriceCents, 450);
    assert.equal(result.confidence, 'printed-draw-total');
    assert.equal(result.gameMatch.unitPriceCents, undefined);
  }
  for (const label of ['TOTAL COST', 'TOTAL WAGER', 'TOTAL PRICE', 'TICKET COST', 'TOTAL']) {
    assert.equal(matchDraw(`Ohio Lottery\nPick 3\n${label}: $0.50`).gameMatch.totalPriceCents, 50);
  }
});

test('draw unit-play prices, prize headlines, missing Ohio mark and multiple games/totals require confirmation', () => {
  for (const text of [
    'Pick 3\nTOTAL COST $4',
    'New York Lottery\nPick 3\nTOTAL COST $4',
    'Ohio Lottery\nPick 3\n$0.50 PER PLAY',
    'Ohio Lottery\nPowerball\n$2',
    'Ohio Lottery\nPowerball\nWIN $2\nTOP PRIZE $1,000,000',
    'Ohio Lottery\nPowerball\nTOTAL PRIZE $100',
    'Ohio Lottery\nPowerball\nWINNING TOTAL $100',
    'Ohio Lottery\nPick 3\nPick 4\nTOTAL COST $4',
    'Ohio Lottery\nPick 3\nTOTAL COST $4\nTOTAL WAGER $5',
    'Ohio Lottery\nPick 3\nTOTAL COST $0',
    'Ohio Lottery\nKENO\nTOTAL COST $1000000',
  ]) assert.equal(matchDraw(text).gameMatch, null, text);
  assert.equal(matchDraw('Ohio Lottery\nPowerball\nTOTAL $4\nTOTAL COST $4.00').gameMatch.totalPriceCents, 400);
});


test('all current catalog games resolve from documented printed-back serial layouts and an Ohio mark', () => {
  for (const row of catalog.games.filter(game => game.catalogStatus === 'listed')) {
    const serial = row.gameNumber.length === 3 ? `${row.gameNumber}-024216-053-4` : `${row.gameNumber}-0024216-053-4`;
    const result = scratch(`OHIO LOTTERY\n${serial}\nPlease play responsibly.`);
    assert.equal(result.gameMatch?.gameNumber, row.gameNumber, `${row.gameNumber}: ${result.reason}`);
    assert.equal(result.gameMatch.unitPriceCents, row.unitPriceCents);
    assert.equal(result.confidence, 'printed-game-serial');
    assert.ok(!JSON.stringify(result).includes('024216'));
    assert.ok(!JSON.stringify(result).includes('053-4'));
  }
  assert.equal(scratch('Ohio Lottery\n1106 - 0024216 - 053 - 4').gameMatch.gameNumber, '1106');
});

test('printed serials require Ohio mark, exact documented groups, standalone lines and known ID', () => {
  for (const text of [
    '1106-0024216-053-4',
    'Michigan Lottery\n1106-0024216-053-4',
    'Ohio Lottery\n110600242160534',
    'Ohio Lottery\n6960242160534',
    'Ohio Lottery\n1106-024216-053-4',
    'Ohio Lottery\n696-0024216-053-4',
    'Ohio Lottery\n1106-0024216-0534',
    'Ohio Lottery\n1106-0024216-0053-4',
    'Ohio Lottery\nCode:1106-0024216-053-4',
    'Ohio Lottery\n1106-0024216-053-4 more digits',
    'Ohio Lottery\n9999-0024216-053-4',
    'Ohio Lottery\n11O6-0024216-053-4',
  ]) assert.equal(scratch(text).gameMatch, null, text);
});

test('printed serial identity never overrides conflicting IDs, names, prices or multiple game serials', () => {
  for (const text of [
    'Ohio Lottery\n1106-0024216-053-4\n1118-0024216-053-4',
    'Ohio Lottery\n1106-0024216-053-4\nGAME #1118',
    'Ohio Lottery\n1106-0024216-053-4\nRoyal Riches',
    'Ohio Lottery\n1106-0024216-053-4\nTicket Price $10',
    'Ohio Lottery\n9999-0024216-053-4\nRoyal Riches\nPrice $30',
  ]) assert.equal(scratch(text).gameMatch, null, text);
  assert.equal(scratch('Ohio Lottery\nHoliday Cash\n1106-0024216-053-4').gameMatch.gameNumber, '1106');
  assert.equal(scratch('Ohio Lottery\nHoliday Cash\nGAME #1106\n1106-0024216-053-4').gameMatch.gameNumber, '1106');
});
