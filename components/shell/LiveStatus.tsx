'use client'

import { StatusDot } from '@/components/ui/status-dot'
import { useNow } from '@/hooks/useNow'
import { ageLabel } from '@/src/lib/ui/time'
import type { ResolvedLiveState } from '@/src/lib/ui/live'
import type { LivePayload } from '@/src/lib/ui/types'

/** "Live · 4s" / "Delayed · 3m" — shown only while a game is on. */
export function LiveStatus({ state, data }: { state: ResolvedLiveState; data: LivePayload | undefined }) {
  const now = useNow(5_000)
  if (state === 'NO_ACTIVE_GAME' || !now) return null
  const delayed = state === 'DATA_DELAYED'
  const age = ageLabel(delayed ? data?.snapshot_captured_at : data?.meta?.generated_at, now)
  return (
    <span className="flex items-center gap-2 whitespace-nowrap font-mono text-[11.5px] text-mute" role="status">
      <StatusDot tone={delayed ? 'warn' : 'live'} />
      {delayed ? 'Delayed' : 'Live'}
      {age && <span className="text-dim">· {age}</span>}
    </span>
  )
}
