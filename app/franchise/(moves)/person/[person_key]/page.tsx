import type { Metadata } from 'next'
import { MovesView } from '@/components/franchise/MovesView'
import { personKeys } from '@/src/lib/prebuild/params'
import { staticParams } from '@/src/lib/prebuild/static-params'

// One person's Clippers moves, all types and seasons (type and season filters are
// in-page toggles). Prerendered at build for everyone in Clippers moves; anything
// else 404s until the next build.
export const dynamicParams = false

export async function generateStaticParams() {
  return staticParams(await personKeys()).map((person_key) => ({ person_key }))
}

export const metadata: Metadata = { title: 'Franchise' }

/** The key as recorded (nba:… keys carry a colon, which may arrive URI-encoded). */
function personKey(raw: string): string {
  try {
    return decodeURIComponent(raw)
  } catch {
    return raw
  }
}

export default async function PersonMovesPage({ params }: { params: Promise<{ person_key: string }> }) {
  const player = personKey((await params).person_key)
  return <MovesView filters={{ season: 'all', type: 'all', player }} />
}
