import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { MovesView } from '@/components/franchise/MovesView'
import { MOVE_TYPES, parseMoveType } from '@/src/lib/franchise/display'

// One Moves type tab in its latest season with a move of that type. One page per
// type; anything else 404s.
export const dynamicParams = false

export function generateStaticParams() {
  return MOVE_TYPES.map((type) => ({ type }))
}

export const metadata: Metadata = { title: 'Franchise' }

export default async function MovesTypePage({ params }: { params: Promise<{ type: string }> }) {
  const type = parseMoveType((await params).type)
  if (!type) notFound()
  return <MovesView filters={{ season: null, type, player: null }} />
}
