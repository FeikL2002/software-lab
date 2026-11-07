import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeedCache } from '../server/feed-cache.mjs';
import { retailerQuery, retailersHandler, winnersHandler } from '../server/api-handlers.mjs';
import { normalizeRetailers } from '../server/retailers.mjs';
import { parseWinnerArticles, matchRetailer } from '../server/winners.mjs';
const prod = { deploy: { context: 'production' } };
const data = (checkedAt = '2026-10-16T20:00:00Z') => ({ checkedAt, records: [{ id: 'public-1' }] });
function fakeStores() {
  const scopes = new Map();
  return { scopes, factory(scope) {
    if (!scopes.has(scope)) scopes.set(scope, new Map());
    const values = scopes.get(scope);
    return { get: async key => values.get(key) ?? null, setJSON: async (key, value) => { values.set(key, structuredClone(value)); } };
  } };
}
test('precise GPS is rounded before cache keys and remote retailer lookups', () => {
  const { query, key } = retailerQuery(new URL('https://example.com/api/retailers?lat=40.798617&lng=-81.378129'));
  assert.deepEqual(query, { lat: 40.8, lng: -81.38 });
  assert.equal(key, 'point/40.80,-81.38');
  for (const search of ['', '?lat=40', '?lat=0&lng=900', '?place=443', '?place=Akron&lat=40&lng=-81', '?place=%3Cscript%3E']) {
    assert.throws(() => retailerQuery(new URL('https://example.com/api/retailers' + search)));
  }
});
test('public feed TTL avoids duplicate source requests and stale fallback keeps original check time', async () => {
  let clock = 0, calls = 0;
  const stores = fakeStores();
  const read = createFeedCache({ now: () => clock, storeFactory: stores.factory });
  const loader = async () => { calls++; return data(); };
  await read('winners', 'recent', loader, { context: prod });
  clock = 14 * 60_000;
  assert.equal((await read('winners', 'recent', loader, { context: prod })).stale, false);
  assert.equal(calls, 1);
  clock = 16 * 60_000;
  const stale = await read('winners', 'recent', async () => { throw Error('source failure'); }, { context: prod });
  assert.equal(stale.stale, true);
  assert.equal(stale.checkedAt, data().checkedAt);
  assert.deepEqual(stale.records, data().records);
});
test('public cache survives a cold start, coalesces requests, and isolates previews', async () => {
  const stores = fakeStores();
  let clock = 0, calls = 0;
  const opts = { now: () => clock, storeFactory: stores.factory };
  const first = createFeedCache(opts);
  const loader = async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return data(); };
  await Promise.all([first('winners', 'recent', loader, { context: prod }), first('winners', 'recent', loader, { context: prod })]);
  assert.equal(calls, 1);
  const cold = createFeedCache(opts);
  await cold('winners', 'recent', loader, { context: prod });
  assert.equal(calls, 1);
  await cold('winners', 'recent', loader, { context: { deploy: { context: 'deploy-preview' } } });
  assert.equal(calls, 2);
  assert.equal(stores.scopes.size, 2);
});
test('source outage with no last success fails explicitly; empty news cannot erase saved reports', async () => {
  let clock = 0;
  const read = createFeedCache({ now: () => clock, storeFactory: () => null });
  await assert.rejects(read('winners', 'recent', async () => { throw Error('source failure'); }, { context: prod }));
  await read('winners', 'recent', async () => data(), { context: prod });
  clock = 16 * 60_000;
  const result = await read('winners', 'recent', async () => ({ ...data(), records: [] }), { context: prod });
  assert.equal(result.stale, true);
  assert.equal(result.records.length, 1);
});
test('official retailer normalization includes brands equally and rejects inactive/non-store coordinates', () => {
  const row = { agentStatus: 'ACTIVE', state: 'OH', city: 'Canton', address: '1 Main St', latitude: 40.8, longitude: -81.38 };
  const result = normalizeRetailers([
    { ...row, agentNumber: 1, businessName: 'BP' },
    { ...row, agentNumber: 2, businessName: 'Circle K' },
    { ...row, agentNumber: 3, businessName: 'Independent Market' },
    { ...row, agentNumber: 4, businessName: 'Closed', agentStatus: 'INACTIVE' },
    { ...row, agentNumber: 5, businessName: 'No coordinates', latitude: 0 },
    { ...row, agentNumber: 6, businessName: 'Office', isRegionalOffice: true },
  ]);
  assert.deepEqual(result.map(r => r.name), ['BP', 'Circle K', 'Independent Market']);
});
test('two current stores stay separate, historical background and datelines do not create false pins', () => {
  const articles = [{ articleID: 7, title: 'Powerball Players Win Big', date: '2026-10-16', tagNames: ['Featured Winner'], content: '<p>Alpha Market is located at 12 Main Street in Canton.</p><p>Beta Market is located at 19 Oak Road in Akron.</p>' },
    { articleID: 8, title: '$50,000 Winner', date: '2026-10-16', tagNames: ['Featured Winner'], content: '<p>CLEVELAND – A player won a prize.</p>' },
    { articleID: 9, title: 'Powerball Winner', date: '2026-10-16', tagNames: ['Featured Winner'], content: '<p>Current Market is located at 27 Main Road in Canton.</p><p>This is the second win since an earlier prize. Old Market is located at 11 Oak Street in Akron for the April 27, 2026 drawing.</p>' }];
  const parsed = parseWinnerArticles(articles);
  assert.equal(parsed.length, 4);
  assert.equal(parsed.filter(r => r.articleId === 9).length, 1);
  assert.equal(parsed.find(r => r.articleId === 9).retailer, 'Current Market');
  assert.equal(parsed.filter(r => r.articleId === 7).length, 2);
  assert.equal(parsed.find(r => r.articleId === 8).lat, null);
  const record = parsed.find(r => r.retailer === 'Alpha Market');
  const row = { businessName: 'Alpha Market', address: '12 MAIN ST', city: 'CANTON', latitude: 40.8, longitude: -81.38 };
  assert.ok(matchRetailer(record, [row]));
  assert.equal(matchRetailer(record, [{ ...row, address: '21 MAIN ST' }]), null);
  assert.equal(matchRetailer(record, [{ ...row, city: 'AKRON' }]), null);
});
test('API rejects mutations and invalid requests without calling upstream', async () => {
  assert.equal((await retailersHandler(new Request('https://example.com/api/retailers', { method: 'POST' }), prod)).status, 405);
  assert.equal((await retailersHandler(new Request('https://example.com/api/retailers?place=443'), prod)).status, 400);
  assert.equal((await winnersHandler(new Request('https://example.com/api/winners?force=1'), prod)).status, 400);
});
