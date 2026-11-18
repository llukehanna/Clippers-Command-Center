import type { Metadata } from 'next'
import { StatusPage } from '@/components/shell/StatusPage'

export const metadata: Metadata = { title: 'Not found' }

export default function NotFound() {
  return (
    <StatusPage
      code="404"
      title="That page is out of bounds"
      body="The link may be old, or the game or player isn't in the archive. Head home, check the schedule, or search for a player or game."
    />
  )
}
