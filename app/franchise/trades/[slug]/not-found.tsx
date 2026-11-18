import Link from 'next/link'
import { EmptyState } from '@/components/ui/empty-state'
import { movesHref } from '@/src/lib/franchise/display'

/** Unknown trade slug: stays inside the Franchise layout, with one way back. */
export default function TradeNotFound() {
  return (
    <EmptyState
      className="enter"
      title="No trade at this address"
      body="The link may be out of date, or this trade hasn't been imported yet. Every recorded trade is listed on Moves."
      action={
        <Link
          href={movesHref({ season: 'all', type: 'trade', player: null })}
          prefetch={false}
          className="glass-track press inline-flex rounded-full px-4 py-2 text-[13.5px] text-text"
        >
          All trades
        </Link>
      }
    />
  )
}
