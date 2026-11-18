// src/lib/franchise/tenures.ts
// Front office: head-coach tenures from coach_seasons rows, executives grouped by title. Pure.
// Unknown stays unknown: a tenure with any unknown season record has an unknown total.

import type { CoachSeason, ExecutiveTerm, FranchisePersonRef } from '@/src/lib/ui/types'

export interface TenureSeason extends CoachSeason {
  /** Mid-season change: "Took over from X · 41 games" / "Replaced by Y · 41 games". */
  note: string | null
}

export interface Tenure {
  key: string
  coach: FranchisePersonRef
  /** Newest first. */
  seasons: TenureSeason[]
  first: number
  last: number
  wins: number | null
  losses: number | null
  /** Sum of the playoff records that are recorded; null when none are. */
  playoffWins: number | null
  playoffLosses: number | null
}

export function winPct(w: number | null, l: number | null): number | null {
  if (w == null || l == null || w + l === 0) return null
  return w / (w + l)
}

const gamesNote = (s: CoachSeason) => (s.games != null ? ` · ${s.games} games` : '')

export function coachTenures(rows: CoachSeason[]): Tenure[] {
  // Newest season first; within a season the later coach (higher ordinal) first.
  const sorted = [...rows].sort((a, b) => b.season_id - a.season_id || b.ordinal - a.ordinal)
  const bySeason = new Map<number, CoachSeason[]>()
  for (const r of rows) bySeason.set(r.season_id, [...(bySeason.get(r.season_id) ?? []), r])

  const noteFor = (s: CoachSeason): string | null => {
    const same = (bySeason.get(s.season_id) ?? []).sort((a, b) => a.ordinal - b.ordinal)
    if (same.length < 2) return null
    const i = same.findIndex((x) => x.ordinal === s.ordinal)
    const before = same[i - 1]
    const after = same[i + 1]
    if (before) return `Took over from ${before.coach.name}${gamesNote(s)}`
    if (after) return `Replaced by ${after.coach.name}${gamesNote(s)}`
    return null
  }

  const tenures: Tenure[] = []
  for (const s of sorted) {
    const cur = tenures.at(-1)
    const season: TenureSeason = { ...s, note: noteFor(s) }
    if (cur && cur.coach.person_key === s.coach.person_key && cur.first - s.season_id <= 1) {
      cur.seasons.push(season)
      cur.first = s.season_id
    } else {
      tenures.push({
        key: `${s.coach.person_key}-${s.season_id}-${s.ordinal}`,
        coach: s.coach,
        seasons: [season],
        first: s.season_id,
        last: s.season_id,
        wins: null,
        losses: null,
        playoffWins: null,
        playoffLosses: null,
      })
    }
  }

  for (const t of tenures) {
    const known = t.seasons.every((s) => s.wins != null && s.losses != null)
    t.wins = known ? t.seasons.reduce((n, s) => n + (s.wins ?? 0), 0) : null
    t.losses = known ? t.seasons.reduce((n, s) => n + (s.losses ?? 0), 0) : null
    const po = t.seasons.filter((s) => s.playoff_wins != null && s.playoff_losses != null)
    t.playoffWins = po.length ? po.reduce((n, s) => n + (s.playoff_wins ?? 0), 0) : null
    t.playoffLosses = po.length ? po.reduce((n, s) => n + (s.playoff_losses ?? 0), 0) : null
  }
  return tenures
}

export interface ExecutiveGroup {
  title: string
  /** Newest start first. */
  terms: ExecutiveTerm[]
}

/** Rank of a title: presidents, then vice presidents, then general managers, then the rest. */
function titleRank(title: string): number {
  const t = title.toLowerCase()
  if (t.startsWith('president')) return 0
  if (t.includes('president')) return 1
  if (t.includes('general manager')) return 2
  return 3
}

export function executiveGroups(terms: ExecutiveTerm[]): ExecutiveGroup[] {
  const groups = new Map<string, ExecutiveTerm[]>()
  for (const t of terms) {
    const title = t.title?.trim() || 'Other'
    groups.set(title, [...(groups.get(title) ?? []), t])
  }
  const byStart = (a: ExecutiveTerm, b: ExecutiveTerm) => (b.start_date ?? '').localeCompare(a.start_date ?? '')
  return [...groups.entries()]
    .map(([title, list]) => ({ title, terms: [...list].sort(byStart) }))
    .sort((a, b) => (a.title === 'Other' ? 1 : 0) - (b.title === 'Other' ? 1 : 0) || titleRank(a.title) - titleRank(b.title))
}
