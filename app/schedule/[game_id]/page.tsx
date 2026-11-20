import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextGamePanel } from '@/components/game/NextGamePanel'
import { Chip } from '@/components/ui/chip'
import { WhereToWatch } from '@/components/preview/WhereToWatch'
import { LineCard } from '@/components/preview/LineCard'
import { Availability } from '@/components/preview/Availability'
import { Matchup } from '@/components/preview/Matchup'
import { getJson } from '@/src/lib/ui/api'
import { scheduleGameIds } from '@/src/lib/prebuild/params'
import { staticParams } from '@/src/lib/prebuild/static-params'
import { formatDayShort } from '@/src/lib/ui/time'
import type { GamePreviewPayload } from '@/src/lib/ui/types'

// Prerendered at build for every known id; unknown ids 404 until the next build.
export const dynamicParams = false

export async function generateStaticParams() {
  return staticParams(await scheduleGameIds()).map((game_id) => ({ game_id }))
}

type Params = { params: Promise<{ game_id: string }> }

const load = (id: string) => getJson<GamePreviewPayload>(`/api/schedule/${encodeURIComponent(id)}`)

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).game_id)
  if (!data) return { title: 'Game preview' }
  const g = data.game
  return { title: `LAC ${g.home_away === 'home' ? 'vs' : '@'} ${g.opponent_abbr} · ${formatDayShort(g.game_date)}` }
}

export default async function GamePreviewPage({ params }: Params) {
  const { game_id } = await params
  const data = await load(game_id)
  if (!data) notFound()

  const { game } = data
  const status = game.status.toLowerCase()
  if (status === 'final') redirect(`/history/${game.game_id}`)
  const oppAbbr = game.opponent_abbr

  return (
    <div className="page">
      <Link href="/schedule" className="font-mono text-[12px] text-mute hover:text-text">
        ← Schedule
      </Link>

      {status === 'in_progress' && (
        <Link href="/live" className="panel enter flex items-center justify-between gap-3 px-4 py-3 transition-colors hover:border-line-2">
          <span className="flex items-center gap-2.5 text-[14px]">
            <Chip tone="live">Live</Chip> This game is on now
          </span>
          <span className="font-mono text-[12px] text-mute">Follow live →</span>
        </Link>
      )}

      <div className="enter" style={{ ['--i' as string]: 0 }}>
        <NextGamePanel game={game} eyebrow="Game preview" arena={game.arena} insights={data.insight_feeds} />
      </div>

      <section className="enter grid items-stretch gap-3 lg:grid-cols-2" style={{ ['--i' as string]: 1 }}>
        <WhereToWatch gameId={game.game_id} broadcasts={data.broadcasts} oppAbbr={oppAbbr} />
        {data.line && <LineCard line={data.line} />}
      </section>

      {data.injuries && (
        <div className="enter" style={{ ['--i' as string]: 2 }}>
          <Availability injuries={data.injuries} oppAbbr={oppAbbr} />
        </div>
      )}

      <div className="enter" style={{ ['--i' as string]: 3 }}>
        <Matchup matchup={data.matchup} oppAbbr={oppAbbr} />
      </div>
    </div>
  )
}
