import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'
import type { IncrementalCache } from '@opennextjs/aws/types/overrides.js'

// Caching on the free plan, with no R2/KV/D1:
//
// - Prerendered routes (/live, icons, manifest, robots) are served from the
//   build's static assets, read-only, without starting the Next server.
// - Every other page is force-dynamic. Their only Next data cache,
//   unstable_cache in src/lib/ui/api.ts, is not persisted here: on Workers
//   Hyperdrive's 60 s query cache does that job (src/lib/db.ts), so data-cache
//   entries are simply misses and writes are dropped (the stock static-assets
//   cache would log an error on every write).
const incrementalCache: IncrementalCache = {
  // Keep the stock name: `opennextjs-cloudflare deploy` keys off it to copy
  // the prerendered entries into the static assets.
  name: staticAssetsIncrementalCache.name,
  async get(key, cacheType) {
    if (cacheType && cacheType !== 'cache') return null
    return staticAssetsIncrementalCache.get(key, cacheType)
  },
  async set() {},
  async delete() {},
}

export default defineCloudflareConfig({
  incrementalCache,
  enableCacheInterception: true,
})
