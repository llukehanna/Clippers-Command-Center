import { describe, it, expect } from 'vitest'
import { coachTenures, executiveGroups, winPct } from './tenures'
import type { CoachSeason, ExecutiveTerm } from '@/src/lib/ui/types'

const person = (key: string, name: string) => ({ person_key: key, name, player_id: null, nba_person_id: null, href: null })
const cs = (season_id: number, ordinal: number, key: string, name: string, w: number | null, l: number | null, pw: number | null = null, pl: number | null = null): CoachSeason => ({
  season_id,
  season_label: `${season_id}-${String((season_id + 1) % 100).padStart(2, '0')}`,
  ordinal,
  coach: person(key, name),
  games: w == null || l == null ? null : w + l,
  wins: w,
  losses: l,
  playoff_wins: pw,
  playoff_losses: pl,
})

describe('coachTenures', () => {
  // Payload order: newest season first, ordinal ascending within a season.
  const rows = [
    cs(2024, 1, 'luety01', 'Tyronn Lue', 50, 32, 3, 4),
    cs(2023, 1, 'luety01', 'Tyronn Lue', 51, 31, null, null),
    cs(2002, 1, 'gentral01', 'Alvin Gentry', 14, 27),
    cs(2002, 2, 'dunlemi01', 'Mike Dunleavy', 17, 24),
    cs(2001, 1, 'gentral01', 'Alvin Gentry', null, null),
  ]

  it('groups consecutive seasons by coach, newest first, later mid-season coach first', () => {
    const t = coachTenures(rows)
    expect(t.map((x) => [x.coach.name, x.seasons.map((s) => s.season_id)])).toEqual([
      ['Tyronn Lue', [2024, 2023]],
      ['Mike Dunleavy', [2002]],
      ['Alvin Gentry', [2002, 2001]],
    ])
    expect(t[0]).toMatchObject({ first: 2023, last: 2024, wins: 101, losses: 63, playoffWins: 3, playoffLosses: 4 })
  })

  it('keeps an unknown record unknown rather than summing around it', () => {
    const gentry = coachTenures(rows)[2]
    expect(gentry.wins).toBeNull()
    expect(gentry.losses).toBeNull()
    expect(gentry.playoffWins).toBeNull()
  })

  it('notes mid-season changes on both coaches', () => {
    const t = coachTenures(rows)
    expect(t[1].seasons[0].note).toBe('Took over from Alvin Gentry · 41 games')
    expect(t[2].seasons[0].note).toBe('Replaced by Mike Dunleavy · 41 games')
    expect(t[0].seasons[0].note).toBeNull()
  })

  it('computes win percentage, null when unknown', () => {
    expect(winPct(50, 32)).toBeCloseTo(0.6098, 3)
    expect(winPct(null, 32)).toBeNull()
    expect(winPct(0, 0)).toBeNull()
  })
})

describe('executiveGroups', () => {
  const ex = (name: string, title: string | null, start: string | null, end: string | null): ExecutiveTerm => ({
    person: person(name.toLowerCase(), name),
    title,
    start_date: start,
    end_date: end,
  })
  it('groups by title, presidents before general managers, newest first within a group', () => {
    const groups = executiveGroups([
      ex('Michael Winger', 'General Manager', '2019-09-01', '2024-06-30'),
      ex('Lawrence Frank', 'President of Basketball Operations', '2017-06-12', null),
      ex('Elgin Baylor', 'Vice President of Basketball Operations', '1986-07-01', '2008-10-01'),
      ex('Gary Sacks', 'General Manager', '2013-08-01', '2014-06-01'),
      ex('Somebody', null, null, null),
    ])
    expect(groups.map((g) => [g.title, g.terms.map((t) => t.person.name)])).toEqual([
      ['President of Basketball Operations', ['Lawrence Frank']],
      ['Vice President of Basketball Operations', ['Elgin Baylor']],
      ['General Manager', ['Michael Winger', 'Gary Sacks']],
      ['Other', ['Somebody']],
    ])
  })
})
