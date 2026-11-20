import type { Metadata } from 'next'
import { PlayerDetail, playerDetailMetadata } from '@/components/players/PlayerDetail'
import { playerIds } from '@/src/lib/prebuild/params'
import { staticParams } from '@/src/lib/prebuild/static-params'

// Prerendered at build for every known id; unknown ids 404 until the next build.
export const dynamicParams = false

export async function generateStaticParams() {
  return staticParams(await playerIds()).map((player_id) => ({ player_id }))
}

type Params = { params: Promise<{ player_id: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  return playerDetailMetadata((await params).player_id)
}

export default async function PlayerDetailPage({ params }: Params) {
  const { player_id } = await params
  return <PlayerDetail player_id={player_id} season={null} />
}
