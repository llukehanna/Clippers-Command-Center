import { defineCloudflareConfig } from '@opennextjs/cloudflare'
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache'
import type { IncrementalCache } from '@opennextjs/aws/types/overrides.js'

// Caching on the free plan, with no R2/KV/D1:
//
// - Every page is prerendered at build time (spec 2026-11-19 prebuilt-site);
//   cache interception serves it from the build's static assets, read-only,
//   without rendering. Unknown params 404 (dynamicParams = false); only the
//   live routes and the DB allowlist render at request time.
// - Nothing is written at runtime: there is no revalidation, and the Next
//   data cache (unstable_cache in src/lib/ui/api.ts) is not persisted here,
//   so data-cache entries are misses and writes are dropped (the stock
//   static-assets cache would log an error on every write).
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
