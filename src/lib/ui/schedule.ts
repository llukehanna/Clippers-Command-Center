// Schedule intelligence derived purely from game dates and venues:
// back-to-backs, rest days, home stands and road trips.

export interface Datable {
  game_date: string
}

export interface ScheduleLike extends Datable {
  home_away: 'home' | 'away'
}

export interface ScheduleAnnotation {
  /** Second night of a back-to-back. */
  b2b: boolean
  /** Full days off before this game; null when the previous game is unknown. */
  restDays: number | null
  /** Position inside a run of 3+ consecutive home or away games. */
  stand: { kind: 'home' | 'road'; index: number; length: number } | null
}

const DAY_MS = 86_400_000
const MIN_STAND = 3

function noonUtc(date: string): number {
  return Date.parse(`${date.slice(0, 10)}T12:00:00Z`)
}

/** Calendar days from a to b (YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
  return Math.round((noonUtc(b) - noonUtc(a)) / DAY_MS)
}

export function annotateSchedule<T extends ScheduleLike>(
  games: T[],
  previousGameDate?: string | null,
): Array<T & { annotation: ScheduleAnnotation }> {
  // Run lengths of consecutive same-venue games
  const runs: Array<{ start: number; length: number }> = []
  games.forEach((game, i) => {
    const last = runs.at(-1)
    if (last && games[last.start].home_away === game.home_away) last.length++
    else runs.push({ start: i, length: 1 })
  })

  const standFor = new Map<number, ScheduleAnnotation['stand']>()
  for (const run of runs) {
    if (run.length < MIN_STAND) continue
    const kind = games[run.start].home_away === 'home' ? 'home' : 'road'
    for (let k = 0; k < run.length; k++) {
      standFor.set(run.start + k, { kind, index: k + 1, length: run.length })
    }
  }

  return games.map((game, i) => {
    const prev = i === 0 ? previousGameDate ?? null : games[i - 1].game_date
    const gap = prev ? daysBetween(prev, game.game_date) : null
    return {
      ...game,
      annotation: {
        b2b: gap === 1,
        restDays: gap == null ? null : Math.max(0, gap - 1),
        stand: standFor.get(i) ?? null,
      },
    }
  })
}

export function groupByMonth<T extends Datable>(
  games: T[],
): Array<{ key: string; label: string; games: T[] }> {
  const groups: Array<{ key: string; label: string; games: T[] }> = []
  for (const game of games) {
    const key = game.game_date.slice(0, 7)
    let group = groups.at(-1)
    if (!group || group.key !== key) {
      const label = new Date(noonUtc(game.game_date)).toLocaleDateString('en-US', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      })
      group = { key, label, games: [] }
      groups.push(group)
    }
    group.games.push(game)
  }
  return groups
}
