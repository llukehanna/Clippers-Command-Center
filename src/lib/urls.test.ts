import { describe, expect, it } from 'vitest'
import { playerHref, playersHref } from './urls'

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
