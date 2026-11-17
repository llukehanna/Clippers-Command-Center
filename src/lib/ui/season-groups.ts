// Group the history season list by Clippers era (Buffalo Braves, San Diego Clippers, ...).

export interface EraSeason {
  season_id: number
  label: string
  team_name: string
}

export interface EraGroup<S extends EraSeason = EraSeason> {
  label: string
  seasons: S[]
}

/** Groups newest first; seasons inside each group are newest first. The latest era has an open end. */
export function groupSeasonsByEra<S extends EraSeason>(seasons: S[]): EraGroup<S>[] {
  const sorted = [...seasons].sort((a, b) => b.season_id - a.season_id)
  const groups: Array<{ team_name: string; seasons: S[] }> = []
  for (const s of sorted) {
    const last = groups[groups.length - 1]
    if (last && last.team_name === s.team_name) last.seasons.push(s)
    else groups.push({ team_name: s.team_name, seasons: [s] })
  }
  return groups.map((g, i) => {
    const first = g.seasons[g.seasons.length - 1].season_id
    const end = i === 0 ? '' : String((g.seasons[0].season_id + 1) % 100).padStart(2, '0')
    return { label: `${g.team_name} (${first}\u2013${end})`, seasons: g.seasons }
  })
}
