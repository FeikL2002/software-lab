/* Official Ohio drawing snapshot + transparent recent-results-inspired random picks. */
(function (global) {
  'use strict';
  const RULES = Object.freeze({
    'Pick 3': { digits: 3, min: 0, max: 9 },
    'Pick 4': { digits: 4, min: 0, max: 9 },
    'Pick 5': { digits: 5, min: 0, max: 9 },
    'Powerball': { mainCount: 5, min: 1, max: 69, bonusMax: 26 },
    'Mega Millions': { mainCount: 5, min: 1, max: 70, bonusMax: 24 }
  });
  const METHOD = 'Recent Ohio results · frequency-inspired random';
  const EXPLANATION = 'Each possible number starts with weight 1. Occurrences in this saved official result window add weight. Pick digits use their own position; white balls are sampled without replacement and the bonus ball separately. Past results do not predict future draws or improve winning odds.';
  let snapshot = null;
  let pending = null;
  let lastError = '';

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function validSource(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'https:' && (parsed.hostname === 'www.ohiolottery.com' || parsed.hostname === 'api-solutions.ohiolottery.com');
    } catch (_) { return false; }
  }
  function normalize(payload) {
    if (!payload || payload.schemaVersion !== 1 || !validDate(payload.asOf) || !validSource(payload.source && payload.source.url)) {
      throw new Error('The saved Ohio drawing data could not be verified. Try the official results link.');
    }
    const data = { schemaVersion: 1, asOf: payload.asOf, timezone: 'America/New_York', source: payload.source, method: EXPLANATION, games: {} };
    Object.keys(RULES).forEach(function (game) {
      const rule = RULES[game];
      const entry = payload.games && payload.games[game];
      const unavailable = { available: false, count: 0, reason: 'Verified recent Ohio results are unavailable for ' + game + '.' };
      if (!entry || entry.available !== true || !Array.isArray(entry.draws) || !entry.draws.length || entry.draws.length !== entry.count) {
        data.games[game] = unavailable; return;
      }
      const seen = new Set();
      let valid = true;
      const rows = entry.draws.map(function (row) {
        if (!row || !validDate(row.drawDate) || row.drawDate > data.asOf || !['Midday', 'Evening'].includes(row.session) || !validSource(row.sourceURL)) {
          valid = false; return null;
        }
        const key = row.drawDate + ':' + row.session;
        if (seen.has(key)) valid = false;
        seen.add(key);
        const nums = row.nums;
        if (!Array.isArray(nums) || nums.length !== (rule.digits || rule.mainCount) || nums.some(function (n) { return !Number.isInteger(n) || n < rule.min || n > rule.max; })) {
          valid = false; return null;
        }
        if (rule.digits ? row.bonus !== null : (new Set(nums).size !== 5 || !Number.isInteger(row.bonus) || row.bonus < 1 || row.bonus > rule.bonusMax || row.session !== 'Evening')) valid = false;
        return { drawDate: row.drawDate, session: row.session, nums: nums.slice(), bonus: row.bonus, sourceURL: row.sourceURL, officialDrawId: row.officialDrawId || null };
      });
      if (!valid) { data.games[game] = unavailable; return; }
      rows.sort(function (a, b) { return b.drawDate.localeCompare(a.drawDate) || Number(b.session === 'Evening') - Number(a.session === 'Evening'); });
      if (entry.windowStart !== rows[rows.length - 1].drawDate || entry.windowEnd !== rows[0].drawDate) { data.games[game] = unavailable; return; }
      data.games[game] = { available: true, count: rows.length, windowStart: entry.windowStart, windowEnd: entry.windowEnd, sessions: rule.digits ? ['Midday', 'Evening'] : ['Evening'], rules: Object.assign({}, rule), draws: rows };
    });
    return data;
  }
  function ready() {
    if (snapshot) return Promise.resolve(snapshot);
    if (!pending) {
      pending = fetch('./data/ohio-recent-draws.json', { cache: 'no-cache' })
        .then(function (response) { if (!response.ok) throw new Error('Official Ohio drawing snapshot is unavailable right now.'); return response.json(); })
        .then(function (payload) { snapshot = normalize(payload); lastError = ''; return snapshot; })
        .catch(function (error) { pending = null; lastError = error.message || 'Official Ohio drawing snapshot is unavailable right now.'; throw error; });
    }
    return pending;
  }
  function info(game) {
    const entry = snapshot && snapshot.games[game];
    if (!entry) return { available: false, count: 0, reason: RULES[game] ? (lastError || 'Loading verified Ohio drawing results…') : 'This game is not supported.', asOf: snapshot ? snapshot.asOf : null };
    return {
      available: entry.available, count: entry.count, sourceRows: entry.count,
      reason: entry.reason || '', windowStart: entry.windowStart || null, windowEnd: entry.windowEnd || null,
      asOf: snapshot.asOf, source: snapshot.source, sessions: entry.sessions || [],
      rules: entry.rules || RULES[game], method: METHOD, methodDescription: EXPLANATION
    };
  }
  function randomInt(max) {
    if (!Number.isSafeInteger(max) || max <= 0 || max > 4294967296 || !global.crypto || typeof global.crypto.getRandomValues !== 'function') {
      throw new Error('Secure random selection is unavailable in this browser.');
    }
    const values = new Uint32Array(1);
    const ceiling = Math.floor(4294967296 / max) * max;
    do { global.crypto.getRandomValues(values); } while (values[0] >= ceiling);
    return values[0] % max;
  }
  function weightedChoice(pool, weights) {
    const total = pool.reduce(function (sum, n) { return sum + weights[n]; }, 0);
    let cursor = randomInt(total);
    for (let i = 0; i < pool.length; i++) {
      cursor -= weights[pool[i]];
      if (cursor < 0) return pool[i];
    }
    throw new Error('Unable to select a number.');
  }
  function generate(game) {
    const meta = info(game);
    if (!meta.available) throw new Error(meta.reason);
    const rule = RULES[game];
    const rows = snapshot.games[game].draws;
    let nums, bonus = null;
    if (rule.digits) {
      nums = Array.from({ length: rule.digits }, function (_, position) {
        const weights = Array(10).fill(1);
        rows.forEach(function (row) { weights[row.nums[position]] += 1; });
        return weightedChoice(Array.from({ length: 10 }, function (_, i) { return i; }), weights);
      });
    } else {
      const pool = Array.from({ length: rule.max }, function (_, i) { return i + 1; });
      const weights = Array(rule.max + 1).fill(1);
      rows.forEach(function (row) { row.nums.forEach(function (n) { weights[n] += 1; }); });
      nums = [];
      for (let i = 0; i < rule.mainCount; i++) {
        const n = weightedChoice(pool, weights);
        nums.push(n); pool.splice(pool.indexOf(n), 1);
      }
      nums.sort(function (a, b) { return a - b; });
      const bonusWeights = Array(rule.bonusMax + 1).fill(1);
      rows.forEach(function (row) { bonusWeights[row.bonus] += 1; });
      bonus = weightedChoice(Array.from({ length: rule.bonusMax }, function (_, i) { return i + 1; }), bonusWeights);
    }
    return {
      game: game, nums: nums, bonus: bonus, sourceRows: rows.length,
      method: METHOD, methodDescription: EXPLANATION, asOf: meta.asOf,
      windowStart: meta.windowStart, windowEnd: meta.windowEnd,
      source: meta.source
    };
  }
  global.JoeRecentPicks = Object.freeze({ ready: ready, generate: generate, info: info });
})(window);
