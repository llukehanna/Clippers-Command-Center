import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PlayerHero } from '@/components/players/PlayerHero'
import { TrendChart } from '@/components/players/TrendChart'
import { SplitsPanel } from '@/components/players/SplitsPanel'
import { GameLog, type GameLogRow } from '@/components/players/GameLog'
import { Eyebrow } from '@/components/ui/eyebrow'
import { getJson } from '@/src/lib/ui/api'
import { formatSeasonLabel, seasonStartYear } from '@/src/lib/home-utils'
import type { HistoryGame } from '@/src/lib/ui/season'
import type { PlayerDetailPayload, PlayersPayload } from '@/src/lib/ui/types'

type Params = { params: Promise<{ player_id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { player_id } = await params
  const data = await getJson<PlayerDetailPayload>(`/api/players/${encodeURIComponent(player_id)}`)
  return { title: data?.player.display_name ?? 'Player' }
}

export default async function PlayerDetailPage({ params }: Params) {
  const { player_id } = await params
  const [data, roster] = await Promise.all([
    getJson<PlayerDetailPayload>(`/api/players/${encodeURIComponent(player_id)}`),
    getJson<PlayersPayload>('/api/players?include_traded=true'),
  ])
  if (!data) notFound()

  const log = data.game_log ?? []
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
  const nbaId = roster?.players.find((p) => String(p.player_id) === String(player_id))?.nba_player_id ?? null

  return (
    <div className="page">
      <Link href="/players" className="w-fit font-mono text-[12px] text-mute hover:text-text">
        ← Players
      </Link>
      <div className="enter">
        <PlayerHero
          name={data.player.display_name}
          position={data.player.position}
          nbaPlayerId={nbaId}
          seasonLabel={seasonId ? formatSeasonLabel(seasonId).replace('-', '–') : 'Season'}
          gamesPlayed={log.length}
          season={data.season_averages}
          recent={data.trend_summary}
        />
      </div>

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
    </div>
  )
}
