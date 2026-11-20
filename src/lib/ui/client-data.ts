// Where client components fetch read-only data. In production builds
// (NEXT_PUBLIC_STATIC_DATA=1, set in .env.production) the API paths they use
// are prebuilt JSON files under public/data, served as plain static assets with
// no Worker invocation (scripts/prebuild/client-data.ts writes them before
// `next build`). In dev the same components keep hitting /api/*.
// Live data (/api/live, /api/media) is fetched directly, never through here.

const FIXED: Record<string, string> = {
  '/api/history/seasons': '/data/history/seasons.json',
  '/api/players': '/data/players.json',
  '/api/players/all-time': '/data/players/all-time.json',
  '/api/franchise/moves?type=trade': '/data/franchise/trades.json',
  '/api/franchise/people': '/data/franchise/people.json',
  '/api/home': '/data/home.json',
}

/** The API paths with one fixed data file each (the build writes all of them). */
export const CLIENT_DATA_FIXED_PATHS: readonly string[] = Object.keys(FIXED)

const SEASON_GAMES = /^\/api\/history\/games\?season_id=(\d+)&limit=200$/

/**
 * The season games list as the client requests it. The build writes the two
 * latest seasons' files (the palette lists the two most recent seasons; Live's
 * idle state reads the latest).
 */
export const seasonGamesPath = (seasonId: number) => `/api/history/games?season_id=${seasonId}&limit=200`

/** The /data file for an API path, or null when it has none. Independent of the env flag. */
export function staticDataPath(apiPath: string): string | null {
  if (Object.hasOwn(FIXED, apiPath)) return FIXED[apiPath]
  const m = apiPath.match(SEASON_GAMES)
  return m ? `/data/history/games/${m[1]}.json` : null
}

/** The URL a client component fetches for an API path: its /data file in static builds, else the path itself. */
export function clientDataUrl(apiPath: string): string {
  // Referenced literally so `next build` inlines it into the client bundle.
  if (process.env.NEXT_PUBLIC_STATIC_DATA !== '1') return apiPath
  const file = staticDataPath(apiPath)
  if (!file) throw new Error(`clientDataUrl: no static data file for ${apiPath}`)
  return file
}
