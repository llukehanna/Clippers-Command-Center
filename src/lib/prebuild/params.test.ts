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
  it('lists every trade slug', async () => {
    payloads.set('/api/franchise/moves?type=trade', {
      moves: [
        { slug: '2024-10-01-trade-a', kind_group: 'trade' },
        { slug: '2019-07-10-trade-b', kind_group: 'trade' },
      ],
    })
    expect(await tradeSlugs()).toEqual(['2024-10-01-trade-a', '2019-07-10-trade-b'])
  })

  it('throws when the moves list is missing', async () => {
    await expect(tradeSlugs()).rejects.toThrow('/api/franchise/moves?type=trade')
  })
})
