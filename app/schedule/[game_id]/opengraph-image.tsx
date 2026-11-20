import { C, Logo, OG_SIZE, logo, renderCard } from '@/app/_og/card'
import { getJson } from '@/src/lib/ui/api'
import { scheduleGameIds } from '@/src/lib/prebuild/params'
import { staticParams } from '@/src/lib/prebuild/static-params'
import { formatDay, formatTip } from '@/src/lib/ui/time'
import { teamName } from '@/src/lib/ui/teams'
import type { GamePreviewPayload } from '@/src/lib/ui/types'

export const alt = 'Clippers game preview'
export const size = OG_SIZE
export const contentType = 'image/png'

// Prerendered at build for every scheduled game; unknown ids 404 until the next build.
export const dynamicParams = false

export async function generateStaticParams() {
  return staticParams(await scheduleGameIds()).map((game_id) => ({ game_id }))
}

export default async function Image({ params }: { params: Promise<{ game_id: string }> }) {
  const { game_id } = await params
  const data = await getJson<GamePreviewPayload>(`/api/schedule/${encodeURIComponent(game_id)}`)
  const game = data?.game
  if (!game) return renderCard(<div style={{ display: 'flex', fontSize: 64, fontWeight: 600 }}>Clippers game</div>, 'Preview')

  const home = game.home_away === 'home'
  const [lacLogo, oppLogo] = await Promise.all([logo('LAC'), logo(game.opponent_abbr)])
  const venue = home ? 'Intuit Dome' : game.arena

  const side = (src: string | null, abbr: string, name: string, meta: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18, width: 380 }}>
      <Logo src={src} abbr={abbr} size={168} />
      <div style={{ display: 'flex', fontSize: 50, fontWeight: 600, letterSpacing: '-0.02em' }}>{name}</div>
      <div style={{ display: 'flex', fontSize: 24, color: C.mute }}>{meta}</div>
    </div>
  )

  return renderCard(
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 30 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 36 }}>
        {side(lacLogo, 'LAC', 'Clippers', home ? 'Home' : 'Away')}
        <div style={{ display: 'flex', fontSize: 30, letterSpacing: '0.12em', color: C.dim }}>{home ? 'VS' : '@'}</div>
        {side(oppLogo, game.opponent_abbr, teamName(game.opponent_abbr), home ? 'Away' : 'Home')}
      </div>
      <div style={{ display: 'flex', fontSize: 30, color: C.text }}>
        {formatDay(game.game_date)} · {formatTip(game.start_time_utc)}
        {venue ? ` · ${venue}` : ''}
      </div>
    </div>,
    'Game preview',
  )
}
