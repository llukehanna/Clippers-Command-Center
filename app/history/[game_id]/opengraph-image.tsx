import { C, Logo, OG_SIZE, logo, renderCard } from '@/app/_og/card'
import { getJson } from '@/src/lib/ui/api'
import { formatDayLong } from '@/src/lib/ui/time'
import { teamName } from '@/src/lib/ui/teams'
import type { HistoryGameDetailPayload } from '@/src/lib/ui/types'

export const alt = 'Clippers final score'
export const size = OG_SIZE
export const contentType = 'image/png'

// Rendered on demand (only when a link is shared) and held at the edge for a day:
// prerendering ~4,700 of these would nearly double the static file count.
export const dynamic = 'force-dynamic'

export default async function Image({ params }: { params: Promise<{ game_id: string }> }) {
  const { game_id } = await params
  const data = await getJson<HistoryGameDetailPayload>(`/api/history/games/${encodeURIComponent(game_id)}`)
  const game = data?.game
  if (!game) return renderCard(<div style={{ display: 'flex', fontSize: 64, fontWeight: 600 }}>Clippers game</div>, 'Game')

  const lacHome = game.home_team.is_lac ?? game.home_team.abbreviation === 'LAC'
  const lacTeam = lacHome ? game.home_team : game.away_team
  const oppTeam = lacHome ? game.away_team : game.home_team
  const lacScore = lacHome ? game.home_score : game.away_score
  const oppScore = lacHome ? game.away_score : game.home_score
  const final = String(game.status).toLowerCase() === 'final' && lacScore != null && oppScore != null
  const win = final && lacScore! > oppScore!
  const [lacLogo, oppLogo] = await Promise.all([logo(lacTeam.abbreviation), logo(oppTeam.abbreviation)])

  const row = (src: string | null, abbr: string, name: string, score: number | null, lead: boolean) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
      <Logo src={src} abbr={abbr} size={104} />
      <div style={{ display: 'flex', fontSize: 52, fontWeight: 600, letterSpacing: '-0.02em', color: lead ? C.text : C.mute }}>{name}</div>
      <div style={{ marginLeft: 'auto', display: 'flex', fontSize: 108, fontWeight: 600, letterSpacing: '-0.04em', color: lead ? C.text : C.dim }}>
        {score ?? '—'}
      </div>
    </div>
  )

  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 26, color: C.mute }}>
        {final && (
          <div
            style={{
              display: 'flex',
              padding: '4px 14px',
              borderRadius: 10,
              fontWeight: 600,
              color: win ? C.pos : C.neg,
              backgroundColor: win ? 'rgba(76,195,138,0.14)' : 'rgba(240,103,122,0.14)',
            }}
          >
            {win ? 'W' : 'L'}
          </div>
        )}
        {formatDayLong(game.game_date)}
      </div>
      {row(lacLogo, lacTeam.abbreviation, teamName(lacTeam.abbreviation, lacTeam.name), lacScore, !final || win)}
      {row(oppLogo, oppTeam.abbreviation, teamName(oppTeam.abbreviation, oppTeam.name), oppScore, !final || !win)}
    </div>,
    final ? 'Final' : 'Game',
  )
}
