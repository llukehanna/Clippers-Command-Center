'use client'

import * as React from 'react'
import type { LatencySample } from '@/hooks/useLiveStream'

const subscribe = () => () => {}
const enabled = () => new URLSearchParams(window.location.search).get('debug') === 'latency'

const secs = (ms: number | null) => (ms === null || !Number.isFinite(ms) ? '—' : `${(ms / 1000).toFixed(1)} s`)

/** `/live?debug=latency`: where the time goes between the real play and this screen. */
export function LatencyOverlay({ sample }: { sample: LatencySample | null }) {
  const on = React.useSyncExternalStore(subscribe, enabled, () => false)
  if (!on || !sample) return null
  const observed = sample.observed_at ? Date.parse(sample.observed_at) : null
  const fetched = Date.parse(sample.fetched_at)
  const rows: Array<[string, number | null]> = [
    ['Play → runner', observed === null ? null : fetched - observed],
    ['Runner → hub', sample.hub_at === null ? null : sample.hub_at - fetched],
    ['Hub → you', sample.hub_at === null ? null : sample.received_at - sample.hub_at],
  ]
  return (
    <div className="fixed bottom-3 right-3 z-50 rounded-xl border border-line bg-ink-1/90 px-3 py-2 font-mono text-[11.5px] text-mute backdrop-blur">
      {rows.map(([label, ms]) => (
        <div key={label} className="flex justify-between gap-4">
          <span>{label}</span>
          <span className="text-text">{secs(ms)}</span>
        </div>
      ))}
      <div className="mt-1 max-w-[220px] text-[10.5px]">
        Each row compares two clocks (NBA, runner, hub, this device), so all three include clock skew.
      </div>
    </div>
  )
}
