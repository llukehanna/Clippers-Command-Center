import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MovesView } from '@/components/franchise/MovesView'
import { parseMoveType, parseMovesSeason } from '@/src/lib/franchise/display'
import { moveSeasonIds, moveSeasonParams } from '@/src/lib/prebuild/params'
import { staticParams } from '@/src/lib/prebuild/static-params'

// One Moves type in one season (or all seasons, for Trades). Prerendered at build
// for every season the Moves pages link (the era ribbon's whole range, so a
// season without moves of the type shows the empty state) × every type, plus
// /franchise/moves/trade/all; anything else 404s until the next build.
export const dynamicParams = false

export async function generateStaticParams() {
  // Sample the seasons, then every type of each: a sampled build stays small and
  // a full build (staticParams is the identity) gets every combination.
  return moveSeasonParams(staticParams(await moveSeasonIds()))
}

export const metadata: Metadata = { title: 'Franchise' }

export default async function MovesSeasonPage({ params }: { params: Promise<{ type: string; season: string }> }) {
  const p = await params
  const type = parseMoveType(p.type)
  const season = type ? parseMovesSeason(p.season, { type, player: null }) : null
  if (!type || season == null) notFound()
  return <MovesView filters={{ season, type, player: null }} />
}
