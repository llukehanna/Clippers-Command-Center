// Drops stale entries from the build-time payload cache before a build.
//   PREBUILD_CACHE_DIR=.prebuild/payloads npm run prebuild:invalidate [-- --full]
// --full empties the directory. Otherwise computes a small context from the
// database (read-only SELECTs) and drops entries per shouldDrop. A DB error
// exits non-zero before anything is deleted.

import fs from 'node:fs'
import path from 'node:path'
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db'
import { getDisplaySeasonId } from '@/src/lib/season'
import { loadPath } from '@/src/lib/data/routes'
import type { CachedPayload } from '@/src/lib/prebuild/payload-cache'
import { shouldDrop, classify, type ClassifyContext } from './classify'

async function buildContext(): Promise<ClassifyContext> {
  const currentSeasonId = await getDisplaySeasonId()

  const games = await sql<{ game_id: string }[]>`
    SELECT g.game_id::text AS game_id
    FROM games g
    WHERE (
        g.home_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
        OR g.away_team_id = (SELECT team_id FROM teams WHERE nba_team_id = ${LAC_NBA_TEAM_ID})
      )
      AND (g.game_date >= CURRENT_DATE - 14 OR lower(g.status) <> 'final')
  `

  const roster = await loadPath('/api/players?include_traded=true')
  if (roster.status !== 200) throw new Error(`roster load failed: ${roster.status}`)
  const players = (roster.body as { players?: Array<{ player_id: string }> }).players
  if (!Array.isArray(players)) throw new Error('roster payload has no players array')

  return {
    currentSeasonId,
    recentGameIds: new Set(games.map((r) => r.game_id)),
    rosterIds: new Set(players.map((p) => String(p.player_id))),
  }
}

function cacheEntries(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json')) : []
}

async function main() {
  const dir = process.env.PREBUILD_CACHE_DIR
  if (!dir) throw new Error('PREBUILD_CACHE_DIR is not set')

  if (process.argv.includes('--full')) {
    const n = cacheEntries(dir).length
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
    console.log(`full reset: dropped ${n}`)
    return
  }

  const files = cacheEntries(dir)
  if (files.length === 0) {
    console.log('kept 0, dropped 0 (volatile 0, expired 0)')
    return
  }

  const ctx = await buildContext() // throws on DB error, before any deletion
  const now = new Date()
  let kept = 0
  let volatile = 0
  let expired = 0
  for (const f of files) {
    const file = path.join(dir, f)
    let entry: CachedPayload
    try {
      entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedPayload
    } catch {
      fs.rmSync(file, { force: true }) // unreadable entry: never reuse it
      expired++
      continue
    }
    if (!shouldDrop(entry, ctx, now)) {
      kept++
    } else {
      fs.rmSync(file, { force: true })
      if (classify(entry.path, ctx) === 'volatile') volatile++
      else expired++
    }
  }
  console.log(`kept ${kept}, dropped ${volatile + expired} (volatile ${volatile}, expired ${expired})`)
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
