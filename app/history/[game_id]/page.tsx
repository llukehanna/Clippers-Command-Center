import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Scoreboard } from '@/components/game/Scoreboard'
import { BoxScore } from '@/components/game/BoxScore'
import { LineScore } from '@/components/game/LineScore'
import { gameTypeLabel } from '@/src/lib/ui/season'
import { InsightCard } from '@/components/insights/InsightCard'
import { Eyebrow } from '@/components/ui/eyebrow'
import { EmptyState } from '@/components/ui/empty-state'
import { TeamLogo } from '@/components/ui/team-mark'
import { getJson } from '@/src/lib/ui/api'
import { playedGames, type HistoryGame } from '@/src/lib/ui/season'
import { formatDayLong, formatDayShort } from '@/src/lib/ui/time'
import { teamName } from '@/src/lib/ui/teams'
import type { HistoryGameDetailPayload, Insight } from '@/src/lib/ui/types'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ game_id: string }> }

async function load(id: string) {
  return getJson<HistoryGameDetailPayload>(`/api/history/games/${encodeURIComponent(id)}`)
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).game_id)
  if (!data) return { title: 'Game' }
  const { home_team, away_team, game_date } = data.game
  return { title: `${away_team.abbreviation} @ ${home_team.abbreviation} · ${formatDayShort(game_date)}` }
}

export default async function HistoryGamePage({ params }: Params) {
  const { game_id } = await params
  const data = await load(game_id)
  if (!data) notFound()

  const { game, box_score } = data
  const lacHome = game.home_team.abbreviation === 'LAC'
  const lac = { abbr: 'LAC', score: lacHome ? game.home_score : game.away_score }
  const oppAbbr = lacHome ? game.away_team.abbreviation : game.home_team.abbreviation
  const opp = { abbr: oppAbbr, score: lacHome ? game.away_score : game.home_score }
  const insights: Insight[] = (data.insights ?? []).map((i) => ({ ...i, category: i.category ?? i.proof?.summary ?? '' }))

  const season = await getJson<{ games: HistoryGame[] }>(`/api/history/games?season_id=${game.season_id}&limit=200`)
  const played = playedGames(season?.games ?? [])
  const idx = played.findIndex((g) => String(g.game_id) === String(game_id))
  const prev = idx > 0 ? played[idx - 1] : null
  const next = idx >= 0 && idx < played.length - 1 ? played[idx + 1] : null

  const neighbor = (g: HistoryGame | null, dir: 'prev' | 'next') =>
    g ? (
      <Link
        href={`/history/${g.game_id}`}
        className={`flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-[12.5px] text-mute transition-colors hover:border-line-2 hover:text-text ${dir === 'next' ? 'flex-row-reverse' : ''}`}
      >
        <span aria-hidden>{dir === 'prev' ? '←' : '→'}</span>
        <TeamLogo abbr={g.opponent_abbr} size="xs" />
        <span>
          {g.home_away === 'home' ? 'vs' : '@'} {g.opponent_abbr} · {formatDayShort(g.game_date)}
        </span>
      </Link>
    ) : (
      <span />
    )

  return (
    <div className="page">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/history?season_id=${game.season_id}`} className="font-mono text-[12px] text-mute hover:text-text">
          ← History
        </Link>
        <div className="flex flex-wrap gap-2">
          {neighbor(prev, 'prev')}
          {neighbor(next, 'next')}
        </div>
      </div>

      <section className="enter" aria-label="Final score">
        <Scoreboard
          lac={lac}
          opp={{ ...opp, name: teamName(oppAbbr) }}
          lacHome={lacHome}
          mode="final"
          status={(game.periods?.length ?? 0) > 4 ? 'Final/OT' : game.status}
          dateLabel={formatDayLong(game.game_date)}
          tag={idx >= 0 ? gameTypeLabel(played[idx].game_type) : null}
        >
          <LineScore periods={game.periods ?? []} lacHome={lacHome} oppAbbr={oppAbbr} />
        </Scoreboard>

      </section>

      <section
        className={`enter grid grid-cols-1 items-start gap-6 lg:gap-[18px] ${insights.length ? 'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : ''}`}
        style={{ ['--i' as string]: 1 }}
      >
        <div className="min-w-0">
          <Eyebrow>Box score</Eyebrow>
          {box_score.available && box_score.teams.length ? (
            <BoxScore teams={box_score.teams} />
          ) : (
            <EmptyState title="No box score for this game" body="Player stats weren't captured for this game." />
          )}
        </div>
        {insights.length > 0 && (
          <div className="min-w-0">
            <Eyebrow aside={`${insights.length} verified`}>Insights</Eyebrow>
            <div className="grid gap-2.5">
              {insights.map((ins) => (
                <InsightCard key={ins.insight_id} insight={ins} />
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
