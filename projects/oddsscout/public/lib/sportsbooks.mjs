/** One registry for names, provider mappings and handoffs. Coverage is not legal eligibility. */
export const BOOKMAKER_SOURCE = 'https://the-odds-api.com/sports-odds-data/bookmaker-apis.html';
export const OHIO_LICENSE_SOURCE = 'https://dam.assets.ohio.gov/image/upload/v1776959093/casinocontrol.ohio.gov/licensing/sports%20gaming/Sports_Gaming_Proprietor_and_Services_Provider_Applicants_List_4-21-26_3.pdf';
const providerCheckedAt = '2026-10-16';
const licenseCheckedAt = '2026-10-14';
const licenseAsOf = '2026-04-21';
const definitions = [
  ['fanduel', 'FanDuel', 'FD', '#58a6ff', 'https://sportsbook.fanduel.com/', 'fanduel'],
  ['draftkings', 'DraftKings', 'DK', '#91cf60', 'https://sportsbook.draftkings.com/', 'draftkings'],
  ['betmgm', 'BetMGM', 'MGM', '#d3b46b', 'https://sports.betmgm.com/', 'betmgm'],
  ['bet365', 'bet365', '365', '#f8da72', 'https://www.bet365.com/', null],
  ['williamhill_us', 'Caesars Sportsbook', 'CZ', '#d6ba75', 'https://www.caesars.com/sportsbook-and-casino', 'williamhill_us'],
  ['fanatics', 'Fanatics Sportsbook', 'FAN', '#fb7680', 'https://sportsbook.fanatics.com/', 'fanatics'],
  ['betrivers', 'BetRivers', 'BR', '#92bff8', 'https://www.betrivers.com/', 'betrivers'],
  ['hardrockbet_oh', 'Hard Rock Bet', 'HR', '#c8a8f6', 'https://app.hardrock.bet/', 'hardrockbet_oh'],
  ['prime', 'Prime Sportsbook', 'PR', '#b4cbdc', 'https://www.primesportsbook.com/', null],
  ['ballybet', 'Bally Bet', 'BB', '#ff8a8a', 'https://play.ballybet.com/', 'ballybet'],
  ['betr', 'Betr', 'BT', '#fabc8d', 'https://www.betr.app/', null, 'listed_surrendered'],
  ['espnbet', 'theScore Bet', 'SC', '#9bbcff', 'https://sportsbook.thescore.bet/', 'espnbet'],
  ['betly', 'Betly', 'BL', '#91d0c1', 'https://oh.betly.com/', null],
  ['betjack', 'betJACK', 'J', '#efb176', 'https://betjack.com/en-us', null],
  ['betparx', 'betPARX', 'PX', '#a7ceb5', 'https://betparx.com/', 'betparx', 'listed_surrendered']
];
function identifierMark(tag, color) {
  const safe = String(tag).replace(/[^a-zA-Z0-9]/g, '').slice(0, 4) || 'BK';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 72 44" role="img" aria-label="${safe} identifier"><rect x="1" y="1" width="70" height="42" rx="10" fill="none" stroke="${color}" stroke-width="2"/><text x="36" y="28" fill="${color}" font-family="Arial,sans-serif" font-size="17" font-weight="700" text-anchor="middle">${safe}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
export const BOOKS = Object.freeze(Object.fromEntries(definitions.map(([id, name, tag, color, url, providerKey, status = 'listed_active']) => [id, Object.freeze({
  id, name, tag, color, logo: identifierMark(tag, color),
  logoDescription: 'Generated sportsbook identifier; not an official brand logo.',
  providerKey, providerCoverage: providerKey ? 'documented' : 'unsupported',
  providerCoverageSource: BOOKMAKER_SOURCE, providerCoverageCheckedAt: providerCheckedAt,
  providerPlan: ['williamhill_us','fanatics'].includes(providerKey) ? 'paid_subscription_required' : null,
  url, deepLink: Object.freeze({type: 'homepage', url}),
  stateAvailability: Object.freeze({OH: Object.freeze({status, asOf: licenseAsOf, checkedAt: licenseCheckedAt, source: OHIO_LICENSE_SOURCE})}),
  eligibilityNote: 'Registry status is a dated licensing snapshot. Check current operator availability, age, location and account eligibility before wagering.'
})])));
export const SPORTSBOOKS = Object.freeze(Object.values(BOOKS));
// US keys documented by the configured provider. An event may return fewer or additional books.
export const DEFAULT_BOOKS = Object.freeze(['draftkings', 'fanduel', 'betmgm', 'betrivers', 'williamhill_us', 'fanatics', 'ballybet', 'betparx', 'espnbet', 'hardrockbet_oh']);
export const PROVIDER_BOOK_KEYS = DEFAULT_BOOKS;
const aliases = Object.freeze({caesars: 'williamhill_us', thescore: 'espnbet', thescorebet: 'espnbet', prime_sports: 'prime', bet_jack: 'betjack'});
/** Identity aliases are shared by adapters and UI; state-specific feeds stay distinct. */
export const canonicalSportsbookId = key => Object.hasOwn(aliases,key) ? aliases[key] : key;
export function getSportsbook(key, title = '') {
  const canonical = canonicalSportsbookId(key);
  if (Object.hasOwn(BOOKS, canonical)) return BOOKS[canonical];
  const id = typeof key === 'string' && /^[a-z][a-z0-9_]{0,90}$/.test(key) ? key : 'unknown';
  const name = typeof title === 'string' && title.trim() ? title.trim().slice(0, 100) : id;
  return {id, name, tag: name.replace(/[^a-z0-9]/gi, '').slice(0, 3).toUpperCase() || 'BK', color: '#a7b6c7', logo: identifierMark('BK', '#a7b6c7'), logoDescription: 'Generated identifier; not an official brand logo.', providerKey: id === 'unknown' ? null : id, providerCoverage: 'returned_by_provider', stateAvailability: {OH: {status: 'unknown', asOf: null, checkedAt: null, source: null}}, deepLink: null, url: null, eligibilityNote: 'State and account eligibility are unknown for this provider book.'};
}
export const resolveSportsbook = getSportsbook;
/** Only supplied HTTPS links are handoffs; registry URLs never claim to prefill a betslip. */
export function sportsbookLink(key, quote = null) {
  const supplied = quote?.link || quote?.deepLink;
  if (typeof supplied === 'string') {
    try { const u = new URL(supplied); if (u.protocol === 'https:' && !u.username && !u.password) return {url: u.href, type: 'provider', confirmedBetslip: false}; } catch { /* Invalid provider links have no handoff. */ }
  }
  return getSportsbook(key).deepLink;
}
