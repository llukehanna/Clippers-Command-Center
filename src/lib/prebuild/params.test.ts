import { beforeEach, describe, expect, it, vi } from 'vitest'

const payloads = new Map<string, unknown>()
vi.mock('@/src/lib/ui/api', () => ({
  getJson: vi.fn(async (path: string) => payloads.get(path) ?? null),
}))

import { historyGameIds, playerIds, scheduleGameIds, tradeSlugs } from './params'

const game = (id: string, date: string, played: boolean) => ({
  game_id: id,
  game_date: date,
  opponent_abbr: 'LAL',
  home_away: 'home',
  status: played ? 'final' : 'scheduled',
  result: played ? 'W' : null,
  final_score: played ? { team: 110, opp: 100 } : null,
})

beforeEach(() => payloads.clear())

describe('historyGameIds', () => {
  it('lists played games across every season', async () => {
    payloads.set('/api/history/seasons', { seasons: [{ season_id: 2025 }, { season_id: 1970 }] })
    payloads.set('/api/history/games?season_id=2025&limit=200', {
      games: [game('3', '2025-11-02', false), game('2', '2025-10-30', true)],
    })
    payloads.set('/api/history/games?season_id=1970&limit=200', { games: [game('1', '1970-10-20', true)] })
    expect(await historyGameIds()).toEqual(['2', '1'])
  })

  it('throws when a season list is missing', async () => {
    payloads.set('/api/history/seasons', { seasons: [{ season_id: 2025 }] })
    await expect(historyGameIds()).rejects.toThrow('/api/history/games?season_id=2025&limit=200')
  })

  it('throws when the seasons list is missing', async () => {
    await expect(historyGameIds()).rejects.toThrow('/api/history/seasons')
  })
})

describe('scheduleGameIds', () => {
  it('lists the scheduled games as strings', async () => {
    payloads.set('/api/schedule', { next_game: null, games: [{ game_id: 22500100 }, { game_id: '22500101' }] })
    expect(await scheduleGameIds()).toEqual(['22500100', '22500101'])
  })

  it('throws when the schedule is missing', async () => {
    await expect(scheduleGameIds()).rejects.toThrow('/api/schedule')
  })
})

describe('playerIds', () => {
  it('unions all-time players with the roster, without duplicates', async () => {
    payloads.set('/api/players/all-time', { players: [{ player_id: '1' }, { player_id: '2' }] })
    payloads.set('/api/players?include_traded=true', { players: [{ player_id: '2' }, { player_id: '9' }] })
    expect(await playerIds()).toEqual(['1', '2', '9'])
  })

  it('throws when the roster is missing', async () => {
    payloads.set('/api/players/all-time', { players: [] })
    await expect(playerIds()).rejects.toThrow('/api/players?include_traded=true')
  })
})

describe('tradeSlugs', () => {
  const clippersTrades = () =>
    payloads.set('/api/franchise/moves?type=trade', {
      moves: [
        { slug: 'lac-a', kind_group: 'trade', href: '/franchise/trades/lac-a' },
        { slug: 'lac-b', kind_group: 'trade', href: '/franchise/trades/lac-b' },
      ],
    })
  const trade = (slug: string, links: string[] = []) =>
    payloads.set(`/api/franchise/trades/${slug}`, {
      trade: { slug },
      became: links.map((l) => ({ href: `/franchise/trades/${l}`, children: [], truncatedAt: null })),
    })

  beforeEach(() => {
    payloads.set('/api/franchise/draft', { picks: [] })
    payloads.set('/api/franchise/picks', { owed: [] })
  })

  it('lists every Clippers trade', async () => {
    clippersTrades()
    trade('lac-a')
    trade('lac-b')
    expect(await tradeSlugs()).toEqual(['lac-a', 'lac-b'])
  })

  it('follows links from the draft page and from trade pages, dropping slugs with no page', async () => {
    clippersTrades()
    trade('lac-a')
    trade('lac-b', ['gone'])
    payloads.set('/api/franchise/draft', {
      picks: [{ chain: [{ slug: 'den-nyk', href: '/franchise/trades/den-nyk' }] }],
    })
    trade('den-nyk', ['nyk-bos', 'lac-a'])
    trade('nyk-bos')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect((await tradeSlugs()).sort()).toEqual(['den-nyk', 'lac-a', 'lac-b', 'nyk-bos'])
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('gone')
    warn.mockRestore()
  })

  it('throws when a trade payload load throws', async () => {
    clippersTrades()
    const { getJson } = await import('@/src/lib/ui/api')
    vi.mocked(getJson).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/franchise/trades/')) throw new Error('db down')
      return payloads.get(path) ?? null
    })
    await expect(tradeSlugs()).rejects.toThrow('db down')
    vi.mocked(getJson).mockImplementation(async (path: string) => payloads.get(path) ?? null)
  })

  it('throws when the moves list is missing', async () => {
    await expect(tradeSlugs()).rejects.toThrow('/api/franchise/moves?type=trade')
  })
})
