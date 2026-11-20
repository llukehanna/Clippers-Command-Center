// Writes the JSON files client components read in production builds
// (src/lib/ui/client-data.ts) to public/data, before `next build`, so they ship
// as plain static assets.
//   PREBUILD_CACHE_DIR=.prebuild/payloads npm run prebuild:client-data
// Loads go through the build-time payload cache. Any non-2xx load fails the
// script (non-zero exit) so nothing deploys with a missing or broken file.
//
// The files are written to a staging directory first and swapped into
// public/data only once all of them are written, so public/data is either the
// previous complete set or the new complete set, never a partial tree. Staging
// lives in .prebuild/ (not public/), so a leftover can never ship as an asset.
// `check-build.ts --client-data` (the first step of `npm run cf-build`)
// verifies the result before every production build.

import fs from 'node:fs'
import path from 'node:path'
import { sql } from '@/src/lib/db'
import { loadPath } from '@/src/lib/data/routes'
import { loadThrough, type CachedPayload } from '@/src/lib/prebuild/payload-cache'
import { CLIENT_DATA_FIXED_PATHS, seasonGamesPath } from '@/src/lib/ui/client-data'
import { dataFileFor, latestSeasonIds } from './client-data-files'

const DATA_DIR = path.join(process.cwd(), 'public', 'data')
const STAGING = path.join(process.cwd(), '.prebuild', 'client-data.next')
const PREVIOUS = path.join(process.cwd(), '.prebuild', 'client-data.prev')

async function load(dir: string, apiPath: string): Promise<CachedPayload> {
  const payload = await loadThrough(dir, apiPath, loadPath)
  if (payload.status < 200 || payload.status > 299) throw new Error(`client-data: ${apiPath} → ${payload.status}`)
  return payload
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

  // Stage the complete new tree (a season that dropped out of the latest two doesn't carry over).
  fs.rmSync(STAGING, { recursive: true, force: true })
  fs.rmSync(PREVIOUS, { recursive: true, force: true })
  for (const [apiPath, payload] of payloads) {
    const rel = dataFileFor(apiPath)
    const file = path.join(STAGING, path.relative('/data', rel))
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const text = JSON.stringify(payload.body)
    fs.writeFileSync(file, text)
    console.log(`${rel}  ${(Buffer.byteLength(text) / 1024).toFixed(1)} KB  ← ${apiPath}`)
  }

  // Swap: two renames on one filesystem. public/data is briefly absent between
  // them (a build started then fails its check) but never partial.
  if (fs.existsSync(DATA_DIR)) fs.renameSync(DATA_DIR, PREVIOUS)
  fs.renameSync(STAGING, DATA_DIR)
  fs.rmSync(PREVIOUS, { recursive: true, force: true })
  console.log(`public/data: ${payloads.size} files`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => sql.end())
