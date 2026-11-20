import { describe, it, expect, vi, beforeEach } from 'vitest'

const ok = (body: unknown) => ({ status: 200, body })

vi.mock('@/src/lib/data/home', () => ({ loadHome: vi.fn() }))
vi.mock('@/src/lib/data/schedule', () => ({ loadSchedule: vi.fn() }))
vi.mock('@/src/lib/data/game-preview', () => ({ loadGamePreview: vi.fn() }))
vi.mock('@/src/lib/data/players', () => ({ loadPlayers: vi.fn() }))
vi.mock('@/src/lib/data/player', () => ({ loadPlayer: vi.fn() }))
vi.mock('@/src/lib/data/players-all-time', () => ({ loadPlayersAllTime: vi.fn() }))
vi.mock('@/src/lib/data/player-career', () => ({ loadPlayerCareer: vi.fn() }))
vi.mock('@/src/lib/data/insights', () => ({ loadInsights: vi.fn() }))
vi.mock('@/src/lib/data/media', () => ({ loadMedia: vi.fn() }))
vi.mock('@/src/lib/data/history-seasons', () => ({ loadHistorySeasons: vi.fn() }))
vi.mock('@/src/lib/data/history-games', () => ({ loadHistoryGames: vi.fn() }))
vi.mock('@/src/lib/data/history-game', () => ({ loadHistoryGame: vi.fn() }))
vi.mock('@/src/lib/data/franchise-moves', () => ({ loadFranchiseMoves: vi.fn() }))
vi.mock('@/src/lib/data/franchise-people', () => ({ loadFranchisePeople: vi.fn() }))
vi.mock('@/src/lib/data/franchise-draft', () => ({ loadFranchiseDraft: vi.fn() }))
vi.mock('@/src/lib/data/franchise-contracts', () => ({ loadFranchiseContracts: vi.fn() }))
vi.mock('@/src/lib/data/franchise-picks', () => ({ loadFranchisePicks: vi.fn() }))
vi.mock('@/src/lib/data/franchise-front-office', () => ({ loadFranchiseFrontOffice: vi.fn() }))
vi.mock('@/src/lib/data/franchise-honors', () => ({ loadFranchiseHonors: vi.fn() }))
vi.mock('@/src/lib/data/franchise-trade', () => ({ loadFranchiseTrade: vi.fn() }))
vi.mock('@/src/lib/data/game-story', () => ({ loadGameStory: vi.fn() }))

import { loadPath } from '@/src/lib/data/routes'
import { loadPlayerCareer } from '@/src/lib/data/player-career'
import { loadPlayersAllTime } from '@/src/lib/data/players-all-time'
import { loadPlayer } from '@/src/lib/data/player'
import { loadHistoryGames } from '@/src/lib/data/history-games'

describe('loadPath', () => {
  beforeEach(() => vi.clearAllMocks())

  it('dispatches a player career path with the decoded id', async () => {
    vi.mocked(loadPlayerCareer).mockResolvedValue(ok({ career: true }) as never)
    const result = await loadPath('/api/players/12/career')
    expect(loadPlayerCareer).toHaveBeenCalledWith('12')
    expect(result).toEqual(ok({ career: true }))
  })

  it('routes /players/all-time to the all-time loader, not loadPlayer', async () => {
    vi.mocked(loadPlayersAllTime).mockResolvedValue(ok([]) as never)
    await loadPath('/api/players/all-time')
    expect(loadPlayersAllTime).toHaveBeenCalled()
    expect(loadPlayer).not.toHaveBeenCalled()
  })

  it('passes the parsed URL (with query string) to loaders', async () => {
    vi.mocked(loadHistoryGames).mockResolvedValue(ok([]) as never)
    await loadPath('/api/history/games?season_id=2025&limit=200')
    const url = vi.mocked(loadHistoryGames).mock.calls[0][0] as URL
    expect(url.searchParams.get('season_id')).toBe('2025')
  })

  it('rejects when no route matches', async () => {
    await expect(loadPath('/api/nope')).rejects.toThrow(/no loader/)
  })
})
