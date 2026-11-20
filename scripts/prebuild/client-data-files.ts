// Which public/data files a production build needs (src/lib/ui/client-data.ts).
// Shared by the writer (client-data.ts) and the pre-build check (check-build.ts
// --client-data), so both agree on the list. Pure.

import { CLIENT_DATA_FIXED_PATHS, seasonGamesPath, staticDataPath } from '@/src/lib/ui/client-data'

/** Seasons whose games lists ship: the palette shows the two most recent, Live's idle state the latest. */
export const GAME_SEASONS = 2

/** The season ids whose games lists ship, from a /api/history/seasons body. Throws on an unexpected shape. */
export function latestSeasonIds(body: unknown): number[] {
  const seasons = (body as { seasons?: unknown } | null)?.seasons
  if (!Array.isArray(seasons) || seasons.length === 0) throw new Error('/api/history/seasons has no seasons')
  const ids = (seasons as Array<{ season_id?: unknown }>).map((s) => {
    if (typeof s?.season_id !== 'number') throw new Error('a season has no numeric season_id')
    return s.season_id
  })
  // Same choice the client makes: highest season ids first.
  return [...ids].sort((a, b) => b - a).slice(0, GAME_SEASONS)
}

/** Every API path whose /data file ships, given the /api/history/seasons body. */
export function clientDataApiPaths(seasonsBody: unknown): string[] {
  return [...CLIENT_DATA_FIXED_PATHS, ...latestSeasonIds(seasonsBody).map(seasonGamesPath)]
}

/** The /data file for an API path (throws when there is none). */
export function dataFileFor(apiPath: string): string {
  const rel = staticDataPath(apiPath)
  if (!rel) throw new Error(`no data file for ${apiPath}`)
  return rel
}
