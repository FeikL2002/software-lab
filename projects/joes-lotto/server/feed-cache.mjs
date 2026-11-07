import { getStore } from '@netlify/blobs';

const MAX_WARM_ENTRIES = 120;
const TTL = { winners: 15 * 60_000, retailers: 6 * 60 * 60_000 };

// Only normalized public reports and coarse-area retailer lists are stored here.
// Ticket records, chat, precise GPS and public-service access tokens never enter it.
export function createFeedCache({ storeFactory, now = () => Date.now() } = {}) {
  const warm = new Map();
  const pending = new Map();
  const stores = new Map();
  const factory = storeFactory ?? (scope => getStore({ name: `joes-lotto-public-feeds-${scope}`, consistency: 'strong' }));
  const scopeFor = context => context?.deploy?.context === 'production' ? 'production' : 'preview';
  function storeFor(scope) {
    if (!stores.has(scope)) {
      try { stores.set(scope, factory(scope)); } catch { return null; }
    }
    return stores.get(scope);
  }
  function remember(key, entry) {
    warm.delete(key);
    warm.set(key, entry);
    while (warm.size > MAX_WARM_ENTRIES) warm.delete(warm.keys().next().value);
  }
  const valid = entry => entry?.version === 1 && Array.isArray(entry.data?.records) && Number.isFinite(entry.savedAt) && typeof entry.data.checkedAt === 'string';
  return async function readFeed(kind, key, loader, { context, force = false } = {}) {
    if (!Object.hasOwn(TTL, kind)) throw new Error('Unsupported public feed.');
    const scope = scopeFor(context);
    const cacheKey = `${kind}/${key}`;
    const memoryKey = `${scope}/${cacheKey}`;
    const store = storeFor(scope);
    let previous = warm.get(memoryKey);
    if (!previous && store) {
      try {
        const stored = await store.get(cacheKey, { type: 'json', consistency: 'strong' });
        if (valid(stored)) { previous = stored; remember(memoryKey, stored); }
      } catch { /* A fresh source request can still serve this request. */ }
    }
    if (!force && previous && now() - previous.savedAt < TTL[kind]) {
      return { ...previous.data, stale: false, status: 'fresh' };
    }
    if (pending.has(memoryKey)) return pending.get(memoryKey);
    const operation = (async () => {
      try {
        const data = await loader();
        if (!Array.isArray(data?.records) || !Number.isFinite(Date.parse(data.checkedAt))) throw new Error('Invalid feed.');
        // A sudden empty press room must not erase a last successful winner feed.
        if (kind === 'winners' && previous?.data.records.length && !data.records.length) throw new Error('Empty winner feed.');
        const entry = { version: 1, savedAt: now(), data };
        remember(memoryKey, entry);
        if (store) {
          try { await store.setJSON(cacheKey, entry); } catch { /* The current source result is still valid. */ }
        }
        return { ...data, stale: false, status: 'fresh' };
      } catch {
        if (previous) return { ...previous.data, stale: true, status: 'stale', error: 'Ohio Lottery could not be refreshed. Showing the last successful check.' };
        throw new Error('Ohio Lottery is temporarily unavailable. Please try again.');
      } finally { pending.delete(memoryKey); }
    })();
    pending.set(memoryKey, operation);
    return operation;
  };
}

export const readFeed = createFeedCache();
