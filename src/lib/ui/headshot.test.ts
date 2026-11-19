import { describe, it, expect } from 'vitest'
import { clippersHeadshotUrl, headshotUrl, initials } from './headshot'

describe('headshot', () => {
  it('builds NBA CDN urls from numeric ids', () => {
    expect(headshotUrl('202695')).toBe('https://cdn.nba.com/headshots/nba/latest/260x190/202695.png')
    expect(headshotUrl(202695, 'lg')).toBe('https://cdn.nba.com/headshots/nba/latest/1040x760/202695.png')
    expect(headshotUrl(null)).toBeNull()
    expect(headshotUrl('abc')).toBeNull()
  })

  it('accepts short ids of older players and rejects 8+-digit balldontlie ids', () => {
    expect(headshotUrl('1882')).toBe('https://cdn.nba.com/headshots/nba/latest/260x190/1882.png')
    expect(headshotUrl(15)).not.toBeNull()
    expect(headshotUrl('38017686')).toBeNull()
    expect(headshotUrl('1629636')).not.toBeNull()
  })

  it('derives initials, skipping suffixes', () => {
    expect(initials('Kawhi Leonard')).toBe('KL')
    expect(initials('Derrick Jones Jr.')).toBe('DJ')
  })
})

describe('clippersHeadshotUrl', () => {
  it('points at the Clippers team-season headshot', () => {
    expect(clippersHeadshotUrl(201933, 2017)).toBe('https://cdn.nba.com/headshots/nba/1610612746/2017/260x190/201933.png')
    expect(clippersHeadshotUrl(202695, 2025, 'lg')).toBe('https://cdn.nba.com/headshots/nba/1610612746/2025/1040x760/202695.png')
  })
  it('is null before the CDN has team headshots, or without a usable id', () => {
    expect(clippersHeadshotUrl(1882, 2007)).toBeNull()
    expect(clippersHeadshotUrl('38017686', 2020)).toBeNull()
    expect(clippersHeadshotUrl(201933, null)).toBeNull()
  })
})
