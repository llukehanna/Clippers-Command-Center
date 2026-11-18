import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Panel } from '@/components/ui/panel'
import { MoveRow } from '@/components/franchise/MoveRow'
import { movesHref } from '@/src/lib/franchise/display'
import type { MoveRow as Move } from '@/src/lib/ui/types'

/** The season's biggest Clippers moves (trades first), under the History summary. Renders nothing without moves. */
export function SeasonMoves({ moves, seasonId, label }: { moves: Move[]; seasonId: number; label: string }) {
  if (moves.length === 0) return null
  return (
    <section aria-label="Moves this season" className="enter" style={{ ['--i' as string]: 2 }}>
      <Eyebrow
        aside={
          <Link href={movesHref({ season: seasonId, type: 'all', player: null })} className="transition-colors duration-300 ease-premium hover:text-text">
            All {label} moves →
          </Link>
        }
      >
        Moves this season
      </Eyebrow>
      <Panel className="p-1.5">
        <ol className="m-0 grid list-none gap-px p-0">
          {moves.map((m) => (
            <MoveRow key={m.slug} move={m} />
          ))}
        </ol>
      </Panel>
    </section>
  )
}
