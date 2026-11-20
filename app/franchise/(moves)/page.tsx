import type { Metadata } from 'next'
import { MovesView } from '@/components/franchise/MovesView'

export const metadata: Metadata = { title: 'Franchise' }

/** Moves opens on Trades in the latest season with a trade (the same view as /franchise/moves/trade). */
export default function MovesPage() {
  return <MovesView filters={{ season: null, type: 'trade', player: null }} />
}
