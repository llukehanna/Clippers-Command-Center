import type { Metadata } from 'next'
import { RosterPage } from '@/components/players/RosterPage'

export const metadata: Metadata = { title: 'Players' }

export default function PlayersTradedPage() {
  return <RosterPage view="cards" scope="all" />
}
