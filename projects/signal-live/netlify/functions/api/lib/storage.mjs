import { getStore } from '@netlify/blobs'
import { createHash } from 'node:crypto'

export function storeName(env, invocation = {}) {
  const context = invocation.deploy?.context || env('CONTEXT') || 'dev'
  // Site stores survive redeploys; isolate previews so they cannot edit production.
  const scope = context === 'production' ? 'production' : `${context}-${env('REVIEW_ID') || env('BRANCH') || invocation.deploy?.id || 'local'}`
  const hash = createHash('sha256').update(scope).digest('hex').slice(0, 16)
  return `signal-live-${context === 'production' ? 'production' : hash}`
}

export function createStorage(env, context) {
  const store = getStore({ name: storeName(env, context), consistency: 'strong' })
  return {
    get: (key) => store.get(key, { type: 'json' }),
    set: (key, value, options) => store.setJSON(key, value, options),
    list: async (prefix) => (await store.list({ prefix })).blobs,
    listPrefixes: async (prefix) => (await store.list({ prefix, directories: true })).directories,
    delete: (key) => store.delete(key),
  }
}
