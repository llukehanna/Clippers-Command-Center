// Player headshots from the NBA's public CDN, keyed by nba_player_id.

const SIZES = { sm: '260x190', lg: '1040x760' } as const

export function headshotUrl(
  nbaPlayerId: string | number | null | undefined,
  size: keyof typeof SIZES = 'sm',
): string | null {
  if (nbaPlayerId == null) return null
  const id = String(nbaPlayerId).trim()
  if (!/^\d+$/.test(id)) return null
  return `https://cdn.nba.com/headshots/nba/latest/${SIZES[size]}/${id}.png`
}

const SUFFIXES = new Set(['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv'])

export function initials(name: string): string {
  const parts = name.split(/\s+/).filter((p) => p && !SUFFIXES.has(p.toLowerCase()))
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts.at(-1)![0] : ''
  return (first + last).toUpperCase()
}
