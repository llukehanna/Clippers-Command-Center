import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SeasonPage } from '@/components/history/SeasonPage'
import { historyFilterParams, historySeasonIds } from '@/src/lib/prebuild/params'
import { staticParams } from '@/src/lib/prebuild/static-params'
import { historyFilter, parseHistoryFilter } from '@/src/lib/urls'

// One History season under a venue/result filter (/home, /away-wins, ...).
// Prerendered at build for every season × every filter but `all` (that's the
// season page itself); anything else 404s until the next build.
export const dynamicParams = false

export async function generateStaticParams() {
  // Sample the seasons, then every filter of each: a sampled build stays small
  // and a full build (staticParams is the identity) gets every combination.
  return historyFilterParams(staticParams(await historySeasonIds()))
}

export const metadata: Metadata = { title: 'History' }

export default async function HistorySeasonFilterPage({ params }: { params: Promise<{ season_id: string; filter: string }> }) {
  const { season_id, filter } = await params
  const parsed = parseHistoryFilter(filter)
  if (!/^\d+$/.test(season_id) || !parsed) notFound()
  const canonical = historyFilter(parsed.homeAway, parsed.result)
  if (canonical === 'all') notFound()
  return <SeasonPage seasonId={season_id} filter={canonical} />
}
