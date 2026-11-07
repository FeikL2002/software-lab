/* Joe's Lotto: locally matched official Ohio Lottery game catalog.
 * Unit-price lookup only. A game UPC is shared by every ticket of that game;
 * it cannot validate a ticket, identify a unique ticket, or determine a prize.
 */
(() => {
  'use strict';

  const scriptUrl = document.currentScript?.src || new URL('ticket-intelligence.js', document.baseURI).href;
  const catalogUrl = new URL('data/ohio-games.json', scriptUrl).href;
  let loading = null;
  let catalog = null;
  let gamesByNumber = null;
  let gamesByUPC = null;

  function officialSource(value) {
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'www.ohiolottery.com' ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  function validUPC(code) {
    if (!/^\d{12}$/.test(code)) return false;
    const sum = Array.from(code.slice(0, 11), (digit, index) => Number(digit) * (index % 2 === 0 ? 3 : 1))
      .reduce((total, value) => total + value, 0);
    return (sum + Number(code[11])) % 10 === 0;
  }

  function normalizedUPC(rawValue, format) {
    if (typeof rawValue !== 'string' || typeof format !== 'string') return null;
    const kind = format.toUpperCase().replace(/[\s_-]/g, '');
    const value = rawValue.trim();
    // A leading-zero EAN-13 is the standard representation of a UPC-A value.
    // No numeric prefix, serial format, malformed code, or other symbology is
    // interpreted as Ohio ticket data.
    const upc = kind === 'UPCA' && /^\d{12}$/.test(value) ? value
      : kind === 'EAN13' && /^0\d{12}$/.test(value) ? value.slice(1) : null;
    return upc && validUPC(upc) ? upc : null;
  }

  function publicGame(row) {
    return { ...row, upcCodes: row.upcCodes.slice() };
  }

  function publicCatalog() {
    return {
      asOf: catalog.asOf,
      source: catalog.source,
      description: catalog.description,
      autoIdentification: { ...catalog.autoIdentification },
      games: catalog.games.map(publicGame),
    };
  }

  async function ready() {
    if (!loading) {
      loading = (async () => {
        const response = await fetch(catalogUrl, { credentials: 'same-origin' });
        if (!response.ok) throw new Error('OhioGameCatalogUnavailable');
        const data = await response.json();
        if (data.schemaVersion !== 1 || !Array.isArray(data.games) || !/^\d{4}-\d{2}-\d{2}$/.test(data.asOf || '')) {
          throw new Error('OhioGameCatalogInvalid');
        }
        const source = officialSource(data.source);
        if (!source) throw new Error('OhioGameCatalogInvalid');
        const numbers = new Map();
        const upcs = new Map();
        const games = [];
        for (const entry of data.games) {
          const gameNumber = String(entry.gameNumber || '');
          const gameSource = officialSource(entry.source);
          const upcSource = officialSource(entry.upcSource);
          const unitPriceCents = entry.unitPriceCents;
          if (!/^\d{1,4}$/.test(gameNumber) || Number(gameNumber) < 1 || numbers.has(gameNumber)
              || typeof entry.name !== 'string' || !entry.name.trim() || entry.name.length > 150
              || !Number.isSafeInteger(unitPriceCents) || unitPriceCents <= 0 || unitPriceCents > 10000 || !gameSource) {
            throw new Error('OhioGameCatalogInvalid');
          }
          const codes = Array.isArray(entry.upcCodes) && upcSource
            ? entry.upcCodes.filter(code => typeof code === 'string' && validUPC(code)) : [];
          const row = Object.freeze({
            gameNumber,
            name: entry.name.trim(),
            unitPriceCents,
            source: gameSource,
            asOf: /^\d{4}-\d{2}-\d{2}$/.test(entry.asOf || '') ? entry.asOf : data.asOf,
            catalogStatus: entry.catalogStatus === 'historical-publication' ? 'historical-publication' : 'listed',
            upcCodes: Object.freeze(codes),
            ...(codes.length ? { upcSource, upcSourcePage: entry.upcSourcePage, upcPublication: typeof entry.upcPublication === 'string' ? entry.upcPublication.slice(0, 150) : '' } : {}),
          });
          numbers.set(gameNumber, row);
          for (const code of codes) {
            // Ambiguous published product mappings must never auto-select.
            upcs.set(code, upcs.has(code) ? null : row);
          }
          games.push(row);
        }
        gamesByNumber = numbers;
        gamesByUPC = upcs;
        catalog = {
          asOf: data.asOf,
          source,
          description: String(data.description || ''),
          autoIdentification: {
            type: 'exact-published-upc-match',
            barcodeIdentity: 'game',
            supportsValidationBarcodes: false,
            matchedGameCount: games.filter(row => row.upcCodes.length).length,
          },
          games,
        };
      })();
      loading.catch(() => { loading = null; });
    }
    await loading;
    return publicCatalog();
  }

  function matched(row, confidence) {
    return {
      game: 'Scratch-off',
      name: row.name,
      gameNumber: row.gameNumber,
      unitPriceCents: row.unitPriceCents,
      source: row.source,
      asOf: row.asOf,
      catalogStatus: row.catalogStatus,
      ...(row.upcPublication ? { upcPublication: row.upcPublication } : {}),
      confidence,
      ...(confidence === 'verified-game-id' ? { barcodeIdentity: 'game', upcSource: row.upcSource } : {}),
    };
  }

  async function identify(rawValue, format) {
    const upc = normalizedUPC(rawValue, format);
    // Drop the incoming decoded value before any asynchronous catalog work.
    rawValue = null;
    if (!upc) return null;
    try {
      await ready();
      const row = gamesByUPC.get(upc);
      return row ? matched(row, 'verified-game-id') : null;
    } catch (_) {
      // Scanner remains usable when game lookup cannot load; caller asks for
      // the printed game and purchase cost rather than assuming a price.
      return null;
    }
  }

  async function selectCandidate(candidates) {
    // Only normalized product codes survive the asynchronous catalog lookup.
    // The caller retains the original values just long enough to finish a scan.
    const normalized = Array.isArray(candidates) ? candidates.slice(0, 40).map((candidate, index) => ({
      index,
      upc: normalizedUPC(candidate?.rawValue, candidate?.format),
      readable: typeof candidate?.rawValue === 'string' && candidate.rawValue.length > 0 && candidate.rawValue.length <= 8192,
    })) : [];
    candidates = null;
    const readable = normalized.filter(candidate => candidate.readable);
    if (!readable.length) return null;
    if (readable.some(candidate => candidate.upc)) {
      try { await ready(); } catch (_) { /* Keep the scanner usable without the catalog. */ }
    }
    const verified = readable.filter(candidate => candidate.upc && gamesByUPC?.get(candidate.upc));
    const gameNumbers = new Set(verified.map(candidate => gamesByUPC.get(candidate.upc).gameNumber));
    if (gameNumbers.size > 1) return { index: -1, gameMatch: null, kind: 'ambiguous', ambiguous: true };
    if (verified.length) {
      const best = verified[0];
      return { index: best.index, gameMatch: matched(gamesByUPC.get(best.upc), 'verified-game-id'), kind: 'verified', ambiguous: false };
    }
    const best = readable.find(candidate => candidate.upc) || readable[0];
    return { index: best.index, gameMatch: null, kind: best.upc ? 'product' : 'other', ambiguous: false };
  }

  async function lookup(gameNumber) {
    await ready();
    const value = String(gameNumber ?? '').trim().replace(/^#/, '');
    if (!/^\d{1,4}$/.test(value)) return null;
    const row = gamesByNumber.get(String(Number(value)));
    return row ? matched(row, 'catalog-selection') : null;
  }

  async function productFingerprint(rawValue, format) {
    let upc = normalizedUPC(rawValue, format);
    rawValue = null;
    if (!upc || !window.crypto?.subtle) return null;
    let bytes;
    try {
      bytes = new TextEncoder().encode(upc);
      upc = null;
      const digest = await window.crypto.subtle.digest('SHA-256', bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    } catch (_) { return null; }
    finally { upc = null; bytes?.fill(0); }
  }

  async function search(query = '') {
    await ready();
    const value = String(query).trim().toLocaleLowerCase('en-US').replace(/^#/, '');
    return catalog.games.filter(row => !value || row.gameNumber.includes(value) || row.name.toLocaleLowerCase('en-US').includes(value))
      .map(publicGame);
  }

  window.JoeTicketIntelligence = Object.freeze({ ready, identify, lookup, search, selectCandidate, productFingerprint });
})();
