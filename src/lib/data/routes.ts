// API-style path -> data loader dispatch. Shared by server pages (via
// src/lib/ui/api.ts) and build scripts run under tsx, so this module must not
// import React or Next.

import { loadHome } from '@/src/lib/data/home'
import { loadSchedule } from '@/src/lib/data/schedule'
import { loadGamePreview } from '@/src/lib/data/game-preview'
import { loadPlayers } from '@/src/lib/data/players'
import { loadPlayer } from '@/src/lib/data/player'
import { loadPlayersAllTime } from '@/src/lib/data/players-all-time'
import { loadPlayerCareer } from '@/src/lib/data/player-career'
import { loadInsights } from '@/src/lib/data/insights'
import { loadMedia } from '@/src/lib/data/media'
import { loadHistorySeasons } from '@/src/lib/data/history-seasons'
import { loadHistoryGames } from '@/src/lib/data/history-games'
import { loadHistoryGame } from '@/src/lib/data/history-game'
import { loadFranchiseMoves } from '@/src/lib/data/franchise-moves'
import { loadFranchisePeople } from '@/src/lib/data/franchise-people'
import { loadFranchiseDraft } from '@/src/lib/data/franchise-draft'
import { loadFranchiseContracts } from '@/src/lib/data/franchise-contracts'
import { loadFranchisePicks } from '@/src/lib/data/franchise-picks'
import { loadFranchiseFrontOffice } from '@/src/lib/data/franchise-front-office'
import { loadFranchiseHonors } from '@/src/lib/data/franchise-honors'
import { loadFranchiseTrade } from '@/src/lib/data/franchise-trade'
import { loadGameStory } from '@/src/lib/data/game-story'
import { type ApiResult } from '@/src/lib/data/result'

type Loader = (match: RegExpMatchArray, url: URL) => Promise<ApiResult>

const ROUTES: Array<[RegExp, Loader]> = [
  [/^\/api\/home$/, () => loadHome()],
  [/^\/api\/schedule$/, (_, url) => loadSchedule(url)],
  [/^\/api\/schedule\/([^/]+)$/, (m) => loadGamePreview(decodeURIComponent(m[1]))],
  [/^\/api\/players$/, (_, url) => loadPlayers(url)],
  [/^\/api\/players\/all-time$/, () => loadPlayersAllTime()],
  [/^\/api\/players\/([^/]+)\/career$/, (m) => loadPlayerCareer(decodeURIComponent(m[1]))],
  [/^\/api\/players\/([^/]+)$/, (m, url) => loadPlayer(decodeURIComponent(m[1]), url)],
  [/^\/api\/insights$/, (_, url) => loadInsights(url)],
  [/^\/api\/media$/, (_, url) => loadMedia(url)],
  [/^\/api\/history\/seasons$/, () => loadHistorySeasons()],
  [/^\/api\/history\/games$/, (_, url) => loadHistoryGames(url)],
  [/^\/api\/history\/games\/([^/]+)\/story$/, (m) => loadGameStory(decodeURIComponent(m[1]))],
  [/^\/api\/history\/games\/([^/]+)$/, (m) => loadHistoryGame(decodeURIComponent(m[1]))],
  [/^\/api\/franchise\/moves$/, (_, url) => loadFranchiseMoves(url)],
  [/^\/api\/franchise\/people$/, () => loadFranchisePeople()],
  [/^\/api\/franchise\/draft$/, () => loadFranchiseDraft()],
  [/^\/api\/franchise\/contracts$/, () => loadFranchiseContracts()],
  [/^\/api\/franchise\/picks$/, () => loadFranchisePicks()],
  [/^\/api\/franchise\/front-office$/, () => loadFranchiseFrontOffice()],
  [/^\/api\/franchise\/honors$/, () => loadFranchiseHonors()],
  [/^\/api\/franchise\/trades\/([^/]+)$/, (m) => loadFranchiseTrade(decodeURIComponent(m[1]))],
]

/** Runs the loader matching an API-style path; throws when none matches. */
export async function loadPath(path: string): Promise<ApiResult> {
  const url = new URL(path, 'http://ccc.local')
  for (const [pattern, loader] of ROUTES) {
    const match = url.pathname.match(pattern)
    if (!match) continue
    return loader(match, url)
  }
  throw new Error(`loadPath: no loader for ${path}`)
}
