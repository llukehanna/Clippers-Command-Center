import { afterEach, describe, expect, it, vi } from 'vitest'
import { CLIENT_DATA_FIXED_PATHS, clientDataUrl, seasonGamesPath, staticDataPath } from './client-data'

afterEach(() => {
  vi.unstubAllEnvs()
})

const MAPPING: Array<[string, string]> = [
  ['/api/history/seasons', '/data/history/seasons.json'],
  ['/api/history/games?season_id=2025&limit=200', '/data/history/games/2025.json'],
  ['/api/history/games?season_id=2024&limit=200', '/data/history/games/2024.json'],
  ['/api/players', '/data/players.json'],
  ['/api/players/all-time', '/data/players/all-time.json'],
  ['/api/franchise/moves?type=trade', '/data/franchise/trades.json'],
  ['/api/franchise/people', '/data/franchise/people.json'],
  ['/api/home', '/data/home.json'],
]

describe('clientDataUrl in static mode', () => {
  it.each(MAPPING)('maps %s to %s', (api, file) => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_DATA', '1')
    expect(clientDataUrl(api)).toBe(file)
  })

  it.each([
    '/api/live',
    '/api/media?limit=3',
    '/api/players?include_traded=true',
    '/api/franchise/moves?type=draft',
    '/api/history/games?season_id=2025',
    '/api/history/games?season_id=2025&limit=50',
    '/api/history/games?limit=200&season_id=2025',
    '/api/history/games?season_id=abc&limit=200',
  ])('throws for unmapped %s', (api) => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_DATA', '1')
    expect(() => clientDataUrl(api)).toThrow(/no static data file/)
  })
})

describe('clientDataUrl outside static mode', () => {
  it.each([...MAPPING.map(([api]) => api), '/api/players?include_traded=true'])('passes %s through', (api) => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_DATA', '')
    expect(clientDataUrl(api)).toBe(api)
  })

  it('passes through when the flag is unset', () => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_DATA', undefined)
    expect(clientDataUrl('/api/players')).toBe('/api/players')
  })
})

describe('build-side helpers', () => {
  it('staticDataPath maps regardless of the flag and returns null for unmapped paths', () => {
    vi.stubEnv('NEXT_PUBLIC_STATIC_DATA', '')
    expect(staticDataPath('/api/home')).toBe('/data/home.json')
    expect(staticDataPath('/api/live')).toBeNull()
  })

  it('seasonGamesPath builds the exact path the client requests', () => {
    expect(seasonGamesPath(2025)).toBe('/api/history/games?season_id=2025&limit=200')
    expect(staticDataPath(seasonGamesPath(2025))).toBe('/data/history/games/2025.json')
  })

  it('every fixed path maps to a file', () => {
    expect(CLIENT_DATA_FIXED_PATHS).toHaveLength(6)
    for (const p of CLIENT_DATA_FIXED_PATHS) expect(staticDataPath(p)).toMatch(/^\/data\/.+\.json$/)
  })
})
