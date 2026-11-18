import Link from 'next/link'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Panel } from '@/components/ui/panel'
import { MoveRow } from '@/components/franchise/MoveRow'
import { movesHref } from '@/src/lib/franchise/display'
import type { MoveRow as Move } from '@/src/lib/ui/types'

/** A player's moves with the Clippers, newest first, after the game log. Renders nothing without moves. */
export function PlayerTransactions({ moves, personKey }: { moves: Move[]; personKey: string | null }) {
  if (moves.length === 0) return null
  const count = `with the Clippers · ${moves.length}`
  return (
    <section aria-label="Transactions" className="enter" style={{ ['--i' as string]: 3 }}>
      <Eyebrow
        aside={
          personKey ? (
            <Link href={movesHref({ season: 'all', type: 'all', player: personKey })} className="transition-colors duration-300 ease-premium hover:text-text">
              {count}
            </Link>
          ) : (
            count
          )
        }
      >
        Transactions
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
