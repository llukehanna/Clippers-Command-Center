import type { Metadata } from 'next'
import { RosterPage } from '@/components/players/RosterPage'

export const metadata: Metadata = { title: 'Players' }

export default function PlayersPage() {
  return <RosterPage view="cards" scope="active" />
}
