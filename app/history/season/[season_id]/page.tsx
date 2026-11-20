import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SeasonPage } from '@/components/history/SeasonPage'
import { historySeasonIds } from '@/src/lib/prebuild/params'
import { staticParams } from '@/src/lib/prebuild/static-params'

// One History season, all games (the season picker's links). Prerendered at
// build for every season the picker offers; anything else 404s until the next build.
export const dynamicParams = false

export async function generateStaticParams() {
  return staticParams(await historySeasonIds()).map((season_id) => ({ season_id }))
}

export const metadata: Metadata = { title: 'History' }

export default async function HistorySeasonPage({ params }: { params: Promise<{ season_id: string }> }) {
  const { season_id } = await params
  if (!/^\d+$/.test(season_id)) notFound()
  return <SeasonPage seasonId={season_id} filter="all" />
}
