'use client'

import Link from 'next/link'
import useSWR from 'swr'
import { NextGamePanel } from '@/components/game/NextGamePanel'
import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { TeamLogo } from '@/components/ui/team-mark'
import { ResultBadge } from '@/components/ui/chip'
import { Skeleton } from '@/components/ui/skeleton'
import { playedGames, type HistoryGame } from '@/src/lib/ui/season'
import { formatDayLong } from '@/src/lib/ui/time'
import { teamName } from '@/src/lib/ui/teams'
import type { HomePayload } from '@/src/lib/ui/types'

const json = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

async function loadLastGame() {
  const { seasons } = (await json('/api/history/seasons')) as { seasons: Array<{ season_id: number }> }
  const latest = [...seasons].sort((a, b) => b.season_id - a.season_id)[0]
  if (!latest) return null
  const { games } = (await json(`/api/history/games?season_id=${latest.season_id}&limit=200`)) as { games: HistoryGame[] }
  return playedGames(games).at(-1) ?? null
}

/** No game on: next game (with countdown) and the last result. */
export function IdleState() {
  const { data: home, isLoading } = useSWR<HomePayload>('/api/home', json, { revalidateOnFocus: false })
  const { data: last } = useSWR('live:last-game', loadLastGame, { revalidateOnFocus: false })

  return (
    <>
      <div className="enter">
        <p className="m-0 font-mono text-[11.5px] uppercase tracking-[0.14em] text-mute">No game in progress</p>
        <h1 className="m-0 mt-2 text-[28px] font-semibold tracking-[-0.035em] sm:text-[34px]">
          This page goes live at tip-off.
        </h1>
        <p className="m-0 mt-1.5 max-w-[60ch] text-[14.5px] text-mute">
          Scores, box score, and verified in-game insights update here automatically every few seconds once the game starts.
        </p>
      </div>

      <div className="enter grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] lg:gap-[18px]" style={{ ['--i' as string]: 1 }}>
        {isLoading ? <Skeleton className="h-[320px] rounded-[22px]" /> : <NextGamePanel game={home?.next_game ?? null} />}
        {last && (
          <Panel as={Link} href={`/history/${last.game_id}`} className="flex flex-col gap-5 p-5 transition-colors duration-300 hover:border-line-2 sm:p-6">
            <Eyebrow as="p">Last game</Eyebrow>
            <div className="flex items-center gap-4">
              <TeamLogo abbr={last.opponent_abbr} size="lg" />
              <div className="min-w-0">
                <div className="text-[18px] font-semibold tracking-[-0.02em]">
                  <span className="text-mute">{last.home_away === 'home' ? 'vs' : '@'}</span> {teamName(last.opponent_abbr)}
                </div>
                <div className="font-mono text-[11.5px] text-mute">{formatDayLong(last.game_date)}</div>
              </div>
            </div>
            <div className="mt-auto flex items-center gap-3">
              <ResultBadge result={last.result} />
              <span className="text-[36px] font-semibold leading-none tracking-[-0.04em] tabular-nums">
                {last.final_score.team}–{last.final_score.opp}
              </span>
              {last.ot && <span className="font-mono text-[11px] text-dim">OT</span>}
              <span className="ml-auto font-mono text-[11.5px] text-pacific">Box score →</span>
            </div>
          </Panel>
        )}
      </div>
    </>
  )
}
