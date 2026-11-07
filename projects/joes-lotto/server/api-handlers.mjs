import { readFeed } from './feed-cache.mjs';
import { fetchRetailers } from './retailers.mjs';
import { fetchWinners } from './winners.mjs';

const json = (data, status = 200, extraHeaders = {}) => new Response(JSON.stringify(data), {
  status,
  headers: {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store',
    ...(status === 200 ? { 'Netlify-CDN-Cache-Control': 'public, durable, max-age=300, stale-while-revalidate=60' } : {}),
    ...extraHeaders,
  },
});
const unavailable = () => json({ records: [], status: 'unavailable', stale: true, error: 'Ohio Lottery is temporarily unavailable. Please try again.' }, 503, { 'Retry-After': '60' });
const methodError = () => json({ error: 'Use GET to read public lottery information.' }, 405, { Allow: 'GET' });

export function retailerQuery(url) {
  for (const key of url.searchParams.keys()) if (!['lat', 'lng', 'place'].includes(key)) throw new Error('Use a location or Ohio city/ZIP.');
  const place = (url.searchParams.get('place') || '').replace(/\s+/g, ' ').trim();
  const hasLocation = url.searchParams.has('lat') || url.searchParams.has('lng');
  if (place && hasLocation) throw new Error('Choose either a location or a city/ZIP.');
  if (hasLocation) {
    const rawLat = url.searchParams.get('lat'), rawLng = url.searchParams.get('lng');
    const lat = Number(rawLat), lng = Number(rawLng);
    if (!rawLat || !rawLng || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw new Error('Choose a valid location.');
    const query = { lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100 };
    return { query, key: `point/${query.lat.toFixed(2)},${query.lng.toFixed(2)}` };
  }
  if (!place || place.length > 80 || !/^[\p{L}\p{N}\s.'’,-]+$/u.test(place) || (/^\d+$/.test(place) && !/^\d{5}$/.test(place))) throw new Error('Enter an Ohio city or five-digit ZIP code.');
  return { query: { place }, key: `place/${encodeURIComponent(place.toLowerCase())}` };
}

export async function retailersHandler(request, context) {
  if (request.method !== 'GET') return methodError();
  let selected;
  try { selected = retailerQuery(new URL(request.url)); }
  catch (error) { return json({ error: error.message }, 400); }
  try {
    const data = await readFeed('retailers', selected.key, () => fetchRetailers(selected.query), { context });
    return json(data, 200, { 'Netlify-Vary': 'query=lat|lng|place' });
  } catch { return unavailable(); }
}

export async function winnersHandler(request, context) {
  if (request.method !== 'GET') return methodError();
  if ([...new URL(request.url).searchParams.keys()].length) return json({ error: 'Winner reports do not need a search query.' }, 400);
  try { return json(await readFeed('winners', 'recent', () => fetchWinners(), { context })); }
  catch { return unavailable(); }
}

export async function refreshWinners(context) {
  const data = await readFeed('winners', 'recent', () => fetchWinners(), { context, force: true });
  if (data.stale) throw new Error('The scheduled Ohio winner refresh could not reach the source.');
  return { checkedAt: data.checkedAt, reports: data.coverage.storyCount };
}
