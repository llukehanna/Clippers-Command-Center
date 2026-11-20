import { describe, expect, it } from 'vitest'
import { apiAllowed, apiBlocked, legacyRedirect, scheduleFallback } from './legacy-redirect'

const r = (path: string) => legacyRedirect(new URL(`https://clippers.lukeghanna.com${path}`))

describe('legacyRedirect', () => {
  it('maps players index query forms to paths', () => {
    expect(r('/players?mode=all-time')).toBe('/players/all-time')
    expect(r('/players?view=table')).toBe('/players/table')
    expect(r('/players?scope=all')).toBe('/players/traded')
    expect(r('/players?scope=all&view=table')).toBe('/players/traded/table')
    expect(r('/players?mode=all-time&view=table&scope=all')).toBe('/players/all-time')
    expect(r('/players?mode=roster')).toBe('/players')
  })
  it('maps a player season', () => {
    expect(r('/players/189?season=2019')).toBe('/players/189/season/2019')
    expect(r('/players/189?season=abc')).toBe('/players/189')
  })
  it('maps History filters', () => {
    expect(r('/history?season_id=2019')).toBe('/history/season/2019')
    expect(r('/history?season_id=2019&home_away=home')).toBe('/history/season/2019/home')
    expect(r('/history?season_id=2019&result=W')).toBe('/history/season/2019/wins')
    expect(r('/history?season_id=2019&home_away=away&result=L')).toBe('/history/season/2019/away-losses')
    expect(r('/history?home_away=home')).toBe('/history')
  })
  it('maps Franchise moves', () => {
    expect(r('/franchise?type=draft&season=2019')).toBe('/franchise/moves/draft/2019')
    expect(r('/franchise?season=2019')).toBe('/franchise/moves/trade/2019')
    expect(r('/franchise?season=all')).toBe('/franchise/moves/trade/all')
    expect(r('/franchise?season=latest')).toBe('/franchise')
    expect(r('/franchise?type=signing')).toBe('/franchise/moves/signing')
    expect(r('/franchise?type=signing&season=all')).toBe('/franchise/moves/signing')
    expect(r('/franchise?player=nba:123&season=2019&type=draft')).toBe('/franchise/person/nba:123')
    expect(r('/franchise?player=mcgruro01')).toBe('/franchise/person/mcgruro01')
    expect(r('/franchise?type=bogus&player=K')).toBe('/franchise/person/K')
  })
  it('maps News show', () => {
    expect(r('/news?show=articles')).toBe('/news/articles')
    expect(r('/news?show=social')).toBe('/news/social')
    expect(r('/news?show=bogus')).toBe('/news')
  })
  it('malformed legacy params fall back to the section root', () => {
    expect(r('/history?season_id=abc')).toBe('/history')
    expect(r('/franchise?type=bogus')).toBe('/franchise')
    expect(r('/franchise?type=bogus&season=2019')).toBe('/franchise')
    expect(r('/players?view=bogus')).toBe('/players')
  })
  it('leaves new paths and plain URLs alone', () => {
    for (const p of ['/history/123', '/players', '/players/189', '/players/table', '/players/189/season/2019', '/history/season/2019/home', '/franchise', '/franchise/moves/draft/2019', '/franchise/person/nba:1', '/news', '/news/articles', '/news?utm_source=x', '/players?utm=1', '/schedule', '/']) {
      expect(r(p), p).toBeNull()
    }
  })
  it('ignores _rsc when deciding, but still redirects a legacy URL that carries it', () => {
    expect(r('/players?_rsc=x')).toBeNull()
    expect(r('/news?_rsc=abc')).toBeNull()
    expect(r('/players?view=table&_rsc=x')).toBe('/players/table')
  })
  it('never redirects a target again', () => {
    for (const p of ['/players?mode=all-time', '/players/1?season=2020', '/history?season_id=2019&result=W', '/franchise?type=draft&season=2019', '/franchise?player=a:b', '/news?show=social', '/news?show=x']) {
      const to = r(p)!
      expect(to).not.toBeNull()
      expect(r(to), to).toBeNull()
    }
  })
})

describe('apiAllowed', () => {
  it('non-allowlisted api paths 404 in production', () => {
    expect(apiAllowed('/api/home')).toBe(false)
    expect(apiAllowed('/api/live/x')).toBe(false)
    expect(apiAllowed('/api/live')).toBe(true)
    expect(apiAllowed('/api/cron/poll-live')).toBe(true)
    expect(apiAllowed('/api/media')).toBe(true)
    expect(apiAllowed('/api/cron/other')).toBe(false)
  })
})

describe('apiBlocked', () => {
  const b = (p: string) => apiBlocked(new URL(`https://x.test${p}`).pathname)
  it('blocks encoded, doubled, cased and bare api paths', () => {
    for (const p of ['/%61pi/home', '/%61%70%69/home', '//api/home', '/api', '/api/', '/API/home', '/api%2Fhome', '/%2561pi/home', '/api/home', '/api/players/1', '/api/live/x']) expect(b(p), p).toBe(true)
  })
  it('allows the allowlist, with queries', () => {
    for (const p of ['/api/live', '/api/live?x=1', '/api/media', '/api/media?limit=3', '/api/cron/poll-live']) expect(b(p), p).toBe(false)
  })
  it('passes non-api paths through', () => {
    for (const p of ['/apixyz', '/', '/players', '/history/1', '/x/api/home', '/%E0%A4%A']) expect(b(p), p).toBe(false)
  })
})

describe('scheduleFallback', () => {
  const u = (p: string) => new URL(`https://clippers.lukeghanna.com${p}`)
  it('sends a missing old-season schedule page to History', () => {
    expect(scheduleFallback(u('/schedule/22300123'), 404)).toBe('/history/22300123')
    expect(scheduleFallback(u('/schedule/22300123/ics'), 404)).toBe('/history/22300123')
  })
  it('only on a 404 for those paths', () => {
    expect(scheduleFallback(u('/schedule/22300123'), 200)).toBeNull()
    expect(scheduleFallback(u('/schedule/22300123'), 500)).toBeNull()
    expect(scheduleFallback(u('/schedule'), 404)).toBeNull()
    expect(scheduleFallback(u('/schedule/abc'), 404)).toBeNull()
    expect(scheduleFallback(u('/history/1'), 404)).toBeNull()
  })
})
