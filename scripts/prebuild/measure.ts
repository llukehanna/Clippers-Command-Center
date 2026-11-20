// Read-only payload size measurement for the prebuilt-site plan (Task 2 gate).
// Loads ~10 real samples per page class through loadPath (the same loaders the
// build will use), prints mean JSON bytes per class, and projects Neon transfer.
//   npm run prebuild:measure   (writes .prebuild/measure.txt as well)

import { mkdirSync, writeFileSync } from 'node:fs'
import { loadPath } from '@/src/lib/data/routes'

const WIRE = 1.5 // overhead multiplier on JSON bytes
const GATE_BYTES = 1e9 // 1 GB/month
const BUILDS_PER_DAY = 8
const SETTLED_DAYS = 75
const lines: string[] = []
const out = (s = '') => {
  console.log(s)
  lines.push(s)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

async function bytes(path: string): Promise<number | null> {
  const r = await loadPath(path)
  if (r.status !== 200) {
    out(`  ! ${r.status} ${path}`)
    return null
  }
  return Buffer.byteLength(JSON.stringify(r.body))
}

async function body(path: string): Promise<Any> {
  const r = await loadPath(path)
  if (r.status !== 200) throw new Error(`${r.status} ${path}`)
  return r.body
}

/** Evenly spread n picks across an array. */
function spread<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice()
  return Array.from({ length: n }, (_, i) => arr[Math.floor((i * arr.length) / n)])
}

async function sumPaths(paths: string[]): Promise<number[]> {
  const sizes: number[] = []
  for (const p of paths) {
    const b = await bytes(p)
    if (b != null) sizes.push(b)
  }
  return sizes
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)
const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`
const mb = (n: number) => (n < 1048576 ? kb(n) : `${(n / 1048576).toFixed(1)} MB`)
const gb = (n: number) => `${(n / 1e9).toFixed(3)} GB`

async function main() {
  const means: Record<string, number> = {}
  const record = (name: string, sizes: number[], count: number) => {
    means[name] = mean(sizes)
    out(`${name.padEnd(22)} n=${String(sizes.length).padStart(2)}  mean ${kb(means[name]).padStart(10)}  x ${String(count).padStart(5)} = ${mb(means[name] * count)}`)
  }

  out(`Payload measurement ${new Date().toISOString()}`)
  out('Class                  samples   mean JSON        x count = full-fill bytes')

  // ids
  const seasons: Any = await body('/api/history/seasons')
  const seasonIds: number[] = seasons.seasons.map((s: Any) => s.season_id)
  const allTime: Any = await body('/api/players/all-time')
  const players: Any[] = allTime.players
  const roster: Any = await body('/api/players?include_traded=true')
  const schedule: Any = await body('/api/schedule')

  // history games: 3 seasons spread, ~10 samples -> game + story
  const gameIds: string[] = []
  for (const [sid, n] of [[1975, 4], [2000, 3], [2024, 3]] as const) {
    const l: Any = await body(`/api/history/games?season_id=${sid}&limit=200`)
    gameIds.push(...spread<Any>(l.games, n).map((g) => String(g.game_id)))
  }
  const gameSizes = await sumPaths(gameIds.map((id) => `/api/history/games/${id}`))
  const storySizes = await sumPaths(gameIds.map((id) => `/api/history/games/${id}/story`))
  // one history game page = game + story; combine per-sample sums
  const pairs = gameSizes.map((g, i) => g + (storySizes[i] ?? 0))
  record('history game (+story)', pairs, 4700)

  // season game lists
  const listSeasons = spread(seasonIds, 10)
  record('season game list', await sumPaths(listSeasons.map((s) => `/api/history/games?season_id=${s}&limit=200`)), 57)

  // players
  const samplePlayers = spread(players, 10)
  record('player detail', await sumPaths(samplePlayers.map((p) => `/api/players/${p.player_id}?lac_only=true`)), 508)
  record(
    'player season detail',
    await sumPaths(samplePlayers.map((p) => `/api/players/${p.player_id}?season_id=${Math.round((p.first_season + p.last_season) / 2)}`)),
    963,
  )
  record('player career', await sumPaths(samplePlayers.map((p) => `/api/players/${p.player_id}/career`)), 508)

  // trades
  const trades: Any[] = []
  for (const s of spread(seasonIds.filter((y) => y >= 1990), 8)) {
    const m: Any = await body(`/api/franchise/moves?type=trade&season=${s}`)
    trades.push(...m.moves.slice(0, 2))
  }
  const tradeSlugs = spread(trades, 10).map((t) => t.slug)
  record('trade', await sumPaths(tradeSlugs.map((s) => `/api/franchise/trades/${s}`)), 203)

  // moves type x season
  const types = ['all', 'trade', 'signing', 'draft', 'release', 'other']
  const movePaths = spread(seasonIds, 10).map((s, i) => `/api/franchise/moves?type=${types[i % types.length]}&season=${s}`)
  record('moves (type x season)', await sumPaths(movePaths), 300)

  // franchise singletons (7 pages)
  const single: Record<string, number> = {}
  const singlePaths = [
    '/api/franchise/people',
    '/api/franchise/draft',
    '/api/franchise/contracts',
    '/api/franchise/picks',
    '/api/franchise/front-office',
    '/api/franchise/honors',
    '/api/players/all-time',
  ]
  const singleSizes: number[] = []
  for (const p of singlePaths) {
    const b = await bytes(p)
    if (b != null) {
      single[p] = b
      singleSizes.push(b)
    }
  }
  record('franchise singletons', singleSizes, 7)
  for (const [p, b] of Object.entries(single)) out(`    ${p.padEnd(30)} ${kb(b)}`)

  // home / schedule / previews
  const homeSize = (await bytes('/api/home')) ?? 0
  const scheduleSize = (await bytes('/api/schedule')) ?? 0
  record('home', [homeSize], 1)
  record('schedule', [scheduleSize], 1)
  const upcoming: Any[] = schedule.games.filter((g: Any) => g.status !== 'final')
  const previewIds = spread(upcoming.length >= 10 ? upcoming : schedule.games, 10).map((g: Any) => g.game_id)
  record('game preview', await sumPaths(previewIds.map((id: string) => `/api/schedule/${id}`)), 90)

  // ---- projections
  const counts: Record<string, number> = {
    'history game (+story)': 4700,
    'season game list': 57,
    'player detail': 508,
    'player season detail': 963,
    'player career': 508,
    trade: 203,
    'moves (type x season)': 300,
    'franchise singletons': 7,
    home: 1,
    schedule: 1,
    'game preview': 90,
  }
  const fullDb = Object.entries(counts).reduce((s, [k, c]) => s + (means[k] ?? 0) * c, 0)
  const full = fullDb * WIRE

  // volatile set per build (Task 4 rules)
  const rosterN: number = roster.players.length
  const today = new Date()
  // The schedule payload only holds unplayed games; finished ones come from the
  // current season's history list.
  const currentList: Any = await body(`/api/history/games?season_id=${Math.max(...seasonIds)}&limit=200`)
  const recentGames = currentList.games.filter((g: Any) => {
    const d = new Date(g.game_date + 'T00:00:00Z')
    const age = (today.getTime() - d.getTime()) / 86400000
    return age >= 0 && age <= 14
  }).length
  const currentMoves = 6 // current-season moves variants (all + a handful of types)
  const volatile = {
    home: homeSize,
    schedule: scheduleSize,
    'game previews (all)': means['game preview'] * 90,
    'current-season game list': means['season game list'] * 1,
    'current-season moves': means['moves (type x season)'] * currentMoves,
    [`roster players detail+career (${rosterN})`]: (means['player detail'] + means['player career']) * rosterN,
    [`recent 14d games +story (${recentGames})`]: means['history game (+story)'] * recentGames,
    contracts: single['/api/franchise/contracts'] ?? 0,
    picks: single['/api/franchise/picks'] ?? 0,
    'all-time': single['/api/players/all-time'] ?? 0,
  }
  const perBuildDb = Object.values(volatile).reduce((a, b) => a + b, 0)
  const perBuild = perBuildDb * WIRE
  const settledPerMonth = (full / SETTLED_DAYS) * 30
  const perMonth = perBuild * BUILDS_PER_DAY * 30 + settledPerMonth

  out('')
  out('Volatile set per build (DB bytes):')
  for (const [k, v] of Object.entries(volatile)) out(`  ${k.padEnd(42)} ${mb(v)}`)
  out('')
  out(`full fill   = sum(class mean x count) x ${WIRE} wire = ${mb(full)} (${gb(full)})`)
  out(`per build   = volatile set x ${WIRE} = ${mb(perBuild)} (${gb(perBuild)})`)
  out(`settled/mo  = full / ${SETTLED_DAYS} d x 30 = ${mb(settledPerMonth)}`)
  out(`per month   = per build x ${BUILDS_PER_DAY} x 30 + settled = ${gb(perMonth)}`)
  out('')
  out(
    perMonth > GATE_BYTES
      ? `GATE: FAIL (${(perMonth / 1e9).toFixed(2)} GB/month > 1 GB)`
      : `GATE: PASS (${(perMonth / 1e9).toFixed(2)} GB/month <= 1 GB)`,
  )

  mkdirSync('.prebuild', { recursive: true })
  writeFileSync('.prebuild/measure.txt', lines.join('\n') + '\n')
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
