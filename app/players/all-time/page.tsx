import type { Metadata } from 'next'
import { AllTimePage } from '@/components/players/RosterPage'

export const metadata: Metadata = { title: 'Players' }

export default function PlayersAllTimePage() {
  return <AllTimePage />
}
