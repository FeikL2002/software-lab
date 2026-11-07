import { ohioData } from './ohio-api.mjs';

export const WINNERS_SOURCE_URL = 'https://www.ohiolottery.com/about/media-center/press-releases';
const ARTICLE_PATH = '/Games/Article/GetByDateRangeAndCategory';
const RETAILER_PATH = '/Retailer/GetContentElementByFilters';

// The press-room API is the source of reports, not a complete record of every win.
// It leaves address fields empty in many articles. Only an explicitly reported
// retailer address can qualify for an official retailer-coordinate match.
export function plainText(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', reg: '®', trade: '™', hellip: '…' };
  return String(value ?? '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/?(?:p|div|br|li|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (all, entity) => {
      if (entity[0] !== '#') return named[entity.toLowerCase()] ?? all;
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
    }).replace(/[\t\r ]+/g, ' ').replace(/ *\n */g, '\n').trim();
}

export function normalizeCity(value) {
  return plainText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/\bTOWNSHIP\b/g, 'TWP').replace(/\bHEIGHTS\b/g, 'HTS').replace(/[^A-Z0-9]/g, '');
}

export function normalizeAddress(value) {
  const terms = { STREET: 'ST', ROAD: 'RD', AVENUE: 'AVE', BOULEVARD: 'BLVD', DRIVE: 'DR', COURT: 'CT', PLACE: 'PL', LANE: 'LN', HIGHWAY: 'HWY', ROUTE: 'RTE', PARKWAY: 'PKWY', TERRACE: 'TER', CIRCLE: 'CIR', CENTER: 'CTR', NORTH: 'N', SOUTH: 'S', EAST: 'E', WEST: 'W', NORTHEAST: 'NE', NORTHWEST: 'NW', SOUTHEAST: 'SE', SOUTHWEST: 'SW' };
  return plainText(value).normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(/\s+/)
    .map(term => terms[term] ?? term).join(' ');
}

function cleanRetailerName(prefix) {
  let name = prefix.trim().replace(/[,\s]+$/, '').replace(/\s+is$/i, '');
  // A preceding sentence or dateline is context, not part of a store's name.
  name = name.split(/\n|[!?]\s+|[–—]\s+|\.\s+(?=[A-Z])/).at(-1).trim();
  const at = [...name.matchAll(/\b(?:at|from)\s+/gi)].at(-1);
  if (at) name = name.slice(at.index + at[0].length).trim();
  return name.replace(/[,\s]+$/, '').replace(/\s+is$/i, '').slice(0, 160);
}

export function parseRetailerLocations(article) {
  const locations = [];
  const add = location => {
    if (!/^\d+[A-Z-]?\s/i.test(location.address) || !location.city || !location.retailer) return;
    const key = normalizeAddress(location.address) + '|' + normalizeCity(location.city);
    if (!locations.some(item => item.key === key)) locations.push({ ...location, key });
  };
  if (article.streetAddress && article.city && article.locationName) {
    add({ retailer: plainText(article.locationName), address: plainText(article.streetAddress), city: plainText(article.city) });
  }
  const text = plainText(article.content);
  // Address punctuation is allowed ("W. Main St."); the explicit "in CITY"
  // separates it from the city. A dateline by itself never produces a location.
  const pattern = /([^\n]{1,240}?)\s+(?:is\s+)?located\s+at\s+(\d[^\n]{1,130}?)\s+in\s+([A-Z][A-Za-z’' .-]{1,65}?)(?=,|\.(?:\s|$)|\s+(?:sold|where|which|and)\b|\n|$)/g;
  for (const match of text.matchAll(pattern)) {
    const following = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
    const context = text.slice(Math.max(0, match.index - 180), match.index + match[0].length);
    const referencedDate = following.match(/\b(?:for|on)\s+(?:the\s+)?((?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},?\s+\d{4})/i)?.[1];
    if (locations.length && referencedDate && /\b(?:previous|earlier|first|since|second)\b/i.test(context)) {
      const eventTime = Date.parse(referencedDate + ' 00:00:00 UTC');
      const publicationTime = Date.parse(String(article.date || '').slice(0, 10) + 'T00:00:00Z');
      // Background comparisons can name a different retailer's much older win.
      // Such a location is not a location for the newly reported prize.
      if (Number.isFinite(eventTime) && publicationTime - eventTime > 45 * 86400000) continue;
    }
    add({ retailer: cleanRetailerName(match[1]), address: match[2].trim(), city: match[3].trim() });
  }
  return locations.map(({ key, ...location }) => location);
}

function isWinnerArticle(article) {
  const tags = Array.isArray(article.tagNames) ? article.tagNames.map(tag => String(tag).toLowerCase()) : [];
  if (tags.some(tag => tag.includes('featured winner'))) return true;
  if (tags.some(tag => tag.includes('news release'))) return false;
  const title = plainText(article.title);
  return /\b(?:wins?|winner|prize|jackpot)\b/i.test(title)
    && /\b(?:winning tickets?|won|winner|prize)\b/i.test(plainText(article.content));
}

function gameFromArticle(article) {
  const title = plainText(article.title), content = plainText(article.content);
  const text = title + '\n' + content;
  const names = ['Millionaire for Life', 'Rolling Cash 5', 'Mega Millions', 'Powerball', 'PICK 5', 'PICK 4', 'PICK 3', 'KENO', 'Quick Spot'];
  for (const game of names) if (title.toLowerCase().includes(game.toLowerCase())) return game;
  for (const match of String(article.content || '').matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    if (/\/games\/scratch-offs\/[^/]+\/[^/?#]+/i.test(match[1])) {
      const name = plainText(match[2]).replace(/^Ohio Lottery\s+/i, '').replace(/\s+Scratch-Off$/i, '').trim();
      if (name && name.length < 100) return name;
    }
  }
  const purchase = content.match(/purchased\s+(?:an?\s+|the\s+)?(?:Ohio Lottery\s+)?([^.!?\n]{2,70}?)\s+Scratch-Off\b/i)?.[1];
  if (purchase) return purchase.trim();
  if (!/scratch[ -]off/i.test(title)) {
    for (const game of names) if (content.toLowerCase().includes(game.toLowerCase())) return game;
  }
  return /scratch[ -]off/i.test(text) ? 'Scratch-off' : /EZPLAY/i.test(text) ? 'EZPLAY' : 'Lottery ticket';
}

function prizeFromArticle(article) {
  const structured = plainText(article.winAmount).trim();
  // Only a structured prize or the report's own title is used. Picking the
  // first amount in prose could substitute wager, tax, cash option or odds.
  const titlePrize = plainText(article.title).match(/\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:million|billion|thousand))?(?:\s*(?:a|per)\s+year(?:\s+for\s+(?:life|\d+\s+years?))?)?/i)?.[0];
  let prize = structured || titlePrize || null;
  if (!prize) return { prize: 'See official report', prizeAmount: null };
  let match = prize.match(/\$\s*([\d,]+(?:\.\d+)?)(?:\s*(million|billion|thousand))?/i);
  // "Billion" is also a scratch-off name: "$50,000 Billion Scratch-Off"
  // describes a $50,000 prize, whereas "$1 Million" is an amount.
  if (!structured && match?.[2] && Number(match[1].replace(/,/g, '')) >= 1000) {
    prize = '$' + match[1];
    match = prize.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  }
  let amount = match ? Number(match[1].replace(/,/g, '')) * ({ million: 1e6, billion: 1e9, thousand: 1e3 }[match[2]?.toLowerCase()] || 1) : null;
  if (/\byear|\blife/i.test(prize)) amount = null;
  return { prize, prizeAmount: Number.isFinite(amount) ? amount : null };
}

export function parseWinnerArticles(articles) {
  if (!Array.isArray(articles)) throw new Error('Ohio Lottery returned an invalid article list.');
  const seen = new Set();
  const records = [];
  for (const article of articles) {
    const articleID = Number(article.articleID);
    const publicationDate = String(article.date || '').slice(0, 10);
    if (!Number.isSafeInteger(articleID) || articleID <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(publicationDate) || seen.has(articleID) || !isWinnerArticle(article)) continue;
    seen.add(articleID);
    const title = plainText(article.title).slice(0, 220);
    const game = gameFromArticle(article);
    const gameType = /^(?:Millionaire for Life|Rolling Cash 5|Mega Millions|Powerball|PICK [345]|KENO)$/i.test(game) ? 'draw'
      : /EZPLAY|Quick Spot/i.test(game + ' ' + title) ? 'ezplay' : /scratch[ -]off/i.test(plainText(article.content) + ' ' + title) ? 'scratch' : 'draw';
    const locations = parseRetailerLocations(article);
    const prize = prizeFromArticle(article);
    for (const [index, location] of (locations.length ? locations : [null]).entries()) {
      records.push({
        id: 'ohio-report-' + articleID + (index ? '-retailer-' + (index + 1) : ''),
        articleId: articleID, title, publicationDate, date: publicationDate, dateLabel: 'Reported',
        game, gameType, ...prize,
        retailer: location?.retailer || 'Retailer not identified', city: location?.city || '', address: location?.address || '',
        state: 'OH', lat: null, lng: null, precision: 'unmapped',
        sourceUrl: WINNERS_SOURCE_URL + '?release-detail?id=' + articleID,
        sourceLabel: 'Ohio Lottery official press release', recordType: 'publicly-reported-winner',
      });
    }
  }
  return records.sort((a, b) => b.publicationDate.localeCompare(a.publicationDate) || b.articleId - a.articleId || a.id.localeCompare(b.id));
}

export function matchRetailer(record, retailers) {
  if (!record.address || !record.city || !Array.isArray(retailers)) return null;
  const address = normalizeAddress(record.address), city = normalizeCity(record.city);
  let matches = retailers.filter(row => normalizeAddress(row.address) === address && normalizeCity(row.city) === city
    && !row.isRegionalOffice && Number(row.latitude) >= 38 && Number(row.latitude) <= 43
    && Number(row.longitude) >= -85 && Number(row.longitude) <= -80);
  if (!matches.length) return null;
  const normalizeName = name => plainText(name).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const namedMatches = matches.filter(row => normalizeName(row.businessName) === normalizeName(record.retailer));
  if (namedMatches.length) matches = namedMatches;
  // Duplicate official entries at the same storefront are okay; conflicting
  // coordinates stay unpinned rather than choosing an arbitrary entry.
  const first = matches[0];
  if (matches.some(row => Math.abs(Number(row.latitude) - Number(first.latitude)) > .0001 || Math.abs(Number(row.longitude) - Number(first.longitude)) > .0001)) return null;
  return first;
}

async function mapConcurrent(items, concurrency, handler) {
  let index = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const item = items[index++];
      await handler(item);
    }
  }));
}

export async function fetchWinners({ now = new Date() } = {}) {
  const startedAt = Date.now();
  const date = typeof now === 'function' ? new now() : new Date(now);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid winner refresh date.');
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const [year, month] = today.split('-').map(Number);
  const previous = new Date(Date.UTC(year, month - 2, 1));
  const from = previous.toISOString().slice(0, 10);
  const currentStart = today.slice(0, 7) + '-01';
  const tomorrow = new Date(Date.UTC(year, month - 1, Number(today.slice(8)) + 1)).toISOString().slice(0, 10);
  // dateTo is exclusive at midnight: querying "today" silently drops reports
  // published today. Filter publication dates below to retain the stated window.
  const ranges = [[from, currentStart], [currentStart, tomorrow]];
  const results = await Promise.all(ranges.map(async ([dateFrom, dateTo]) => {
    const query = new URLSearchParams({ dateFrom, dateTo, category: 'PressRelease' });
    return ohioData(ARTICLE_PATH + '?' + query);
  }));
  if (results.some(items => !Array.isArray(items))) throw new Error('Ohio Lottery returned an invalid winner feed.');
  const records = parseWinnerArticles(results.flat().slice(0, 1000))
    .filter(record => record.publicationDate >= from && record.publicationDate <= today);
  const cities = [...new Set(records.filter(record => record.address && record.city).map(record => record.city))].slice(0, 50);
  let unmatchedCityCount = 0;
  // Scheduled Functions have a 30-second ceiling. A lookup may take 12 seconds;
  // reserve that time for requests already in flight and final cache storage.
  const lookupDeadline = startedAt + 12000;
  await mapConcurrent(cities, 3, async city => {
    if (Date.now() >= lookupDeadline) {
      unmatchedCityCount++;
      return;
    }
    try {
      let retailers = await ohioData(RETAILER_PATH, { method: 'POST', body: {
        businessName: '', addressCity: city, county: '', zip: '', latitude: 0, longitude: 0, ticketCashAmount: 0,
      } });
      const cityRecords = records.filter(record => record.city === city);
      const cityAbbreviation = city.replace(/\bTownship\b/gi, 'Twp').replace(/\bHeights\b/gi, 'Hts');
      // The official directory stores some cities only under their common
      // postal abbreviations; a full-name query omits those rows entirely.
      if (cityAbbreviation !== city && cityRecords.some(record => !matchRetailer(record, retailers)) && Date.now() < lookupDeadline) {
        try {
          const abbreviated = await ohioData(RETAILER_PATH, { method: 'POST', body: {
            businessName: '', addressCity: cityAbbreviation, county: '', zip: '', latitude: 0, longitude: 0, ticketCashAmount: 0,
          } });
          if (Array.isArray(abbreviated)) retailers = [...(Array.isArray(retailers) ? retailers : []), ...abbreviated];
        } catch {
          unmatchedCityCount++;
        }
      }
      for (const record of cityRecords) {
        const retailer = matchRetailer(record, retailers);
        if (!retailer) continue;
        record.lat = Number(retailer.latitude);
        record.lng = Number(retailer.longitude);
        record.precision = 'retailer';
        record.coordinateSource = 'Ohio Lottery retailer locator';
        record.coordinateSourceUrl = 'https://www.ohiolottery.com/retail-locations';
        record.coordinatePrecision = 'official-retailer-location';
        record.retailerId = String(retailer.agentNumber || retailer.itemID || '');
      }
    } catch {
      // Report facts are still usable if a retailer lookup is temporarily down.
      unmatchedCityCount++;
    }
  });
  return {
    records, checkedAt: date.toISOString(), sourceURL: WINNERS_SOURCE_URL,
    coverage: { from, to: today, storyCount: new Set(records.map(record => record.articleId)).size,
      mappedCount: records.filter(record => record.precision === 'retailer').length,
      locationCount: records.length, retailerLookupFailures: unmatchedCityCount,
    },
  };
}
