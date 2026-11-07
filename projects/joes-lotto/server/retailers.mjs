import { ohioData, OhioDataError } from './ohio-api.mjs';

export const RETAILER_SOURCE_URL = 'https://www.ohiolottery.com/retail-locations';
const SOURCE_RADIUS_MILES = 8;
const clean = (value, max = 160) => typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max) : '';

// The official directory mixes these postal abbreviations with their full names.
// Keep the variants equivalent; never expand a search into neighboring places.
export function cityQueryVariants(value) {
  const base = clean(value, 100).replace(/\b(TWP|HTS)\./gi, '$1').replace(/\s+/g, ' ').trim();
  const abbreviated = base.replace(/\bHEIGHTS\b/gi, 'HTS').replace(/\bTOWNSHIP\b/gi, 'TWP');
  const expanded = base.replace(/\bHTS\b/gi, 'HEIGHTS').replace(/\bTWP\b/gi, 'TOWNSHIP');
  return [...new Map([base, abbreviated, expanded].map(city => [city.toUpperCase(), city])).values()];
}

/** Normalize public records without dropping shops because of their brand or service flags. */
export function normalizeRetailers(rows) {
  if (!Array.isArray(rows)) throw new OhioDataError('Ohio did not return a retailer list.');
  const seen = new Set();
  const records = [];
  for (const row of rows) {
    if (!row || !['ACTIVE', 'NEW'].includes(String(row.agentStatus).toUpperCase()) || row.isRegionalOffice) continue;
    const lat = Number(row.latitude), lng = Number(row.longitude);
    const name = clean(row.businessName), address = clean(row.address), city = clean(row.city, 100);
    if (!name || !address || !city || clean(row.state, 2).toUpperCase() !== 'OH') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < 38 || lat > 43 || lng < -85.5 || lng > -80) continue;
    const id = clean(String(row.agentNumber || row.itemID || `${name}|${address}|${city}`), 200);
    if (seen.has(id)) continue;
    seen.add(id);
    const services = [];
    if (row.hasKeno) services.push('Keno');
    if (row.hasWinstation) services.push('WinStation');
    if (row.isHighTierCash) services.push('High-tier cashing');
    records.push({
      id, name, address, city, state: 'OH', zip: clean(row.zip, 10), lat, lng,
      phone: clean(row.phone, 30), services,
    });
  }
  return records;
}

function normalizedQuery(query) {
  const hasLat = query?.lat !== undefined && query?.lat !== null && query?.lat !== '';
  const hasLng = query?.lng !== undefined && query?.lng !== null && query?.lng !== '';
  if (hasLat || hasLng) {
    const lat = Number(query?.lat), lng = Number(query?.lng);
    if (!hasLat || !hasLng || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new OhioDataError('Choose a valid location or Ohio city/ZIP.', { code: 'INVALID_QUERY', status: 400 });
    }
    // Reduce precision before any remote request or cache key is created.
    return { mode: 'location', lat: Math.round(lat * 100) / 100, lng: Math.round(lng * 100) / 100, place: '' };
  }
  const place = clean(query?.place, 100).replace(/\s+/g, ' ');
  if (!place || place.length > 80 || !/^[\p{L}\p{N}\s.'’,-]+$/u.test(place)) {
    throw new OhioDataError('Enter an Ohio city or five-digit ZIP code.', { code: 'INVALID_QUERY', status: 400 });
  }
  if (/^\d{5}(?:-\d{4})?$/.test(place)) return { mode: 'zip', lat: null, lng: null, place: place.slice(0, 5) };
  if (/^\d+$/.test(place)) throw new OhioDataError('Use a five-digit Ohio ZIP code.', { code: 'INVALID_QUERY', status: 400 });
  return { mode: 'city', lat: null, lng: null, place };
}

/** Return every valid official match; visual radius filtering belongs to the map. */
export async function fetchRetailers(query) {
  const selected = normalizedQuery(query);
  const body = {
    businessName: '', addressCity: '', county: '', zip: '',
    latitude: 0, longitude: 0, ticketCashAmount: 0,
  };
  if (selected.mode === 'location') {
    body.latitude = selected.lat;
    body.longitude = selected.lng;
  } else if (selected.mode === 'zip') body.zip = selected.place;
  else body.addressCity = selected.place;
  const rows = await ohioData('/Retailer/GetContentElementByFilters', { method: 'POST', body });
  let aliasLookupsIncomplete = false;
  if (selected.mode === 'city') {
    const aliases = cityQueryVariants(selected.place).filter(city => city.toUpperCase() !== selected.place.toUpperCase());
    // At most two equivalent secondary queries, with the original result kept
    // if an alias lookup is temporarily unavailable.
    const additional = await Promise.all(aliases.map(async city => {
      try {
        return await ohioData('/Retailer/GetContentElementByFilters', {
          method: 'POST', body: { ...body, addressCity: city },
        });
      } catch {
        aliasLookupsIncomplete = true;
        return [];
      }
    }));
    if (Array.isArray(rows)) for (const extra of additional) if (Array.isArray(extra)) rows.push(...extra);
  }
  return {
    records: normalizeRetailers(rows),
    sourceURL: RETAILER_SOURCE_URL,
    checkedAt: new Date().toISOString(),
    query: selected,
    sourceRadiusMiles: SOURCE_RADIUS_MILES,
    ...(aliasLookupsIncomplete ? { warnings: ['An equivalent city-name lookup was unavailable; this list may be incomplete.'] } : {}),
  };
}
