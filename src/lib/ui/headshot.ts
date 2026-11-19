// Player headshots from the NBA's public CDN, keyed by nba_player_id.

const SIZES = { sm: '260x190', lg: '1040x760' } as const

export function headshotUrl(
  nbaPlayerId: string | number | null | undefined,
  size: keyof typeof SIZES = 'sm',
): string | null {
  if (nbaPlayerId == null) return null
  const id = String(nbaPlayerId).trim()
  // NBA person ids run 2–7 digits: older players have short ones (Eric
  // Piatkowski 15, Elton Brand 1882), current ones 6–7 (202695, 1629636).
  // Every caller passes players.nba_person_id (or an NBA box score id); the
  // 8+-digit balldontlie ids still in players.nba_player_id would 404.
  if (!/^\d{2,7}$/.test(id)) return null
  return `https://cdn.nba.com/headshots/nba/latest/${SIZES[size]}/${id}.png`
}

const LAC_TEAM_ID = 1610612746
/** The NBA CDN has team-and-season headshots from about 2015–16 on. */
const FIRST_TEAM_HEADSHOT_SEASON = 2015

/**
 * The player in a Clippers jersey: the headshot from a given Clippers season
 * (season start year). Null for seasons the CDN doesn't cover; callers fall
 * back to headshotUrl (the latest photo, in whatever team he's on now).
 */
export function clippersHeadshotUrl(
  nbaPlayerId: string | number | null | undefined,
  season: number | null | undefined,
  size: keyof typeof SIZES = 'sm',
): string | null {
  if (season == null || season < FIRST_TEAM_HEADSHOT_SEASON) return null
  const latest = headshotUrl(nbaPlayerId, size)
  return latest ? latest.replace('/latest/', `/${LAC_TEAM_ID}/${season}/`) : null
}

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv'])

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter((p) => p && !SUFFIXES.has(p.toLowerCase()))
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts.at(-1)![0] : ''
  return (first + last).toUpperCase()
}
