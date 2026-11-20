import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PlayerDetail, playerDetailMetadata } from '@/components/players/PlayerDetail'
import { playerIds, playerSeasonParams } from '@/src/lib/prebuild/params'
import { staticParams } from '@/src/lib/prebuild/static-params'

// One Clippers season of a player's profile (the season picker's links).
// Prerendered at build for every season each known player's picker offers;
// anything else 404s until the next build.
export const dynamicParams = false

export async function generateStaticParams() {
  // Narrow the players first so a sampled build only loads the sampled players'
  // careers; a full build (staticParams is the identity) gets every season.
  return staticParams(await playerSeasonParams(staticParams(await playerIds())))
}

type Params = { params: Promise<{ player_id: string; season_id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return playerDetailMetadata((await params).player_id)
}

export default async function PlayerSeasonPage({ params }: Params) {
  const { player_id, season_id } = await params
  if (!/^\d{4}$/.test(season_id)) notFound()
  return <PlayerDetail player_id={player_id} season={Number(season_id)} />
}
