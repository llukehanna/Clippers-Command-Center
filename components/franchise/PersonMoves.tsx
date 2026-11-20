'use client'

import * as React from 'react'
import { MovesBody } from '@/components/franchise/MovesBody'
import { personMoves, type MovesFilters } from '@/src/lib/franchise/display'
import type { MovesPayload } from '@/src/lib/ui/types'

/**
 * A person's Clippers moves (/franchise/person/<key>). The page ships their whole
 * history (all types, all seasons); the type and season filters narrow it in the
 * browser, with no URL state. The first render is `initial` (all/all), the
 * same view the server rendered, so nothing flashes on hydration.
 */
export function PersonMoves({ all, initial, lastSeason }: { all: MovesPayload; initial: MovesFilters; lastSeason: number }) {
  const [asked, setAsked] = React.useState<MovesFilters>(initial)
  const { filters, data } = personMoves(all, asked)
  return <MovesBody filters={filters} data={data} lastSeason={lastSeason} onFilters={setAsked} />
}
