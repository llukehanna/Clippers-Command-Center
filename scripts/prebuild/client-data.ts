// Writes the JSON files client components read in production builds
// (src/lib/ui/client-data.ts) to public/data, before `next build`, so they ship
// as plain static assets.
//   PREBUILD_CACHE_DIR=.prebuild/payloads npm run prebuild:client-data
// Loads go through the build-time payload cache. Any non-2xx load fails the
// script (non-zero exit) so nothing deploys with a missing or broken file.

import fs from 'node:fs'
import path from 'node:path'
import { sql } from '@/src/lib/db'
import { loadPath } from '@/src/lib/data/routes'
import { loadThrough, type CachedPayload } from '@/src/lib/prebuild/payload-cache'
import { CLIENT_DATA_FIXED_PATHS, seasonGamesPath, staticDataPath } from '@/src/lib/ui/client-data'

const OUT = path.join(process.cwd(), 'public')
/** Seasons whose games lists ship: the palette shows the two most recent, Live's idle state the latest. */
const GAME_SEASONS = 2

async function load(dir: string, apiPath: string): Promise<CachedPayload> {
  const payload = await loadThrough(dir, apiPath, loadPath)
  if (payload.status < 200 || payload.status > 299) throw new Error(`client-data: ${apiPath} → ${payload.status}`)
  return payload
}

function latestSeasonIds(body: unknown): number[] {
  const seasons = (body as { seasons?: unknown }).seasons
  if (!Array.isArray(seasons) || seasons.length === 0) throw new Error('client-data: /api/history/seasons has no seasons')
  const ids = (seasons as Array<{ season_id?: unknown }>).map((s) => {
    if (typeof s.season_id !== 'number') throw new Error('client-data: a season has no numeric season_id')
    return s.season_id
  })
  // Same choice the client makes: highest season ids first.
  return [...ids].sort((a, b) => b - a).slice(0, GAME_SEASONS)
}

async function main() {
  const dir = process.env.PREBUILD_CACHE_DIR
  if (!dir) throw new Error('PREBUILD_CACHE_DIR is not set')

  const payloads = new Map<string, CachedPayload>()
  for (const p of CLIENT_DATA_FIXED_PATHS) payloads.set(p, await load(dir, p))
  for (const id of latestSeasonIds(payloads.get('/api/history/seasons')!.body)) {
    const p = seasonGamesPath(id)
    payloads.set(p, await load(dir, p))
  }

  // Start clean so a season that dropped out of the latest two doesn't linger.
  const dataDir = path.join(OUT, 'data')
  fs.rmSync(dataDir, { recursive: true, force: true })
  for (const [apiPath, payload] of payloads) {
    const rel = staticDataPath(apiPath)
    if (!rel) throw new Error(`client-data: no data file for ${apiPath}`)
    const file = path.join(OUT, rel)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const text = JSON.stringify(payload.body)
    fs.writeFileSync(file, text)
    console.log(`${rel}  ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB  ← ${apiPath}`)
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => sql.end())
