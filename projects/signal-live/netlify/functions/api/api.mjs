import { createApi } from './lib/core.mjs'
import { createStorage } from './lib/storage.mjs'

const env = (name) => globalThis.Netlify?.env?.get(name) ?? process.env[name]

// Storage is initialized in the invocation, after Netlify has supplied Blobs context.
export default createApi({ env, storage: (context) => createStorage(env, context) })

export const config = {
  // Keep Netlify's default function URL; it forwards path suffixes to this router.
  rateLimit: { action: 'rate_limit', aggregateBy: 'ip', windowSize: 60, windowLimit: 240 },
}
