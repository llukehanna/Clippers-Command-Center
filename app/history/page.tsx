import type { Metadata } from 'next'
import { SeasonPage, type SeasonsPayload } from '@/components/history/SeasonPage'
import { getJson } from '@/src/lib/ui/api'

export const metadata: Metadata = { title: 'History' }

/** The latest season, all games (the same page as /history/season/<latest>). */
export default async function HistoryPage() {
  const seasons = await getJson<SeasonsPayload>('/api/history/seasons')
  return <SeasonPage seasonId={String(seasons?.seasons.at(-1)?.season_id ?? '')} filter="all" />
}
