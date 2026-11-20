import type { Metadata } from 'next'
import { RosterPage } from '@/components/players/RosterPage'

export const metadata: Metadata = { title: 'Players' }

export default function PlayersTradedTablePage() {
  return <RosterPage view="table" scope="all" />
}
