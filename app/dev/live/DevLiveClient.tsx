'use client'

import * as React from 'react'
import { LiveView } from '@/components/live/LiveView'
import { Chip } from '@/components/ui/chip'
import { liveFixture } from './fixture'

export function DevLiveClient() {
  const [delayed, setDelayed] = React.useState(false)
  const [data, setData] = React.useState(() => liveFixture())

  const payload = delayed
    ? { ...data, state: 'DATA_DELAYED' as const, snapshot_captured_at: new Date(Date.now() - 3 * 60_000).toISOString() }
    : data

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
        <button type="button" className="rounded-full border border-line px-3 py-1 text-[12.5px] text-mute hover:text-text" onClick={() => setDelayed((v) => !v)}>
          {delayed ? 'Set live' : 'Set delayed'}
        </button>
      </div>
      <LiveView data={payload} />
    </>
  )
}
