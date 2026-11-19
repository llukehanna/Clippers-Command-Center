import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { Scoreboard } from '@/components/game/Scoreboard'
import { BoxScore } from '@/components/game/BoxScore'
import { LineScore } from '@/components/game/LineScore'
import { gameTypeLabel } from '@/src/lib/ui/season'
import { InsightTile } from '@/components/insights/kit/InsightTile'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Panel } from '@/components/ui/panel'
import { GameFlow } from '@/components/live/GameFlow'
import { FlowStats } from '@/components/postgame/FlowStats'
import { QuarterTable } from '@/components/postgame/QuarterTable'
import { ClutchCard } from '@/components/postgame/ClutchCard'
import { ShotChart } from '@/components/postgame/ShotChart'
import { RecordMoments } from '@/components/postgame/RecordMoments'
import { EmptyState } from '@/components/ui/empty-state'
import { TeamLogo } from '@/components/ui/team-mark'
import { getJson } from '@/src/lib/ui/api'
import { playedGames, type HistoryGame } from '@/src/lib/ui/season'
import { formatDayLong, formatDayShort } from '@/src/lib/ui/time'
import { teamName } from '@/src/lib/ui/teams'
import type { GameStoryPayload, HistoryGameDetailPayload } from '@/src/lib/ui/types'

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
  // The story only needs the id, so it loads alongside the game.
  const storyPromise = getJson<GameStoryPayload>(`/api/history/games/${encodeURIComponent(game_id)}/story`)
  const data = await load(game_id)
  if (!data) notFound()

  const { game, box_score } = data
  // Not played yet (or still in progress): the preview page owns this game.
  if (String(game.status).toLowerCase() !== 'final') redirect(`/schedule/${game.game_id}`)
  const story = await storyPromise
  // The Clippers side is identified by team, not tricode (era abbreviations are BUF/SDC/LAC).
  const lacHome = game.home_team.is_lac ?? game.home_team.abbreviation === 'LAC'
  const lacTeam = lacHome ? game.home_team : game.away_team
  const oppTeam = lacHome ? game.away_team : game.home_team
  const lac = { abbr: lacTeam.abbreviation, name: teamName(lacTeam.abbreviation, lacTeam.name), score: lacHome ? game.home_score : game.away_score }
  const oppAbbr = oppTeam.abbreviation
  const opp = { abbr: oppAbbr, score: lacHome ? game.away_score : game.home_score }
  const gameStory = data.game_story ?? []

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
          opp={{ ...opp, name: teamName(oppAbbr, oppTeam.name) }}
          lacHome={lacHome}
          mode="final"
          status={(game.periods?.length ?? 0) > 4 ? 'Final/OT' : game.status}
          dateLabel={formatDayLong(game.game_date)}
          tag={idx >= 0 ? gameTypeLabel(played[idx].game_type) : null}
        >
          <LineScore periods={game.periods ?? []} lacHome={lacHome} oppAbbr={oppAbbr} lacAbbr={lac.abbr} />
        </Scoreboard>
      </section>

      {gameStory.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 1 }} aria-label="Game story">
          <Eyebrow aside={`${gameStory.length} verified`}>Game story</Eyebrow>
          <div className="grid gap-3.5 min-[900px]:grid-cols-2">
            {gameStory.map((card) => (
              <InsightTile key={card.insight_id} card={card} size="standard" />
            ))}
          </div>
        </section>
      )}

      {story?.flow && (
        <section className="enter" style={{ ['--i' as string]: 1 }} aria-label="Game flow">
          <Panel className="p-5">
            <Eyebrow aside={story.flow.expected_source === 'spread' ? 'win probability from the closing spread' : 'win probability from home court'}>
              Game flow
            </Eyebrow>
            <GameFlow flow={story.flow.flow} wp={null} oppAbbr={oppAbbr} />
            <FlowStats summary={story.flow.summary} oppAbbr={oppAbbr} />
          </Panel>
        </section>
      )}

      {(story?.quarters || story?.clutch) && (
        <section className={`enter grid items-stretch gap-3 ${story?.quarters && story?.clutch ? 'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : ''}`} style={{ ['--i' as string]: 2 }}>
          {story?.quarters && <QuarterTable quarters={story.quarters} oppAbbr={oppAbbr} />}
          {story?.clutch && <ClutchCard clutch={story.clutch} oppAbbr={oppAbbr} />}
        </section>
      )}

      {(story?.shots || story?.records) && (
        <section className={`enter grid items-stretch gap-3 ${story?.shots && story?.records ? 'lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]' : ''}`} style={{ ['--i' as string]: 3 }}>
          {story?.shots && <ShotChart shots={story.shots.shots} located={story.shots.located} total={story.shots.total} />}
          {story?.records && <RecordMoments notes={story.records} />}
        </section>
      )}

      <section className="enter" style={{ ['--i' as string]: 4 }}>
        <Eyebrow>Box score</Eyebrow>
        {game.season_id < 1983 && (
          <p className="m-0 mb-3 text-[13px] text-mute">Box score from historical records; some stats weren&apos;t tracked in this era.</p>
        )}
        {box_score.available && box_score.teams.length ? (
          <BoxScore
            teams={box_score.teams}
            tags={box_score.tags}
            names={{ [lacTeam.abbreviation]: lac.name, [oppTeam.abbreviation]: teamName(oppTeam.abbreviation, oppTeam.name) }}
          />
        ) : (
          <EmptyState title="No box score for this game" body="Player stats weren't captured for this game." />
        )}
      </section>
    </div>
  )
}
