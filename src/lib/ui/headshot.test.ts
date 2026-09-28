import { describe, it, expect } from 'vitest'
import { headshotUrl, initials } from './headshot'

describe('headshot', () => {
  it('builds NBA CDN urls from numeric ids', () => {
    expect(headshotUrl('202695')).toBe('https://cdn.nba.com/headshots/nba/latest/260x190/202695.png')
    expect(headshotUrl(202695, 'lg')).toBe('https://cdn.nba.com/headshots/nba/latest/1040x760/202695.png')
    expect(headshotUrl(null)).toBeNull()
    expect(headshotUrl('abc')).toBeNull()
  })

  it('derives initials, skipping suffixes', () => {
    expect(initials('Kawhi Leonard')).toBe('KL')
    expect(initials('Derrick Jones Jr.')).toBe('DJ')
  })
})
