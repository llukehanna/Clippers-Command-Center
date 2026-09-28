'use client'

import * as React from 'react'
import { LiveView } from '@/components/live/LiveView'
import { Chip } from '@/components/ui/chip'
import { liveFixture } from './fixture'

export function DevLiveClient() {
  const [delayedAt, setDelayedAt] = React.useState<string | null>(null)
  const [data, setData] = React.useState(() => liveFixture())
  const delayed = delayedAt !== null

  const payload = delayedAt ? { ...data, state: 'DATA_DELAYED' as const, snapshot_captured_at: delayedAt } : data

  return (
    <>
      <div className="mx-auto flex max-w-[1320px] flex-wrap items-center gap-2 px-3.5 pt-4 sm:px-[22px]">
        <Chip tone="warn">Fixture · sample data</Chip>
        <button
          type="button"
          className="rounded-full border border-line px-3 py-1 text-[12.5px] text-mute hover:text-text"
          onClick={() =>
            setData((d) => ({
              ...d,
              game: d.game && { ...d.game, home: { ...d.game.home, score: (d.game.home.score ?? 0) + 3 } },
            }))
          }
        >
          LAC +3
        </button>
        <button type="button" className="rounded-full border border-line px-3 py-1 text-[12.5px] text-mute hover:text-text" onClick={() => setDelayedAt((v) => (v ? null : new Date(Date.now() - 3 * 60_000).toISOString()))}>
          {delayed ? 'Set live' : 'Set delayed'}
        </button>
      </div>
      <LiveView data={payload} />
    </>
  )
}
