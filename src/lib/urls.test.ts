import { describe, expect, it } from 'vitest'
import { historyFilter, historyHref, parseHistoryFilter, playerHref, playersHref } from './urls'

describe('playersHref', () => {
  it.each([
    [{}, '/players'],
    [{ mode: 'roster' }, '/players'],
    [{ view: 'cards' }, '/players'],
    [{ scope: 'active' }, '/players'],
    [{ view: 'cards', scope: 'active' }, '/players'],
    [{ view: 'table' }, '/players/table'],
    [{ view: 'table', scope: 'active' }, '/players/table'],
    [{ scope: 'all' }, '/players/traded'],
    [{ view: 'cards', scope: 'all' }, '/players/traded'],
    [{ view: 'table', scope: 'all' }, '/players/traded/table'],
    [{ mode: 'roster', view: 'table', scope: 'all' }, '/players/traded/table'],
    [{ mode: 'all-time' }, '/players/all-time'],
    [{ mode: 'all-time', view: 'table', scope: 'all' }, '/players/all-time'],
  ] as const)('%j → %s', (o, href) => {
    expect(playersHref(o)).toBe(href)
  })
})

describe('playerHref', () => {
  it('links the default profile without a season', () => {
    expect(playerHref('1627826')).toBe('/players/1627826')
    expect(playerHref(1627826)).toBe('/players/1627826')
    expect(playerHref('1627826', null)).toBe('/players/1627826')
    expect(playerHref('1627826', undefined)).toBe('/players/1627826')
  })

  it('links a season view as a path', () => {
    expect(playerHref('1627826', 2019)).toBe('/players/1627826/season/2019')
    expect(playerHref(1627826, 1984)).toBe('/players/1627826/season/1984')
  })

  it('encodes the id', () => {
    expect(playerHref('a/b')).toBe('/players/a%2Fb')
  })
})

describe('historyHref', () => {
  it('links the season page without a filter', () => {
    expect(historyHref('2025')).toBe('/history/season/2025')
    expect(historyHref(2025)).toBe('/history/season/2025')
    expect(historyHref(2025, 'all')).toBe('/history/season/2025')
  })

  it.each(['home', 'away', 'wins', 'losses', 'home-wins', 'home-losses', 'away-wins', 'away-losses'] as const)(
    'links the %s filter as a path',
    (filter) => {
      expect(historyHref(1984, filter)).toBe(`/history/season/1984/${filter}`)
    },
  )

  it('encodes the season id', () => {
    expect(historyHref('a/b')).toBe('/history/season/a%2Fb')
  })
})

describe('parseHistoryFilter', () => {
  it.each([
    ['all', { homeAway: 'all', result: 'all' }],
    ['home', { homeAway: 'home', result: 'all' }],
    ['away', { homeAway: 'away', result: 'all' }],
    ['wins', { homeAway: 'all', result: 'W' }],
    ['losses', { homeAway: 'all', result: 'L' }],
    ['home-wins', { homeAway: 'home', result: 'W' }],
    ['home-losses', { homeAway: 'home', result: 'L' }],
    ['away-wins', { homeAway: 'away', result: 'W' }],
    ['away-losses', { homeAway: 'away', result: 'L' }],
  ] as const)('%s → %j', (s, parsed) => {
    expect(parseHistoryFilter(s)).toEqual(parsed)
  })

  it.each(['bogus', '', 'W', 'home-W', 'wins-home', 'HOME'])('rejects %j', (s) => {
    expect(parseHistoryFilter(s)).toBeNull()
  })
})

describe('historyFilter', () => {
  it.each([
    ['all', 'all', 'all'],
    ['home', 'all', 'home'],
    ['away', 'all', 'away'],
    ['all', 'W', 'wins'],
    ['all', 'L', 'losses'],
    ['home', 'W', 'home-wins'],
    ['home', 'L', 'home-losses'],
    ['away', 'W', 'away-wins'],
    ['away', 'L', 'away-losses'],
  ] as const)('%s × %s → %s', (homeAway, result, filter) => {
    expect(historyFilter(homeAway, result)).toBe(filter)
    expect(parseHistoryFilter(filter)).toEqual({ homeAway, result })
  })
})
