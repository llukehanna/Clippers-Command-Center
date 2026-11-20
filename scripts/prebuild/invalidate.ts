// Drops stale entries from the build-time payload cache before a build.
//   PREBUILD_CACHE_DIR=.prebuild/payloads npm run prebuild:invalidate [-- --full]
// --full deletes every cache entry. Otherwise computes a small context from
// the database (read-only SELECTs) and drops entries per dropReason. A DB error
// or an empty roster exits non-zero before any entry is deleted.
//
// Only ever deletes cache files (*.json entries, *.tmp leftovers) directly
// inside PREBUILD_CACHE_DIR, never the directory itself, and refuses a
// directory that is unset, the repo root, or outside the repo (cache-dir.ts).

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db'
import { getDisplaySeasonId } from '@/src/lib/season'
import { loadPath } from '@/src/lib/data/routes'
import type { CachedPayload } from '@/src/lib/prebuild/payload-cache'
import { dropReason, personKeysInMoves, rosterIdsFrom, type ClassifyContext } from './classify'
import { cacheDirProblem, isCacheFile, isTmpFile } from './cache-dir'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

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
  const rosterIds = rosterIdsFrom(roster.status, roster.body) // throws on a failed or empty roster

  // Everyone with a move in the newest season: their person pages refresh every build.
  const latestMoves = await loadPath('/api/franchise/moves?type=all&season=latest')
  const currentSeasonPersonKeys = personKeysInMoves(latestMoves.status, latestMoves.body)

  return {
    currentSeasonId,
    recentGameIds: new Set(games.map((r) => r.game_id)),
    rosterIds,
    currentSeasonPersonKeys,
  }
}

/** The cache directory (symlinks resolved) after the safety checks; throws when it is unsafe. */
function cacheDir(): string {
  const real = (p: string) => (fs.existsSync(p) ? fs.realpathSync(p) : p)
  const root = real(REPO_ROOT)
  const cwd = real(process.cwd())
  const raw = process.env.PREBUILD_CACHE_DIR
  const problem = cacheDirProblem(raw, root, cwd)
  if (problem) throw new Error(problem)
  const dir = real(path.resolve(cwd, raw!))
  const resolvedProblem = cacheDirProblem(dir, root, cwd) // a symlink can't point it elsewhere
  if (resolvedProblem) throw new Error(resolvedProblem)
  if (fs.existsSync(dir) && !fs.statSync(dir).isDirectory()) throw new Error(`PREBUILD_CACHE_DIR (${dir}) is not a directory`)
  return dir
}

/** Names of the regular files directly in `dir` that `keep` accepts. */
function filesIn(dir: string, keep: (name: string) => boolean): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && keep(e.name))
    .map((e) => e.name)
}

async function main() {
  const dir = cacheDir()

  // Leftovers from a build that crashed mid-write are never valid entries.
  const tmps = filesIn(dir, isTmpFile)
  for (const f of tmps) fs.rmSync(path.join(dir, f), { force: true })

  if (process.argv.includes('--full')) {
    const files = filesIn(dir, isCacheFile)
    for (const f of files) fs.rmSync(path.join(dir, f), { force: true })
    fs.mkdirSync(dir, { recursive: true })
    console.log(`full reset: dropped ${files.length} (tmp ${tmps.length})`)
    return
  }

  const files = filesIn(dir, isCacheFile)
  if (files.length === 0) {
    console.log(`kept 0, dropped 0 (volatile 0, expired 0, invalid 0, tmp ${tmps.length})`)
    return
  }

  const ctx = await buildContext() // throws on a DB error or an empty roster, before any entry is deleted
  const now = new Date()
  const counts = { kept: 0, volatile: 0, expired: 0, invalid: 0 }
  for (const f of files) {
    const file = path.join(dir, f)
    let entry: CachedPayload
    try {
      entry = JSON.parse(fs.readFileSync(file, 'utf8')) as CachedPayload
    } catch {
      fs.rmSync(file, { force: true }) // unreadable entry: never reuse it
      counts.invalid++
      continue
    }
    const reason = dropReason(entry, ctx, now)
    if (reason === null) {
      counts.kept++
    } else {
      fs.rmSync(file, { force: true })
      counts[reason]++
    }
  }
  const dropped = counts.volatile + counts.expired + counts.invalid
  console.log(
    `kept ${counts.kept}, dropped ${dropped} ` +
      `(volatile ${counts.volatile}, expired ${counts.expired}, invalid ${counts.invalid}, tmp ${tmps.length})`,
  )
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => sql.end())
