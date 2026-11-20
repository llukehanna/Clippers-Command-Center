import { describe, it, expect } from 'vitest'
import {
  seasonLabel,
  moveDate,
  monthYear,
  money,
  oddsPercent,
  ordinal,
  kindLabel,
  lotteryLine,
  highlightNames,
  eraOf,
  teamPlace,
  possessive,
  movesHref,
  adjacentSeasons,
  groupBySeason,
  franchiseTab,
  allowsAllSeasons,
  parseMovesSeason,
  parseMoveType,
  MOVE_TYPES,
  personMoves,
  draftPickOutcome,
  draftYearMeta,
  partialWord,
} from './display'
import { TEAM_NOT_RECORDED, teamFullName } from './franchise-ids'

const team = (abbreviation: string | null, city: string | null, name: string | null, is_clippers = false) => ({
  franchise_id: 1,
  abbreviation,
  city,
  name,
  is_clippers,
})

describe('seasonLabel', () => {
  it('formats a start year as a season with an en dash', () => {
    expect(seasonLabel(2019)).toBe('2019–20')
    expect(seasonLabel(1999)).toBe('1999–00')
    expect(seasonLabel(null)).toBe('—')
  })
})

describe('dates', () => {
  it('formats move dates and keeps unknown as —', () => {
    expect(moveDate('2019-07-10')).toBe('Jul 10, 2019')
    expect(moveDate(null)).toBe('—')
    expect(monthYear('2019-07-10')).toBe('Jul 2019')
    expect(monthYear(null)).toBe('—')
  })
})

describe('money', () => {
  it('shows millions with one decimal, thousands without, and — for unknown', () => {
    expect(money(50_300_000)).toBe('$50.3M')
    expect(money(750_000)).toBe('$750K')
    expect(money(0)).toBe('$0')
    expect(money(null)).toBe('—')
  })
})

describe('oddsPercent', () => {
  it('reads odds_first as a 0–1 fraction', () => {
    expect(oddsPercent(0.177)).toBe('17.7%')
    expect(oddsPercent(0.028)).toBe('2.8%')
    expect(oddsPercent(null)).toBe('—')
  })
})

describe('ordinal and kind labels', () => {
  it('builds English ordinals', () => {
    expect([1, 2, 3, 4, 8, 11, 12, 13, 21, 22].map(ordinal)).toEqual(['1st', '2nd', '3rd', '4th', '8th', '11th', '12th', '13th', '21st', '22nd'])
  })
  it('labels move kinds, with a readable fallback', () => {
    expect(kindLabel('re_signing')).toBe('Re-signing')
    expect(kindLabel('ten_day')).toBe('10-day')
    expect(kindLabel('two_way')).toBe('Two-way')
    expect(kindLabel('sign_and_trade')).toBe('Sign and trade')
  })
})

describe('lotteryLine', () => {
  it('describes a jump, a fall and a hold, with unknown odds as —', () => {
    expect(lotteryLine({ pre_lottery_slot: 8, odds_first: 0.028, pick_won: 1, tie_unresolved: false, movement: 'jumped', source: 'wiki' })).toEqual({
      entered: 'Entered 8th',
      odds: '2.8% odds',
      outcome: 'won No. 1, up 7',
      tone: 'pos',
    })
    expect(lotteryLine({ pre_lottery_slot: 6, odds_first: null, pick_won: 7, tie_unresolved: false, movement: 'fell', source: 'wiki' })).toEqual({
      entered: 'Entered 6th',
      odds: 'odds —',
      outcome: 'fell to No. 7, down 1',
      tone: 'neg',
    })
    expect(lotteryLine({ pre_lottery_slot: 1, odds_first: null, pick_won: 1, tie_unresolved: null, movement: 'held', source: 'wiki' }).outcome).toBe('stayed No. 1')
  })
  it('never guesses a movement when the slot or the result is unknown', () => {
    expect(lotteryLine({ pre_lottery_slot: null, odds_first: null, pick_won: 4, tie_unresolved: null, movement: null, source: 'derived' })).toEqual({
      entered: 'Entry slot —',
      odds: 'odds —',
      outcome: 'landed No. 4',
      tone: 'default',
    })
  })
})

describe('highlightNames', () => {
  it('splits a description into plain text and the people it names', () => {
    expect(highlightNames('The Clippers acquired Paul George from Oklahoma City for Shai Gilgeous-Alexander.', ['Paul George', 'Shai Gilgeous-Alexander'])).toEqual([
      { text: 'The Clippers acquired ' },
      { text: 'Paul George', name: 'Paul George' },
      { text: ' from Oklahoma City for ' },
      { text: 'Shai Gilgeous-Alexander', name: 'Shai Gilgeous-Alexander' },
      { text: '.' },
    ])
  })
  it('matches the longest name first and leaves unnamed text alone', () => {
    expect(highlightNames('Marcus Morris Sr. joined.', ['Marcus Morris', 'Marcus Morris Sr.'])).toEqual([
      { text: 'Marcus Morris Sr.', name: 'Marcus Morris Sr.' },
      { text: ' joined.' },
    ])
    expect(highlightNames('No people here.', [])).toEqual([{ text: 'No people here.' }])
  })
  it('does not match inside a longer word', () => {
    expect(highlightNames('Al Jefferson and Al', ['Al'])).toEqual([
      { text: 'Al', name: 'Al' },
      { text: ' Jefferson and ' },
      { text: 'Al', name: 'Al' },
    ])
    expect(highlightNames('Alvin', ['Al'])).toEqual([{ text: 'Alvin' }])
  })
})

describe('eras and teams', () => {
  it('maps a season to the franchise era', () => {
    expect(eraOf(1970).key).toBe('BUF')
    expect(eraOf(1977).key).toBe('BUF')
    expect(eraOf(1978).key).toBe('SDC')
    expect(eraOf(1983).key).toBe('SDC')
    expect(eraOf(1984).key).toBe('LAC')
  })
  it('names a team by city, then name, then abbreviation', () => {
    expect(teamPlace(team('PHI', 'Philadelphia', '76ers'))).toBe('Philadelphia')
    expect(teamPlace(team('SEA', null, 'SuperSonics'))).toBe('SuperSonics')
    expect(teamPlace(team('SEA', null, null))).toBe('SEA')
    expect(teamPlace(null)).toBe('an unknown team')
    expect(possessive(team('PHI', 'Philadelphia', '76ers'))).toBe('Philadelphia’s')
    expect(possessive(team('DAL', 'Dallas', 'Mavericks'))).toBe('Dallas’')
  })
})

describe('moves navigation', () => {
  it('builds Moves paths: /franchise for trades in the latest season', () => {
    expect(movesHref({ season: null, type: 'trade', player: null })).toBe('/franchise')
  })
  it('builds /franchise/moves/<type> for another type in its latest season', () => {
    expect(movesHref({ season: null, type: 'draft', player: null })).toBe('/franchise/moves/draft')
    expect(movesHref({ season: null, type: 'all', player: null })).toBe('/franchise/moves/all')
  })
  it('builds /franchise/moves/<type>/<season|all> for a chosen season', () => {
    expect(movesHref({ season: 'all', type: 'trade', player: null })).toBe('/franchise/moves/trade/all')
    expect(movesHref({ season: 2019, type: 'signing', player: null })).toBe('/franchise/moves/signing/2019')
    expect(movesHref({ season: 2019, type: 'trade', player: null })).toBe('/franchise/moves/trade/2019')
  })
  it('drops All seasons where it is not offered (that type opens on its latest season, as before)', () => {
    expect(movesHref({ season: 'all', type: 'signing', player: null })).toBe('/franchise/moves/signing')
    expect(movesHref({ season: 'all', type: 'all', player: null })).toBe('/franchise/moves/all')
  })
  it('sends any player filter to that person page (type and season are toggles there)', () => {
    expect(movesHref({ season: 'all', type: 'all', player: 'paulch01' })).toBe('/franchise/person/paulch01')
    expect(movesHref({ season: 2019, type: 'trade', player: 'paulch01' })).toBe('/franchise/person/paulch01')
    // The path Next prerenders: it escapes only the path delimiters in a param, so a colon stays raw.
    expect(movesHref({ season: null, type: 'signing', player: 'nba:1641715' })).toBe('/franchise/person/nba:1641715')
    expect(movesHref({ season: null, type: 'all', player: 'a/b?c#d' })).toBe('/franchise/person/a%2Fb%3Fc%23d')
  })
  it('reads a move type segment', () => {
    expect(MOVE_TYPES).toEqual(['trade', 'signing', 'release', 'draft', 'other', 'all'])
    for (const t of MOVE_TYPES) expect(parseMoveType(t)).toBe(t)
    expect(parseMoveType('trades')).toBeNull()
    expect(parseMoveType('')).toBeNull()
    expect(parseMoveType(undefined)).toBeNull()
  })
  it('offers All seasons only where the list stays bounded (Trades, or one player)', () => {
    expect(allowsAllSeasons({ type: 'trade', player: null })).toBe(true)
    expect(allowsAllSeasons({ type: 'all', player: 'paulch01' })).toBe(true)
    expect(allowsAllSeasons({ type: 'all', player: null })).toBe(false)
    expect(allowsAllSeasons({ type: 'signing', player: null })).toBe(false)
  })
  it('reads the season param: a year, all where allowed, otherwise the latest-season default', () => {
    expect(parseMovesSeason('2019', { type: 'signing', player: null })).toBe(2019)
    expect(parseMovesSeason('all', { type: 'trade', player: null })).toBe('all')
    expect(parseMovesSeason('all', { type: 'all', player: null })).toBeNull()
    expect(parseMovesSeason(undefined, { type: 'trade', player: null })).toBeNull()
    expect(parseMovesSeason('19x', { type: 'trade', player: null })).toBeNull()
  })
  it('finds the newer and older seasons around the selected one', () => {
    expect(adjacentSeasons([2025, 2019, 2016], 2019)).toEqual({ newer: 2025, older: 2016 })
    expect(adjacentSeasons([2025, 2019, 2016], 2025)).toEqual({ newer: null, older: 2019 })
    expect(adjacentSeasons([2025, 2016], 2019)).toEqual({ newer: 2025, older: 2016 })
  })
  it('groups rows by season in the order given, unknown seasons last', () => {
    const rows = [{ season_id: 2019, id: 'a' }, { season_id: null, id: 'b' }, { season_id: 2019, id: 'c' }, { season_id: 2016, id: 'd' }]
    expect(groupBySeason(rows).map((g) => [g.season_id, g.rows.map((r) => r.id)])).toEqual([
      [2019, ['a', 'c']],
      [2016, ['d']],
      [null, ['b']],
    ])
  })
})

describe('franchiseTab', () => {
  it('maps each tab URL to its tab, and trade pages to Moves', () => {
    expect(franchiseTab('/franchise')).toBe('moves')
    expect(franchiseTab('/franchise/draft')).toBe('draft')
    expect(franchiseTab('/franchise/front-office')).toBe('front-office')
    expect(franchiseTab('/franchise/trades/2019-07-10-paul-george')).toBe('moves')
  })
})

describe('draftPickOutcome and draftYearMeta', () => {
  const p = (status: string | null, traded_away = false) => ({ status, traded_away })
  it('branches on pick status before traded_away', () => {
    expect(draftPickOutcome(p('used'))).toEqual({ view: 'used', label: null })
    expect(draftPickOutcome(p('used', true))).toEqual({ view: 'traded', label: null })
    expect(draftPickOutcome(p('extinguished'))).toEqual({ view: 'other', label: 'Not conveyed' })
    expect(draftPickOutcome(p('extinguished', true))).toEqual({ view: 'other', label: 'Not conveyed' })
    expect(draftPickOutcome(p('forfeited'))).toEqual({ view: 'other', label: 'Forfeited' })
    expect(draftPickOutcome(p('conveyed_as_other', true))).toEqual({ view: 'other', label: 'Converted to another pick' })
    expect(draftPickOutcome(p(null))).toEqual({ view: 'other', label: 'Outcome not recorded' })
    expect(draftPickOutcome(p('something_new'))).toEqual({ view: 'other', label: 'Outcome not recorded' })
  })

  it('counts only used picks as picks', () => {
    expect(draftYearMeta([p('used'), p('used')])).toBe('2 picks')
    expect(draftYearMeta([p('used'), p('used', true)])).toBe('1 pick · 1 traded')
    expect(draftYearMeta([p('used', true)])).toBe('1 traded away')
    expect(draftYearMeta([p('used'), p('forfeited'), p(null), p(null)])).toBe('1 pick · 1 forfeited · 2 outcome not recorded')
    expect(draftYearMeta([p('extinguished', true)])).toBe('1 not conveyed')
  })
})

describe('teamFullName', () => {
  it('names a team in full, with a heading-safe fallback when nothing is recorded', () => {
    expect(teamFullName(team('OKC', 'Oklahoma City', 'Thunder'))).toBe('Oklahoma City Thunder')
    expect(teamFullName(team('SEA', null, null))).toBe('SEA')
    expect(teamFullName(null)).toBe('an unknown team')
    expect(teamFullName(team(null, null, null), TEAM_NOT_RECORDED)).toBe('Team not recorded')
  })
})

describe('partialWord', () => {
  it('keeps an unrecorded completeness unknown', () => {
    expect(partialWord(true)).toBe('partial')
    expect(partialWord(false)).toBe('recorded')
    expect(partialWord(null)).toBe('—')
    expect(partialWord(undefined)).toBe('—')
  })
})

describe('personMoves (a person page filters its all-seasons, all-types list in the browser)', () => {
  const move = (slug: string, season_id: number | null, kind_group: 'trade' | 'signing' | 'release' | 'draft' | 'other') => ({ slug, season_id, kind_group })
  // Newest first, as the loader serves them.
  const all = {
    meta: { generated_at: 'x' },
    filters: { season: null, type: 'all', player: 'paulch01' },
    seasons: [2024, 2019, 2017, 2010],
    season_counts: [
      { season_id: 2019, count: 3 },
      { season_id: 2017, count: 1 },
    ],
    player: { person_key: 'paulch01', name: 'Chris Paul' },
    moves: [move('a', 2019, 'trade'), move('b', 2019, 'signing'), move('c', 2019, 'signing'), move('d', 2017, 'trade'), move('e', null, 'other')],
  } as unknown as Parameters<typeof personMoves>[0]
  const slugs = (r: ReturnType<typeof personMoves>) => r.data.moves.map((m) => m.slug)

  it('all types, all seasons: the list as served', () => {
    const r = personMoves(all, { season: 'all', type: 'all', player: 'paulch01' })
    expect(r.filters).toEqual({ season: 'all', type: 'all', player: 'paulch01' })
    expect(slugs(r)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(r.data.season_counts).toEqual([
      { season_id: 2019, count: 3 },
      { season_id: 2017, count: 1 },
    ])
    expect(r.data.seasons).toEqual(all.seasons)
    expect(r.data.player).toEqual(all.player)
  })
  it('a type: only that kind group, with counts per season for it (seasonless rows uncounted)', () => {
    const r = personMoves(all, { season: 'all', type: 'trade', player: 'paulch01' })
    expect(slugs(r)).toEqual(['a', 'd'])
    expect(r.data.season_counts).toEqual([
      { season_id: 2019, count: 1 },
      { season_id: 2017, count: 1 },
    ])
    expect(slugs(personMoves(all, { season: 'all', type: 'other', player: 'paulch01' }))).toEqual(['e'])
    expect(personMoves(all, { season: 'all', type: 'other', player: 'paulch01' }).data.season_counts).toEqual([])
  })
  it('a season: that season only, echoed in filters; empty when nothing matches', () => {
    const r = personMoves(all, { season: 2019, type: 'signing', player: 'paulch01' })
    expect(r.filters.season).toBe(2019)
    expect(r.data.filters.season).toBe(2019)
    expect(slugs(r)).toEqual(['b', 'c'])
    const none = personMoves(all, { season: 2010, type: 'all', player: 'paulch01' })
    expect(none.filters.season).toBe(2010)
    expect(slugs(none)).toEqual([])
  })
  it("no season: the latest season with a matching move (the loader's season=latest), or none", () => {
    expect(personMoves(all, { season: null, type: 'trade', player: 'paulch01' }).filters.season).toBe(2019)
    const r = personMoves(all, { season: null, type: 'release', player: 'paulch01' })
    expect(r.filters.season).toBeNull()
    expect(slugs(r)).toEqual([])
  })
})
