import { describe, it, expect } from 'vitest'
import { groupSeasonsByEra } from './season-groups'

const s = (season_id: number, team_name: string) => ({ season_id, label: `${season_id}-${String((season_id + 1) % 100).padStart(2, '0')}`, team_name })

describe('groupSeasonsByEra', () => {
  it('groups by era, newest first, with an open end on the latest era', () => {
    const groups = groupSeasonsByEra([
      s(1976, 'Buffalo Braves'),
      s(1977, 'Buffalo Braves'),
      s(1978, 'San Diego Clippers'),
      s(1984, 'Los Angeles Clippers'),
      s(2026, 'Los Angeles Clippers'),
    ])
    expect(groups.map((g) => g.label)).toEqual([
      'Los Angeles Clippers (1984–)',
      'San Diego Clippers (1978–79)',
      'Buffalo Braves (1976–78)',
    ])
    expect(groups[0].seasons.map((x) => x.season_id)).toEqual([2026, 1984])
  })
  it('returns [] for no seasons', () => {
    expect(groupSeasonsByEra([])).toEqual([])
  })
})
