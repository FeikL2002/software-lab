/* Joe's Lotto — conservative, local draw-ticket extraction and comparison.
 * No barcode-validation endpoints, ticket credentials, network calls, or OCR text
 * are retained here. Published numbers support a potential match only, never an
 * official ticket verification. Every OCR record requires explicit user review.
 * Rules checked 2026-10-28 against:
 * https://www.powerball.com/ (matrix and Power Play; 5+0 always $2m with PP)
 * https://www.megamillions.com/How-to-Play.aspx (per-play multiplier since 2025-04-08)
 * https://www.ohiolottery.com/getattachment/861e19a9-7e71-4597-8a3a-f2a7a66d4571/New_Mega-Millions.pdf?lang=en-US
 * https://www.ohiolottery.com/games/draw-games/classic-lotto
 * https://www.ohiolottery.com/games/draw-games/rolling-cash-5
 * https://www.ohiolottery.com/getattachment/56f1ee36-1789-46eb-9abf-d83744b6b8fe/827_GameRule.pdf?lang=en-US
 * (Kicker activates one six-digit number per ticket; FIRST digits left to right.)
 * https://www.ohiolottery.com/getattachment/97e70279-fb31-48e7-a6a6-f88190f752eb/October-2017-OHIO-Lottery-Terminal-Manual.pdf?lang=en-US
 * Amounts are deliberately withheld for jackpots, unconfirmed add-ons, unsupported
 * historical rule periods and play types whose published payout was not verified.
 */
(() => {
  'use strict';
  const GAMES = Object.freeze({
    Powerball: { count: 5, max: 69, bonus: 26, since: '2015-10-07' },
    'Mega Millions': { count: 5, max: 70, bonus: 25, since: '2017-10-31' },
    'Classic Lotto': { count: 6, max: 49, since: '2007-01-22' },
    'Rolling Cash 5': { count: 5, max: 39, since: '2004-10-04' },
    'Pick 3': { count: 3, max: 9, digits: true, since: '2010-01-01' },
    'Pick 4': { count: 4, max: 9, digits: true, since: '2010-01-01' },
    'Pick 5': { count: 5, max: 9, digits: true, since: '2012-08-12' },
    'Lucky for Life': { count: 5, max: 48, bonus: 18, since: '2015-11-16', until: '2026-02-21' },
    KENO: { count: null, max: 80 },
  });
  const ALIASES = new Map(Object.keys(GAMES).map(name => [name.toLowerCase().replace(/[^a-z0-9]/g, ''), name]));
  ALIASES.set('rollingcashfive', 'Rolling Cash 5');
  const TITLES = [
    ['Powerball', /\bpower\s*ball\b/i], ['Mega Millions', /\bmega\s*millions\b/i],
    ['Classic Lotto', /\bclassic\s*lotto\b/i], ['Rolling Cash 5', /\brolling\s*cash\s*(?:5|five)\b/i],
    ['Pick 3', /\bpick\s*3\b/i], ['Pick 4', /\bpick\s*4\b/i], ['Pick 5', /\bpick\s*5\b/i],
    ['Lucky for Life', /\blucky\s*for\s*life\b/i], ['KENO', /\bkeno\b/i],
  ];
  const TYPES = new Set(['straight', 'box', 'straight-box', 'wheel', 'front-pair', 'back-pair', 'split-pair', 'front-three', 'back-three', 'front-four', 'back-four']);
  const RULE_URLS = Object.freeze({
    Powerball: 'https://www.powerball.com/',
    'Mega Millions': 'https://www.megamillions.com/How-to-Play.aspx',
    'Classic Lotto': 'https://www.ohiolottery.com/games/draw-games/classic-lotto',
    'Rolling Cash 5': 'https://www.ohiolottery.com/games/draw-games/rolling-cash-5',
    'Pick 3': 'https://www.ohiolottery.com/games/draw-games/pick-3',
    'Pick 4': 'https://www.ohiolottery.com/games/draw-games/pick-4',
    'Pick 5': 'https://www.ohiolottery.com/games/draw-games/pick-5',
    'Lucky for Life': 'https://www.ohiolottery.com/games/draw-games/lucky-for-life',
  });
  function canonicalGame(value) {
    return typeof value === 'string' ? ALIASES.get(value.toLowerCase().replace(/[^a-z0-9]/g, '')) || null : null;
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T12:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function isoDate(year, month, day) {
    const value = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return validDate(value) ? value : null;
  }
  function integer(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
  function ownObject(value) { return value && typeof value === 'object' && !Array.isArray(value); }
  function numbersValid(numbers, game, date = null) {
    const spec = GAMES[game];
    if (!spec || !Array.isArray(numbers) || numbers.length > 20) return false;
    if (game === 'KENO') return numbers.length > 0 && numbers.every(n => integer(n, 1, 80)) && new Set(numbers).size === numbers.length;
    if (numbers.length !== spec.count || !numbers.every(n => integer(n, spec.digits ? 0 : 1, spec.max))) return false;
    return spec.digits || new Set(numbers).size === numbers.length;
  }
  function bonusValid(bonus, game, dates = []) {
    const spec = GAMES[game];
    const max = game === 'Mega Millions' && dates.length && dates.some(date => date >= '2025-04-08') ? 24 : spec?.bonus;
    return !spec?.bonus ? bonus === null : bonus === null || integer(bonus, 1, max);
  }
  function session(value) {
    if (value === null || value === undefined || value === '') return null;
    return typeof value === 'string' && /^(midday|evening)$/i.test(value) ? value.toLowerCase() : false;
  }
  function needs(record) {
    const reasons = [];
    if (!record.game) reasons.push('game-needed');
    if (record.jurisdiction !== 'OH') reasons.push('ohio-jurisdiction-needs-review');
    if (record.game === 'KENO') reasons.push('game-comparison-not-supported');
    if (!record.drawDates.length) reasons.push('draw-date-needed');
    if (record.dateRangeUnresolved) reasons.push('draw-date-range-needs-review');
    if (/^Pick /.test(record.game || '') && !record.session) reasons.push('draw-session-needed');
    if (!record.plays.length) reasons.push('played-numbers-needed');
    if (record.incompletePlays) reasons.push('unread-play-needs-review');
    if (record.declaredPlayCount !== null && record.declaredPlayCount !== record.plays.length) reasons.push('play-count-conflict');
    if (record.declaredDrawCount !== null && record.declaredDrawCount !== record.drawDates.length) reasons.push('draw-count-conflict');
    if (record.unsupportedOption) reasons.push('unsupported-option-needs-review');
    if (record.game && GAMES[record.game]?.bonus && record.plays.some(play => play.bonus === null)) reasons.push('bonus-number-needed');
    if (/^Pick /.test(record.game || '') && record.plays.some(play => !play.playType)) reasons.push('play-type-needed');
    if (/^Pick /.test(record.game || '') && record.plays.some(play => play.stakeCents === null)) reasons.push('stake-needed');
    return reasons;
  }
  // Returns a sanitized partial record or null for malformed data. Unknown keys,
  // raw ticket text, serials, image bytes and claimed verification are discarded.
  function validate(input) {
    if (!ownObject(input)) return null;
    const game = canonicalGame(input.game);
    if (input.game != null && input.game !== '' && !game) return null;
    const dates = input.drawDates ?? (input.drawDate ? [input.drawDate] : []);
    if (!Array.isArray(dates) || dates.length > 52 || dates.some(date => !validDate(date)) || new Set(dates).size !== dates.length) return null;
    const drawSession = session(input.session);
    if (drawSession === false) return null;
    const inputPlays = input.plays ?? [];
    if (!Array.isArray(inputPlays) || inputPlays.length > 30 || (!game && inputPlays.length)) return null;
    const plays = [];
    for (let index = 0; index < inputPlays.length; index += 1) {
      const play = inputPlays[index];
      if (!ownObject(play) || !numbersValid(play.numbers, game)) return null;
      const bonus = play.bonus ?? null;
      const multiplier = play.multiplier ?? null;
      const stakeCents = play.stakeCents ?? null;
      const playType = play.playType ?? null;
      if (!bonusValid(bonus, game, dates) || (multiplier !== null && ![2, 3, 4, 5, 10].includes(multiplier))) return null;
      if (stakeCents !== null && !integer(stakeCents, 1, 100000)) return null;
      if (playType !== null && !TYPES.has(playType)) return null;
      if (play.label !== undefined && (typeof play.label !== 'string' || !/^[A-Z0-9][A-Z0-9 .-]{0,11}$/i.test(play.label))) return null;
      plays.push({ label: play.label || String(index + 1), numbers: play.numbers.slice(), bonus, multiplier, stakeCents, playType });
    }
    if (new Set(plays.map(play => play.label.toUpperCase())).size !== plays.length) return null;
    const kickerNumbers = input.kickerNumbers ?? null;
    if (kickerNumbers !== null && (!Array.isArray(kickerNumbers) || kickerNumbers.length !== 6 || !kickerNumbers.every(n => integer(n, 0, 9)) || game !== 'Classic Lotto')) return null;
    if (input.jurisdiction != null && input.jurisdiction !== 'OH') return null;
    const record = { game, jurisdiction: input.jurisdiction === 'OH' ? 'OH' : null, drawDates: dates.slice().sort(), session: drawSession, plays, kickerNumbers: kickerNumbers?.slice() || null };
    for (const flag of ['powerPlay', 'megaplier', 'kicker', 'doublePlay']) {
      if (input[flag] != null && typeof input[flag] !== 'boolean') return null;
      record[flag] = input[flag] ?? null;
    }
    for (const count of ['declaredPlayCount', 'declaredDrawCount']) {
      if (input[count] != null && !integer(input[count], 1, count === 'declaredPlayCount' ? 30 : 52)) return null;
      record[count] = input[count] ?? null;
    }
    if (input.totalPriceCents != null && !integer(input.totalPriceCents, 1, 10000000)) return null;
    record.totalPriceCents = input.totalPriceCents ?? null;
    record.numberOfPlays = plays.length;
    for (const flag of ['incompletePlays', 'dateRangeUnresolved', 'unsupportedOption']) {
      if (input[flag] !== undefined && typeof input[flag] !== 'boolean') return null;
      record[flag] = input[flag] === true;
    }
    record.unsupportedOption ||= record.powerPlay === true && game !== 'Powerball' || record.doublePlay === true && game !== 'Powerball' || record.megaplier === true && game !== 'Mega Millions' || record.kicker === true && game !== 'Classic Lotto';
    record.source = input.source === 'manual' ? 'manual' : 'printed-text';
    record.reviewed = input.reviewed === true;
    record.confirmationRequired = !record.reviewed;
    record.needsReview = needs(record);
    return record;
  }
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function datesIn(value) {
    const dates = new Set();
    for (const found of value.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
      const date = isoDate(found[1], found[2], found[3]); if (date) dates.add(date);
    }
    for (const found of value.matchAll(/\b(\d{1,2})[/-](\d{1,2})[/-](20\d{2}|\d{2})\b/g)) {
      const date = isoDate(found[3].length === 2 ? `20${found[3]}` : found[3], found[1], found[2]); if (date) dates.add(date);
    }
    for (const found of value.matchAll(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:,)?\s+(20\d{2})\b/gi)) {
      const date = isoDate(found[3], MONTHS[found[1].slice(0, 3).toLowerCase()], found[2]); if (date) dates.add(date);
    }
    return [...dates];
  }
  function cents(value) {
    const found = value.match(/\$\s*(\d{1,5})(?:\.(\d{1,2}))?(?![\d.])/);
    if (!found) return null;
    const amount = Number(found[1]) * 100 + Number((found[2] || '').padEnd(2, '0'));
    return integer(amount, 1, 10000000) ? amount : null;
  }
  function explicitFlag(text, label) {
    const values = new Set();
    const pattern = new RegExp(`\\b${label}\\s*(?::|=)?\\s*(YES|NO|Y|N|ON|OFF)\\b`, 'gi');
    for (const found of text.matchAll(pattern)) values.add(/^(yes|y|on)$/i.test(found[1]));
    return values.size === 1 ? [...values][0] : null;
  }
  function explicitCount(text, label) {
    const values = new Set();
    for (const found of text.matchAll(new RegExp(`\\b(?:number\\s+of\\s+)?${label}\\s*(?::|=)\\s*(\\d{1,2})(?!\\d)`, 'gi'))) values.add(Number(found[1]));
    return values.size === 1 ? [...values][0] : null;
  }
  function playTypeOf(value) {
    const normalized = value.toLowerCase().replace(/[ _/]+/g, '-');
    if (/\b(?:straight-box|back-up|backup)\b/.test(normalized)) return 'straight-box';
    for (const type of ['front-four', 'back-four', 'front-three', 'back-three', 'front-pair', 'back-pair', 'split-pair', 'straight', 'box', 'wheel']) if (new RegExp(`\\b${type}\\b`).test(normalized)) return type;
    return null;
  }
  function parsePlay(raw, game, label, dates) {
    const spec = GAMES[game];
    let text = raw.trim().replace(/\b(?:AP|QP|AUTO\s*PICK|QUICK\s*PICK)\b/gi, '').trim();
    let multiplier = null;
    const multipliers = [...text.matchAll(/\b(?:MULTIPLIER\s*[:=]?\s*)?(2|3|4|5|10)\s*X\b/gi)];
    if (multipliers.length > 1 && new Set(multipliers.map(found => found[1])).size > 1) return null;
    if (multipliers.length) { multiplier = Number(multipliers[0][1]); text = text.replace(/\b(?:MULTIPLIER\s*[:=]?\s*)?(?:2|3|4|5|10)\s*X\b/gi, ' '); }
    const stakeCents = spec.digits ? cents(text) : null;
    const playType = spec.digits ? playTypeOf(text) : null;
    if (spec.digits) {
      const numberPart = text.replace(/\$\s*\d+(?:\.\d{1,2})?/g, '').replace(/\b\d{1,3}[- ]?WAY\b/gi, '');
      const candidate = numberPart.match(/^\s*(\d(?:[ -]?\d){2,4})(?!\d)/);
      if (!candidate) return null;
      const digits = candidate[1].replace(/[ -]/g, '');
      if (digits.length !== spec.count) return null;
      const suffix = numberPart.slice(candidate[0].length).trim();
      if (suffix && !/^(?:(?:STRAIGHT|BOX|WHEEL|BACK[- ]?UP|FRONT[- ]?(?:PAIR|THREE|FOUR)|BACK[- ]?(?:PAIR|THREE|FOUR)|SPLIT[- ]?PAIR)[ /-]*)+$/i.test(suffix)) return null;
      return { label, numbers: [...digits].map(Number), bonus: null, multiplier: null, stakeCents, playType };
    }
    if (!spec.count) return null;
    text = text.replace(/\b(?:PB|POWER\s*BALL|MB|MEGA\s*BALL|LB|LUCKY\s*BALL)\s*[:=]?/gi, ' ');
    if (!/^[\d\s,-]+$/.test(text)) return null;
    const tokens = text.trim().split(/[\s,-]+/).filter(Boolean);
    if (tokens.some(token => !/^\d{1,2}$/.test(token))) return null;
    const values = tokens.map(Number);
    if (values.length !== spec.count + (spec.bonus ? 1 : 0)) return null;
    const numbers = values.slice(0, spec.count);
    const bonus = spec.bonus ? values[spec.count] : null;
    if (!numbersValid(numbers, game) || !bonusValid(bonus, game, dates)) return null;
    return { label, numbers, bonus, multiplier, stakeCents, playType };
  }
  function parse(ocrText) {
    const empty = { game: null, drawDates: [], session: null, plays: [], reviewed: false };
    if (typeof ocrText !== 'string' || !ocrText.trim() || ocrText.length > 40000) return validate(empty);
    // NFKC changes character width, never confusable letters into numeric digits.
    const text = ocrText.normalize('NFKC').replace(/[®™]/g, '');
    const games = TITLES.filter(([, expression]) => expression.test(text)).map(([game]) => game);
    if (games.length !== 1) return validate(empty);
    const game = games[0];
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const dateSet = new Set();
    let dateRangeUnresolved = false;
    let dateContext = false;
    for (const line of lines) {
      const drawLabel = /\b(?:DRAW(?:ING)?\s*(?:DATE|DATES)?|FOR\s+(?:THE\s+)?DRAW(?:ING)?)\s*(?::|=|ON\b)?/i.test(line);
      if (drawLabel || dateContext) {
        const dates = datesIn(line);
        for (const date of dates) dateSet.add(date);
        if (dates.length > 1 && /\b(?:THRU|THROUGH|TO)\b|\s[-–—]\s/i.test(line)) dateRangeUnresolved = true;
        dateContext = drawLabel && !dates.length && /(?:DATE|DATES)\s*[:=]?\s*$/i.test(line);
      } else dateContext = false;
    }
    const drawDates = [...dateSet].sort();
    const sessions = new Set();
    if (/\b(?:MIDDAY|MID\s*DAY)\b/i.test(text)) sessions.add('midday');
    if (/\b(?:EVENING|EVE)\b/i.test(text)) sessions.add('evening');
    const plays = [];
    let incompletePlays = false;
    for (const line of lines) {
      // Labelled rows only: purchase time, total price, serial and draw numbers
      // in arbitrary prose cannot become a ticket's played numbers.
      const found = line.match(/^(?:([A-Z])[.)\s:]\s*|(?:PLAY|BOARD|LINE)\s*([A-Z]|\d{1,2})\s*[:.)-]?\s*|(?:PLAYED\s+)?NUMBERS\s*[:=]\s*)(.+)$/i);
      if (!found) continue;
      const label = (found[1] || found[2] || String(plays.length + 1)).toUpperCase();
      const play = parsePlay(found[3], game, label, drawDates);
      if (play && !plays.some(old => old.label === play.label)) plays.push(play); else incompletePlays = true;
    }
    const totals = new Set();
    for (const line of lines) if (/^\s*(?:TOTAL(?:\s+(?:COST|PRICE|WAGER))?|TICKET\s+COST)\s*[:=]?\s*\$/i.test(line)) { const amount = cents(line); if (amount !== null) totals.add(amount); }
    const kickerCandidates = new Map();
    for (const line of lines) {
      const found = line.match(/^KICKER\s*(?:(?:NUMBER|NUMBERS|NO\.?)\s*)?[:#=]\s*(\d(?:[ -]?\d){5})(?:\s+(?:YES|NO))?$/i);
      if (found) { const values = [...found[1].replace(/[ -]/g, '')].map(Number); kickerCandidates.set(values.join(''), values); }
    }
    const input = {
      game, jurisdiction: /\bohio\s*(?:lottery|lotto)\b/i.test(text) ? 'OH' : null, drawDates, session: sessions.size === 1 ? [...sessions][0] : null, plays,
      powerPlay: explicitFlag(text, 'POWER\\s*PLAY'), megaplier: explicitFlag(text, 'MEGAPLIER'),
      kicker: explicitFlag(text, 'KICKER'), doublePlay: explicitFlag(text, 'DOUBLE\\s*PLAY'),
      declaredPlayCount: explicitCount(text, '(?:PLAYS|BOARDS)'), declaredDrawCount: explicitCount(text, 'DRAWS'),
      kickerNumbers: game === 'Classic Lotto' && kickerCandidates.size === 1 ? [...kickerCandidates.values()][0] : null,
      totalPriceCents: totals.size === 1 ? [...totals][0] : null,
      incompletePlays, dateRangeUnresolved, unsupportedOption: sessions.size > 1 || /\b(?:EZ\s*MATCH|FIRE\s*BALL|BOOSTER)\b/i.test(text), reviewed: false, source: 'printed-text',
    };
    return validate(input) || validate({ ...empty, game, incompletePlays: true });
  }
  function isOfficialURL(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && ['www.ohiolottery.com', 'ohiolottery.com'].includes(url.hostname) && !url.username && !url.password; } catch { return false; }
  }
  function isOfficialDataURL(value, game, date) {
    const names = { 'Classic Lotto': 'ClassicLotto', 'Rolling Cash 5': 'RollingCashFive' };
    try {
      const url = new URL(value);
      const apiDate = `${date.slice(5, 7)}-${date.slice(8, 10)}-${date.slice(0, 4)}`;
      return url.protocol === 'https:' && url.hostname === 'api-solutions.ohiolottery.com' && url.pathname === `/1.0/Games/DrawGames/${names[game]}/SearchDrawDateRange` && url.searchParams.get('sinceDate') === apiDate && url.searchParams.get('toDate') === apiDate && !url.username && !url.password;
    } catch { return false; }
  }
  function normalizedResult(input, game) {
    if (!ownObject(input) || input.official !== true || input.approved === false || input.stale === true || canonicalGame(input.game) !== game || !validDate(input.drawDate) || !isOfficialURL(input.sourceURL)) return null;
    const drawSession = session(input.session);
    if (drawSession === false || (!/^Pick /.test(game) && drawSession !== null) || !numbersValid(input.numbers, game, input.drawDate)) return null;
    const bonus = input.bonus ?? null;
    if (!bonusValid(bonus, game, [input.drawDate]) || (GAMES[game]?.bonus && bonus === null)) return null;
    const multiplier = input.multiplier ?? null;
    if (multiplier !== null && ![2, 3, 4, 5, 10].includes(multiplier)) return null;
    const kicker = Array.isArray(input.kicker) && input.kicker.length === 6 && input.kicker.every(n => integer(n, 0, 9)) ? input.kicker.slice() : null;
    const prizes = Array.isArray(input.prizes) ? input.prizes.slice(0, 10).filter(prize => ownObject(prize) && integer(prize.matchCount, 2, 5) && prize.bonusMatch === false && integer(prize.potentialCents, 1, 100000000) && isOfficialDataURL(prize.sourceURL, game, input.drawDate)).map(prize => ({ matchCount: prize.matchCount, potentialCents: prize.potentialCents })) : [];
    return { game, drawDate: input.drawDate, session: drawSession, numbers: input.numbers.slice(), bonus, multiplier, kicker, prizes, sourceURL: input.sourceURL };
  }
  function isPublishedResult(input, request) {
    const game = canonicalGame(request?.game);
    if (!game || game === 'KENO' || !validDate(request?.drawDate) || input?.approved !== true) return false;
    const definition = GAMES[game];
    if (request.drawDate < definition.since || definition.until && request.drawDate > definition.until) return false;
    const result = normalizedResult(input, game);
    if (!result || result.drawDate !== request.drawDate) return false;
    return /^Pick /.test(game) ? ['midday', 'evening'].includes(request.session) && result.session === request.session : result.session === null;
  }
  function outcome(winning, amount, reason, extra = {}) { return { winning, potentialCents: amount, reason, ...extra }; }
  function evaluate(play, record, result) {
    const matchedNumbers = GAMES[record.game].digits
      ? play.numbers.filter((number, index) => number === result.numbers[index])
      : play.numbers.filter(number => result.numbers.includes(number));
    const matchCount = matchedNumbers.length;
    const bonusMatched = play.bonus !== null && play.bonus === result.bonus;
    const extra = { matchedNumbers, matchCount, bonusMatched, jackpot: false };
    const spec = GAMES[record.game];
    if (result.drawDate < spec.since || (spec.until && result.drawDate > spec.until)) return outcome(null, null, 'historical-rules-not-supported', extra);
    if (record.game === 'Powerball') {
      if (matchCount === 5 && bonusMatched) return outcome(true, null, 'jackpot-needs-official-validation', { ...extra, jackpot: true });
      const dollars = bonusMatched ? [4, 4, 7, 100, 50000][matchCount] : ({ 3: 7, 4: 100, 5: 1000000 }[matchCount] || 0);
      if (!dollars) return outcome(false, 0, 'no-base-prize-match', extra);
      if (record.powerPlay === null) return outcome(true, null, 'power-play-choice-needed-for-amount', extra);
      if (!record.powerPlay) return outcome(true, dollars * 100, 'fixed-prize-before-official-validation', extra);
      if (matchCount === 5) return outcome(true, 200000000, 'power-play-match-five-fixed-prize', extra);
      return result.multiplier === null ? outcome(true, null, 'official-power-play-multiplier-needed', extra) : outcome(true, dollars * result.multiplier * 100, 'power-play-prize-before-official-validation', extra);
    }
    if (record.game === 'Mega Millions') {
      if (matchCount === 5 && bonusMatched) return outcome(true, null, 'jackpot-needs-official-validation', { ...extra, jackpot: true });
      const modern = result.drawDate >= '2025-04-08';
      if (modern && record.megaplier === true) return outcome(null, null, 'legacy-megaplier-option-on-modern-ticket', extra);
      const dollars = modern
        ? (bonusMatched ? [5, 7, 10, 200, 10000][matchCount] : ({ 3: 10, 4: 500, 5: 1000000 }[matchCount] || 0))
        : (bonusMatched ? [2, 4, 10, 200, 10000][matchCount] : ({ 3: 10, 4: 500, 5: 1000000 }[matchCount] || 0));
      if (!dollars) return outcome(false, 0, 'no-base-prize-match', extra);
      // Since April 8 the multiplier belongs to each purchased play. A draw's
      // multiplier/sentinel must never substitute for the printed multiplier.
      if (modern) return play.multiplier === null ? outcome(true, null, 'printed-per-play-multiplier-needed', extra) : outcome(true, dollars * play.multiplier * 100, 'per-play-multiplied-prize-before-official-validation', extra);
      if (record.megaplier === null) return outcome(true, null, 'megaplier-choice-needed-for-amount', extra);
      if (!record.megaplier) return outcome(true, dollars * 100, 'legacy-fixed-prize-before-official-validation', extra);
      if (result.multiplier === null) return outcome(true, null, 'official-megaplier-needed', extra);
      return outcome(true, dollars * result.multiplier * 100, 'legacy-megaplier-prize-before-official-validation', extra);
    }
    if (record.game === 'Classic Lotto') {
      if (matchCount === 6) return outcome(true, null, 'jackpot-needs-official-validation', { ...extra, jackpot: true });
      const tiers = result.prizes.filter(prize => prize.matchCount === matchCount);
      const amount = tiers.length === 1 ? tiers[0].potentialCents : null;
      return outcome(matchCount >= 3, matchCount < 3 ? 0 : amount, matchCount >= 3 ? amount === null ? 'prize-match-amount-needs-official-review' : 'dated-published-prize-before-validation' : 'no-base-prize-match', extra);
    }
    if (record.game === 'Rolling Cash 5') {
      if (matchCount === 5) return outcome(true, null, 'jackpot-needs-official-validation', { ...extra, jackpot: true });
      const tiers = result.prizes.filter(prize => prize.matchCount === matchCount);
      const amount = tiers.length === 1 ? tiers[0].potentialCents : null;
      return outcome(matchCount >= 2, matchCount < 2 ? 0 : amount, matchCount >= 2 ? amount === null ? 'prize-match-amount-needs-official-review' : 'dated-published-prize-before-validation' : 'no-base-prize-match', extra);
    }
    if (record.game === 'Lucky for Life') {
      const winning = bonusMatched || matchCount >= 2;
      return outcome(winning, winning ? null : 0, winning ? 'legacy-prize-match-needs-official-review' : 'no-base-prize-match', { ...extra, jackpot: matchCount === 5 });
    }
    if (spec.digits) {
      if (!['straight', 'box'].includes(play.playType)) return outcome(null, null, 'play-type-comparison-not-supported', extra);
      if (![50, 100].includes(play.stakeCents)) return outcome(null, null, 'stake-comparison-not-supported', extra);
      const sameOrder = play.numbers.every((number, index) => number === result.numbers[index]);
      const sameBag = play.numbers.slice().sort().join('') === result.numbers.slice().sort().join('');
      const winning = play.playType === 'straight' ? sameOrder : sameBag;
      // A box with all identical digits is not a valid box purchase.
      if (play.playType === 'box' && new Set(play.numbers).size === 1) return outcome(null, null, 'invalid-box-selection', extra);
      return outcome(winning, winning ? null : 0, winning ? 'prize-match-amount-needs-official-review' : 'no-prize-match', { ...extra, sameOrder, matchedNumbers: play.numbers.filter((number, index) => number === result.numbers[index]) });
    }
    return outcome(null, null, 'game-comparison-not-supported', extra);
  }
  function evaluateKicker(record, result) {
    const extra = { playIndex: null, label: 'Kicker', matchedNumbers: [], matchCount: 0, bonusMatched: false, jackpot: false, option: 'kicker' };
    if (result.drawDate < '2025-01-01') return outcome(null, null, 'historical-kicker-rules-need-review', extra);
    if (!record.kickerNumbers || !result.kicker) return outcome(null, null, 'kicker-numbers-needed', extra);
    let count = 0;
    while (count < 6 && record.kickerNumbers[count] === result.kicker[count]) count += 1;
    const amount = ({ 2: 1000, 3: 10000, 4: 100000, 5: 500000, 6: 10000000 })[count] || 0;
    return outcome(count >= 2, amount, count >= 2 ? 'kicker-first-digits-potential-prize' : 'no-kicker-prize-match', { ...extra, matchedNumbers: record.kickerNumbers.slice(0, count), matchCount: count });
  }
  function compare(ticketDraw, officialResult) {
    const record = validate(ticketDraw);
    const base = { status: 'pending', officiallyVerified: false, potentialCents: null, reason: 'ticket-details-needed', details: [], sourceURLs: [], ruleURL: record?.game ? RULE_URLS[record.game] || null : null, partial: false };
    if (!record) return { ...base, reason: 'invalid-ticket-details' };
    if (!record.reviewed) return { ...base, reason: 'review-ticket-details-first' };
    if (record.needsReview.length) return { ...base, reason: record.needsReview[0], needsReview: record.needsReview };
    if (record.game === 'KENO') return { ...base, reason: 'game-comparison-not-supported' };
    if (!Array.isArray(officialResult) && officialResult && (officialResult.stale === true || officialResult.status && officialResult.status !== 'fresh')) return { ...base, reason: 'official-results-unavailable' };
    const inputs = Array.isArray(officialResult) ? officialResult : Array.isArray(officialResult?.records) ? officialResult.records : officialResult ? [officialResult] : [];
    const results = inputs.slice(0, 110).map(input => normalizedResult(input, record.game)).filter(Boolean);
    const details = [];
    const sources = new Set();
    let missing = false;
    for (const date of record.drawDates) {
      const eligible = results.filter(result => result.drawDate === date && (!/^Pick /.test(record.game) || result.session === record.session));
      if (!eligible.length) { missing = true; continue; }
      const signatures = new Set(eligible.map(result => JSON.stringify([result.numbers, result.bonus, result.multiplier, result.kicker, result.prizes])));
      if (signatures.size > 1) { missing = true; continue; }
      const result = eligible[0]; sources.add(result.sourceURL);
      for (let index = 0; index < record.plays.length; index += 1) details.push({ drawDate: date, session: result.session, playIndex: index, label: record.plays[index].label, ...evaluate(record.plays[index], record, result) });
      if (record.game === 'Classic Lotto' && record.kicker === true) details.push({ drawDate: date, session: null, ...evaluateKicker(record, result) });
    }
    const addOnUnchecked = record.game === 'Classic Lotto' && record.kicker === null || record.game === 'Powerball' && record.doublePlay === true;
    const incomplete = missing || details.some(detail => detail.winning === null) || addOnUnchecked;
    const winners = details.filter(detail => detail.winning === true);
    const totalKnown = !incomplete && details.every(detail => detail.potentialCents !== null);
    const total = totalKnown ? details.reduce((sum, detail) => sum + detail.potentialCents, 0) : null;
    if (winners.length) return { ...base, status: 'potential-winner', potentialCents: total, reason: incomplete ? 'potential-match-with-unchecked-draws-or-options' : total === null ? 'potential-match-amount-needs-review' : 'potential-prize-match', details, sourceURLs: [...sources], partial: incomplete };
    if (incomplete || !details.length) return { ...base, reason: missing ? 'official-results-not-available-for-every-draw' : addOnUnchecked ? 'add-on-needs-official-check' : details.find(detail => detail.winning === null)?.reason || 'official-results-unavailable', details, sourceURLs: [...sources], partial: details.length > 0 };
    return { ...base, status: 'potential-loser', potentialCents: 0, reason: 'no-prize-match-in-reviewed-draws', details, sourceURLs: [...sources], partial: false };
  }
  window.JoeDrawTicket = Object.freeze({ parse, validate, compare, isPublishedResult, canonicalGame, games: Object.freeze(Object.keys(GAMES)), ruleURLs: RULE_URLS });
})();
