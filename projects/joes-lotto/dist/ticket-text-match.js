/* Joe's Lotto: conservative, local-only identification of printed ticket text.
 * OCR text is evidence, never a source for catalog ticket prices. This module
 * does not decode validation barcodes, validate prizes, or infer draw wagers.
 */
(() => {
  'use strict';

  const MAX_TEXT = 40000;
  const MAX_CANDIDATES = 10;
  const DRAW_GAMES = Object.freeze([
    ['Rolling Cash 5', /\brolling\s+cash\s*5\b/g],
    ['Classic Lotto', /\bclassic\s+lotto\b/g],
    ['Mega Millions', /\bmega\s+millions\b/g],
    ['Powerball', /\bpower\s*ball\b/g],
    ['Pick 3', /\bpick\s*3\b/g],
    ['Pick 4', /\bpick\s*4\b/g],
    ['Pick 5', /\bpick\s*5\b/g],
    ['KENO', /\bkeno\b/g],
  ]);

  function normalize(value) {
    return String(value).replace(/[®™©]/g, '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[’‘'`]/g, '').replace(/(\d)[,](?=\d{3}(?:\D|$))/g, '$1')
      .replace(/&/g, ' and ').toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
  }

  function validText(text) {
    return typeof text === 'string' && text.length > 0 && text.length <= MAX_TEXT;
  }

  function catalogRows(games) {
    if (!Array.isArray(games)) return [];
    const counts = new Map();
    for (const game of games) {
      const number = String(game?.gameNumber || '');
      counts.set(number, (counts.get(number) || 0) + 1);
    }
    return games.filter(game => game && /^\d{1,4}$/.test(String(game.gameNumber))
      && Number(game.gameNumber) > 0 && counts.get(String(game.gameNumber)) === 1
      && typeof game.name === 'string' && game.name.trim() && game.name.length <= 150
      && Number.isSafeInteger(game.unitPriceCents) && game.unitPriceCents > 0
      && game.unitPriceCents <= 10000).map(game => ({
        gameNumber: String(game.gameNumber), name: game.name.trim(),
        title: normalize(game.name.replace(/\s+#\s*\d{3,4}\s*$/, '')),
        unitPriceCents: game.unitPriceCents,
        ...(typeof game.source === 'string' ? { source: game.source } : {}),
        ...(typeof game.asOf === 'string' ? { asOf: game.asOf } : {}),
        ...(game.catalogStatus ? { catalogStatus: game.catalogStatus } : {}),
      })).filter(game => game.title);
  }

  function publicGame(row, confidence = null) {
    const { title, ...game } = row;
    return { game: 'Scratch-off', ...game, confidence };
  }

  function result(reason, rows = [], selected = null, confidence = null) {
    return {
      gameMatch: selected ? publicGame(selected, confidence) : null,
      candidates: rows.slice(0, MAX_CANDIDATES).map(row => publicGame(row)),
      reason,
      confidence: selected ? confidence : null,
    };
  }

  function gameNumbers(text) {
    // Only explicitly labelled IDs qualify. An unlabelled long barcode/serial
    // or any convenient three/four digits elsewhere is not a game number.
    const pattern = /(?:\bgame\s*(?:(?:number|no\.?)\s*)?(?:[#:\-]\s*)?|\bno\.?\s*(?:[#:]+\s*)?|#\s*)([0-9OIl|]{3,4})(?![a-z0-9])/gi;
    const numbers = new Set();
    for (const match of text.matchAll(pattern)) {
      // Limited OCR corrections apply only inside an explicit game-ID label;
      // wholly alphabetic guesses and title spelling corrections never qualify.
      if (!/\d/.test(match[1])) continue;
      const value = match[1].replace(/O/gi, '0').replace(/[il|]/gi, '1');
      numbers.add(String(Number(value)));
    }
    return numbers;
  }

  function printedSerialNumbers(text) {
    // Ohio Lottery's published four-digit transition guide documents these
    // printed-back game/book/ticket/check-digit layouts. Only complete OCR
    // lines qualify; no concatenated digits or raw decoded barcode are parsed.
    // The book, ticket and check-digit values are immediately discarded.
    const numbers = new Set();
    for (const line of text.split(/\r?\n/)) {
      const serial = line.trim().match(/^(?:(\d{3})\s*-\s*\d{6}\s*-\s*\d{3}\s*-\s*\d|(\d{4})\s*-\s*\d{7}\s*-\s*\d{3}\s*-\s*\d)$/);
      if (serial) numbers.add(String(Number(serial[1] || serial[2])));
    }
    return numbers;
  }

  function titleOccurrences(text, title) {
    const haystack = ` ${text} `;
    const needle = ` ${title} `;
    const found = [];
    let start = 0;
    while ((start = haystack.indexOf(needle, start)) >= 0) {
      found.push([start, start + needle.length]);
      start += needle.length - 1;
    }
    return found;
  }

  function exactTitles(text, rows) {
    const groups = new Map();
    for (const row of rows) {
      if (!groups.has(row.title)) groups.set(row.title, { title: row.title, rows: [], occurrences: titleOccurrences(text, row.title) });
      groups.get(row.title).rows.push(row);
    }
    const present = [...groups.values()].filter(group => group.occurrences.length);
    // "Holiday Cash" inside "Holiday Cash Vault" is not evidence for a second
    // ticket. A separate Holiday Cash occurrence still counts as a conflict.
    return present.filter(group => group.occurrences.some(([start, end]) => !present.some(other => other !== group
      && other.title.length > group.title.length
      && other.occurrences.some(([outerStart, outerEnd]) => outerStart <= start && outerEnd >= end))));
  }

  function moneyCents(whole, decimals = '') {
    const dollars = Number(whole.replace(/,/g, ''));
    const cents = dollars * 100 + Number(decimals.padEnd(2, '0'));
    return Number.isSafeInteger(cents) && cents > 0 && cents <= 100000 ? cents : null;
  }

  function printedUnitPrices(text, titles = []) {
    const lines = text.normalize('NFKC').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const prices = new Set();
    const prize = /\b(?:win(?:ning|nings)?|prizes?|payout|bonus|up\s+to|reveal|match|multiply|multiplier|your\s+numbers)\b/i;
    const priceLabel = /\b(?:(?:ticket|unit|purchase)\s*(?:price|cost)|price|cost)\s*(?::|=|[-–—])?\s*\$\s*(\d+(?:,\d{3})*)(?:\.(\d{1,2}))?(?![\d.,])/gi;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      for (const match of line.matchAll(priceLabel)) {
        const preceding = line.slice(Math.max(0, match.index - 30), match.index);
        if (prize.test(preceding)) continue;
        const price = moneyCents(match[1], match[2]);
        if (price !== null) prices.add(price);
      }
      // Unit prices often occupy their own small corner of the ticket. Reject
      // isolated dollar lines next to prize/gameplay labels; title dollar values
      // and arbitrary dollar values in sentences never qualify as unit prices.
      const standalone = line.match(/^\$\s*(\d{1,3})(?:\.(\d{1,2}))?\s*(?:each|per\s+ticket)?$/i);
      const adjacent = [lines[index - 1] || '', lines[index + 1] || '']
        .filter(value => !titles.includes(normalize(value))).join(' ');
      if (standalone && !prize.test(adjacent)) {
        const price = moneyCents(standalone[1], standalone[2]);
        if (price !== null) prices.add(price);
      }
      const each = line.match(/^\$\s*(\d{1,3})(?:\.(\d{1,2}))?\s+(?:each|per\s+ticket)$/i);
      if (each) {
        const price = moneyCents(each[1], each[2]);
        if (price !== null) prices.add(price);
      }
    }
    return prices;
  }

  function titleIsPrintedAlone(text, title) {
    // Accept a title split across adjacent OCR lines, but not a matching phrase
    // embedded in a gameplay/advertising sentence. No fuzzy acceptance is used.
    const lines = text.split(/\r?\n/).map(normalize).filter(Boolean);
    for (let start = 0; start < lines.length; start += 1) {
      let block = '';
      for (let end = start; end < Math.min(lines.length, start + 8); end += 1) {
        block = block ? `${block} ${lines[end]}` : lines[end];
        if (block === title) return true;
        if (block.length > title.length || !title.startsWith(block)) break;
      }
    }
    return false;
  }

  function match(text, games) {
    if (!validText(text)) return result(typeof text === 'string' && text.length > MAX_TEXT ? 'text-too-long' : 'no-text');
    const rows = catalogRows(games);
    if (!rows.length) return result('catalog-unavailable');
    const normalized = normalize(text);
    const explicitNumbers = gameNumbers(text);
    const numbers = new Set(explicitNumbers);
    const serialNumbers = printedSerialNumbers(text);
    for (const number of serialNumbers) numbers.add(number);
    const ohioMark = /\bohio\s*lottery\b/.test(normalized);
    const titles = exactTitles(normalized, rows);
    const titleRows = titles.flatMap(group => group.rows);
    const numberRows = rows.filter(row => numbers.has(row.gameNumber));
    const candidates = [...new Map([...numberRows, ...titleRows].map(row => [row.gameNumber, row])).values()];
    if (numbers.size > 1) return result('conflicting-game-numbers', candidates);
    if (titles.length > 1) return result('multiple-game-titles', candidates);
    const prices = printedUnitPrices(text, titles.map(group => group.title));
    if (numbers.size) {
      if (numberRows.length !== 1) return result('unknown-game-number', candidates);
      const selected = numberRows[0];
      const printedSerial = ohioMark && serialNumbers.has(selected.gameNumber);
      if (serialNumbers.size && !ohioMark && !explicitNumbers.has(selected.gameNumber)) return result('ohio-lottery-mark-needed', [selected]);
      if (!titles.length && !printedSerial) return result(serialNumbers.size && !ohioMark ? 'ohio-lottery-mark-needed' : 'game-title-needed', [selected]);
      if (titles.length && !titleRows.some(row => row.gameNumber === selected.gameNumber)) return result('game-number-title-conflict', candidates);
      if (prices.size > 1 || (prices.size === 1 && !prices.has(selected.unitPriceCents))) return result('printed-price-conflict', candidates);
      return printedSerial
        ? result('matched-printed-game-serial', [selected], selected, 'printed-game-serial')
        : result('matched-printed-game-number', [selected], selected, 'printed-game-id');
    }
    if (!titles.length) return result('game-title-not-found');
    if (!titleIsPrintedAlone(text, titles[0].title)) return result('printed-title-needs-confirmation', titleRows);
    if (!prices.size) return result('printed-price-needed', titleRows);
    if (prices.size > 1) return result('multiple-printed-prices', titleRows);
    const matching = titleRows.filter(row => prices.has(row.unitPriceCents));
    if (!matching.length) return result('printed-price-conflict', titleRows);
    if (matching.length > 1) return result('game-version-ambiguous', matching);
    return result('matched-printed-title-and-price', matching, matching[0], 'printed-title-and-price');
  }

  function drawResult(reason, gameMatch = null, names = []) {
    return { gameMatch, candidates: names.map(name => ({ game: name, name, confidence: null })), reason, confidence: gameMatch?.confidence || null };
  }

  function matchDraw(text) {
    if (!validText(text)) return drawResult(typeof text === 'string' && text.length > MAX_TEXT ? 'text-too-long' : 'no-text');
    const normalized = normalize(text);
    if (!/\bohio\s*lottery\b/.test(normalized)) return drawResult('ohio-lottery-mark-needed');
    const names = DRAW_GAMES.filter(([, pattern]) => { pattern.lastIndex = 0; return pattern.test(normalized); }).map(([name]) => name);
    if (!names.length) return drawResult('draw-game-title-not-found');
    if (names.length > 1) return drawResult('multiple-draw-games', null, names);
    const totals = new Set();
    const pattern = /\b(?:total\s+(?:cost|wager|price)|ticket\s+cost|total)\s*(?::|=|[-–—])?\s*\$\s*(\d+(?:,\d{3})*)(?:\.(\d{1,2}))?(?![\d.,])/gi;
    for (const found of text.matchAll(pattern)) {
      const preceding = text.slice(Math.max(0, found.index - 35), found.index);
      if (/\b(?:win(?:ning|nings)?|prizes?|payout|paid)\b[^\n]*$/i.test(preceding)) continue;
      const price = moneyCents(found[1], found[2]);
      if (price !== null) totals.add(price);
    }
    if (!totals.size) return drawResult('printed-draw-total-needed', null, names);
    if (totals.size > 1) return drawResult('conflicting-draw-totals', null, names);
    const name = names[0];
    return drawResult('matched-printed-draw-total', { game: name, name, totalPriceCents: [...totals][0], confidence: 'printed-draw-total' }, names);
  }

  window.JoeTicketTextMatch = Object.freeze({ match, matchDraw });
})();
