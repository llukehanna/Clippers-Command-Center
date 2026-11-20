import { beforeEach, describe, expect, it, vi } from 'vitest'

const payloads = new Map<string, unknown>()
const fromPayloads = async (path: string) => payloads.get(path) ?? null
vi.mock('@/src/lib/ui/api', () => ({
  getJson: vi.fn(async (path: string) => payloads.get(path) ?? null),
}))

import { getJson } from '@/src/lib/ui/api'
import { historyFilterParams, historyGameIds, historySeasonIds, playerIds, playerSeasonParams, scheduleGameIds, tradeSlugs } from './params'

const game = (id: string, date: string, played: boolean) => ({
  game_id: id,
  game_date: date,
  opponent_abbr: 'LAL',
  home_away: 'home',
  status: played ? 'final' : 'scheduled',
  result: played ? 'W' : null,
  final_score: played ? { team: 110, opp: 100 } : null,
})

const FRANCHISE = ['draft', 'contracts', 'picks', 'honors', 'front-office', 'people']

const trade = (slug: string, links: string[] = [], players: string[] = []) =>
  payloads.set(`/api/franchise/trades/${slug}`, {
    trade: { slug },
    sides: [{ received: players.map((p) => ({ person: { href: `/players/${p}` } })) }],
    became: links.map((l) => ({ href: `/franchise/trades/${l}`, children: [], truncatedAt: null })),
  })

const clippersTrades = (slugs: string[]) =>
  payloads.set('/api/franchise/moves?type=trade', {
    moves: slugs.map((slug) => ({ slug, kind_group: 'trade', href: `/franchise/trades/${slug}` })),
  })

beforeEach(() => {
  payloads.clear()
  vi.mocked(getJson).mockImplementation(fromPayloads)
})

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

describe('historySeasonIds', () => {
  it('lists every season the picker offers, in payload order', async () => {
    payloads.set('/api/history/seasons', { seasons: [{ season_id: 1970 }, { season_id: 2025 }] })
    expect(await historySeasonIds()).toEqual(['1970', '2025'])
  })

  it('throws when the seasons list is missing', async () => {
    await expect(historySeasonIds()).rejects.toThrow('/api/history/seasons')
  })
})

describe('historyFilterParams', () => {
  it('pairs each season with all eight filters', () => {
    const params = historyFilterParams(['1970', '2025'])
    expect(params).toHaveLength(16)
    expect(params.slice(0, 8).map((p) => p.filter)).toEqual([
      'home', 'away', 'wins', 'losses', 'home-wins', 'home-losses', 'away-wins', 'away-losses',
    ])
    expect(params).toContainEqual({ season_id: '2025', filter: 'away-wins' })
    expect(params.every((p) => p.filter !== 'all')).toBe(true)
  })
})

describe('scheduleGameIds', () => {
  it('adds every game of the current season to the schedule, played games last', async () => {
    payloads.set('/api/schedule', { next_game: null, games: [{ game_id: 30 }, { game_id: '31' }] })
    payloads.set('/api/history/seasons', { seasons: [{ season_id: 2024 }, { season_id: 2025 }] })
    payloads.set('/api/history/games?season_id=2025&limit=200', {
      games: [game('31', '2025-11-05', false), game('30', '2025-11-03', false), game('21', '2025-10-30', true), game('20', '2025-10-28', true)],
    })
    expect(await scheduleGameIds()).toEqual(['30', '31', '20', '21'])
  })

  it('throws when the schedule is missing', async () => {
    payloads.set('/api/history/seasons', { seasons: [] })
    await expect(scheduleGameIds()).rejects.toThrow('/api/schedule')
  })

  it('throws when the current season list is missing', async () => {
    payloads.set('/api/schedule', { next_game: null, games: [] })
    payloads.set('/api/history/seasons', { seasons: [{ season_id: 2025 }] })
    await expect(scheduleGameIds()).rejects.toThrow('/api/history/games?season_id=2025&limit=200')
  })
})

describe('playerIds', () => {
  beforeEach(() => {
    payloads.set('/api/players/all-time', { players: [{ player_id: '1' }, { player_id: '2' }] })
    payloads.set('/api/players?include_traded=true', { players: [{ player_id: '2' }, { player_id: '9' }] })
    for (const p of FRANCHISE) payloads.set(`/api/franchise/${p}`, {})
    payloads.set('/api/franchise/moves?type=all&season=latest', { seasons: [], moves: [] })
    clippersTrades([])
  })

  it('unions all-time players with the roster, without duplicates', async () => {
    expect(await playerIds()).toEqual(['1', '2', '9'])
  })

  it('adds players linked from franchise pages, trade pages and season moves, but not /players/nba links', async () => {
    payloads.set('/api/franchise/contracts', {
      contracts: [{ player: { href: '/players/5406' } }, { player: { href: '/players/nba/123' } }, { href: '/players/2' }],
    })
    clippersTrades(['lac-a'])
    trade('lac-a', [], ['77'])
    payloads.set('/api/franchise/moves?type=all&season=latest', { seasons: [2025, 2024], moves: [] })
    payloads.set('/api/franchise/moves?type=all&season=2025', { moves: [{ people: [{ href: '/players/88?season=2025' }] }] })
    payloads.set('/api/franchise/moves?type=all&season=2024', { moves: [] })
    expect((await playerIds()).sort()).toEqual(['1', '2', '5406', '77', '88', '9'])
  })

  it('throws when the roster is missing', async () => {
    payloads.delete('/api/players?include_traded=true')
    await expect(playerIds()).rejects.toThrow('/api/players?include_traded=true')
  })

  it('throws when a season moves list is missing', async () => {
    payloads.set('/api/franchise/moves?type=all&season=latest', { seasons: [2025], moves: [] })
    await expect(playerIds()).rejects.toThrow('/api/franchise/moves?type=all&season=2025')
  })
})

describe('tradeSlugs', () => {
  beforeEach(() => {
    payloads.set('/api/franchise/draft', { picks: [] })
    payloads.set('/api/franchise/picks', { owed: [] })
  })

  it('lists every Clippers trade', async () => {
    clippersTrades(['lac-a', 'lac-b'])
    trade('lac-a')
    trade('lac-b')
    expect(await tradeSlugs()).toEqual(['lac-a', 'lac-b'])
  })

  it('follows links from the draft page and from trade pages, dropping slugs with no page', async () => {
    clippersTrades(['lac-a', 'lac-b'])
    trade('lac-a')
    trade('lac-b', ['gone'])
    payloads.set('/api/franchise/draft', {
      picks: [{ chain: [{ slug: 'den-nyk', href: '/franchise/trades/den-nyk' }] }],
    })
    trade('den-nyk', ['nyk-bos', 'lac-a'])
    trade('nyk-bos')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect((await tradeSlugs()).sort()).toEqual(['den-nyk', 'lac-a', 'lac-b', 'nyk-bos'])
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0][0]).toContain('gone')
    } finally {
      warn.mockRestore()
    }
  })

  it('throws when a trade payload load throws', async () => {
    clippersTrades(['lac-a'])
    vi.mocked(getJson).mockImplementation(async (path: string) => {
      if (path.startsWith('/api/franchise/trades/')) throw new Error('db down')
      return payloads.get(path) ?? null
    })
    try {
      await expect(tradeSlugs()).rejects.toThrow('db down')
    } finally {
      vi.mocked(getJson).mockImplementation(fromPayloads)
    }
  })

  it('throws when the moves list is missing', async () => {
    await expect(tradeSlugs()).rejects.toThrow('/api/franchise/moves?type=trade')
  })
})

describe('playerSeasonParams', () => {
  const career = (id: string, regular: number[], playoffs: number[] = []) =>
    payloads.set(`/api/players/${id}/career`, {
      seasons: { regular: regular.map((season_id) => ({ season_id })), playoffs: playoffs.map((season_id) => ({ season_id })) },
    })

  it('lists every season the career picker offers, regular and playoffs, per player', async () => {
    career('1', [2019, 2020], [2020, 2021])
    career('2', [1984])
    expect(await playerSeasonParams(['1', '2'])).toEqual([
      { player_id: '1', season_id: '2019' },
      { player_id: '1', season_id: '2020' },
      { player_id: '1', season_id: '2021' },
      { player_id: '2', season_id: '1984' },
    ])
  })

  it('gives players with no Clippers seasons, no career, or a non-numeric id no season pages', async () => {
    career('1', [])
    expect(await playerSeasonParams(['1', '3', 'abc'])).toEqual([])
    expect(getJson).not.toHaveBeenCalledWith('/api/players/abc/career')
  })

  it('throws when a career load throws', async () => {
    vi.mocked(getJson).mockImplementation(async () => {
      throw new Error('db down')
    })
    try {
      await expect(playerSeasonParams(['1'])).rejects.toThrow('db down')
    } finally {
      vi.mocked(getJson).mockImplementation(fromPayloads)
    }
  })
})
