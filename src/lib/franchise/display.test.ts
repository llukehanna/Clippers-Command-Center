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
} from './display'

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
  it('builds Moves URLs, leaving the default type out', () => {
    expect(movesHref({ season: null, type: 'trade', player: null })).toBe('/franchise')
    expect(movesHref({ season: 2019, type: 'all', player: 'paulch01' })).toBe('/franchise?season=2019&type=all&player=paulch01')
    expect(movesHref({ season: 'all', type: 'trade', player: null })).toBe('/franchise?season=all')
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
