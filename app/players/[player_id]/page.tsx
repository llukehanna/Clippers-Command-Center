import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PlayerHero } from '@/components/players/PlayerHero'
import { TrendChart } from '@/components/players/TrendChart'
import { SplitsPanel } from '@/components/players/SplitsPanel'
import { PlayerTransactions } from '@/components/players/PlayerTransactions'
import { GameLog, type GameLogRow } from '@/components/players/GameLog'
import { InsightTile } from '@/components/insights/kit/InsightTile'
import { SeasonHighs } from '@/components/players/SeasonHighs'
import { MilestoneWatch } from '@/components/players/MilestoneWatch'
import { Eyebrow } from '@/components/ui/eyebrow'
import { CareerHero, CareerHighs, CareerNumbers, CareerSeasons } from '@/components/players/ClippersCareer'
import type { PlayerCareerPayload } from '@/src/lib/data/player-career'
import { getJson } from '@/src/lib/ui/api'
import { formatSeasonLabel, seasonStartYear } from '@/src/lib/home-utils'
import { seasonShort, type HistoryGame } from '@/src/lib/ui/season'
import type { MovesPayload, PlayerDetailPayload, PlayersPayload } from '@/src/lib/ui/types'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ player_id: string }>; searchParams: Promise<{ season?: string }> }

/** Clippers games only: the profile is about a player's Clippers years. */
const detailPath = (id: string, season: string | null) =>
  `/api/players/${encodeURIComponent(id)}?lac_only=true${season ? `&season_id=${season}` : ''}`

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { player_id } = await params
  const data = await getJson<PlayerDetailPayload>(detailPath(player_id, null))
  return { title: data?.player.display_name ?? 'Player' }
}

export default async function PlayerDetailPage({ params, searchParams }: Params) {
  const { player_id } = await params
  const { season } = await searchParams
  const seasonParam = season && /^\d{4}$/.test(season) ? season : null
  const numericId = /^\d{1,15}$/.test(player_id)
  const [data, roster, moves, career] = await Promise.all([
    getJson<PlayerDetailPayload>(detailPath(player_id, seasonParam)),
    getJson<PlayersPayload>('/api/players?include_traded=true'),
    numericId ? getJson<MovesPayload>(`/api/franchise/moves?player_id=${player_id}`) : null,
    numericId ? getJson<PlayerCareerPayload>(`/api/players/${player_id}/career`) : null,
  ])
  if (!data) notFound()

  const personKey = moves?.moves.flatMap((m) => m.people).find((p) => p.player_id === player_id)?.person_key ?? null

  const log = data.game_log ?? []
  // Payloads cached before these fields shipped lack them: treat a missing list as empty.
  const insights = data.insights ?? []
  const seasonHighs = data.season_highs ?? []
  const milestones = data.milestones ?? []
  const seasonId = log[0] ? seasonStartYear(new Date(`${log[0].game_date}T12:00:00Z`)) : null
  const history = seasonId ? await getJson<{ games: HistoryGame[] }>(`/api/history/games?season_id=${seasonId}&limit=200`) : null
  const byId = new Map((history?.games ?? []).map((g) => [String(g.game_id), g]))
  const rows: GameLogRow[] = log.map((r) => {
    const g = byId.get(String(r.game_id))
    return {
      ...r,
      result: g?.result ?? null,
      score: g?.final_score ? `${g.final_score.team}–${g.final_score.opp}` : null,
    }
  })
  const rosterEntry = roster?.players.find((p) => String(p.player_id) === String(player_id))
  const nbaId: string | number | null = rosterEntry?.nba_person_id ?? career?.nba_person_id ?? null
  const clippersSeasons = career ? career.seasons.regular.length + career.seasons.playoffs.length : 0
  // Former: played for the Clippers, but isn't on (or was traded off) this season's roster.
  const former = clippersSeasons > 0 && (!rosterEntry || !!rosterEntry.is_traded)
  const seasonLabel = seasonId ? formatSeasonLabel(seasonId).replace('-', '–') : 'Season'
  const careerPanels = career && clippersSeasons > 0 && (
    <section className="enter grid grid-cols-1 gap-4 lg:gap-[18px]" style={{ ['--i' as string]: 1 }} aria-label="Clippers career">
      <CareerSeasons playerId={player_id} career={career} selected={seasonId} />
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:gap-[18px]">
        <CareerNumbers career={career} />
        <CareerHighs highs={career.highs} />
      </div>
    </section>
  )

  return (
    <div className="page">
      <Link href={former ? '/players?mode=all-time' : '/players'} className="w-fit font-mono text-[12px] text-mute hover:text-text">
        {former ? '← Players · All-time' : '← Players'}
      </Link>
      <div className="enter">
        {former && career ? (
          <CareerHero name={data.player.display_name} position={data.player.position} career={career} />
        ) : (
          <PlayerHero
            name={data.player.display_name}
            position={data.player.position}
            nbaPlayerId={nbaId}
            seasonLabel={seasonLabel}
            gamesPlayed={log.length}
            season={data.season_averages}
            recent={data.trend_summary}
          />
        )}
      </div>

      {!former && insights.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 1 }} aria-label="Insights">
          <Eyebrow aside={`${insights.length} verified`}>Insights</Eyebrow>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-3 min-[900px]:grid-cols-2">
            {insights.map((card) => (
              <InsightTile
                key={card.insight_id}
                card={card}
                size="standard"
                showSubject={false}
                page={{ kind: 'player', player_id }}
              />
            ))}
          </div>
        </section>
      )}

      {!former && (seasonHighs.length > 0 || milestones.length > 0) && (
        <section
          className={`enter grid grid-cols-1 items-start gap-4 lg:gap-[18px] ${
            seasonHighs.length > 0 && milestones.length > 0 ? 'lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]' : ''
          }`}
          style={{ ['--i' as string]: 1 }}
        >
          {seasonHighs.length > 0 && (
            <div>
              <Eyebrow as="h3" aside={seasonLabel}>
                Season highs
              </Eyebrow>
              <SeasonHighs highs={seasonHighs} seasonLabel={seasonLabel} />
            </div>
          )}
          {milestones.length > 0 && (
            <div>
              <Eyebrow as="h3">Milestone watch</Eyebrow>
              <MilestoneWatch items={milestones} />
            </div>
          )}
        </section>
      )}

      {/* Former players lead with their whole Clippers career; current ones with this season. */}
      {former && careerPanels}
      {former && seasonId && (
        <Eyebrow as="h2" className="-mb-2 mt-2" aside="trend, splits and game log">
          {seasonShort(seasonId)} season
        </Eyebrow>
      )}

      <section className="enter grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:gap-[18px]" style={{ ['--i' as string]: 1 }}>
        <TrendChart charts={data.charts} />
        {data.splits && <SplitsPanel splits={data.splits} />}
      </section>

      {rows.length > 0 && (
        <section className="enter" style={{ ['--i' as string]: 2 }}>
          <Eyebrow aside={`last ${rows.length} games`}>Game log</Eyebrow>
          <GameLog rows={rows} />
        </section>
      )}

      {!former && clippersSeasons > 1 && careerPanels}

      <PlayerTransactions moves={moves?.moves ?? []} personKey={personKey} />
    </div>
  )
}
