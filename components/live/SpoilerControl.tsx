'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Segmented } from '@/components/ui/segmented'
import { DELAY_PRESETS, MAX_DELAY_MS } from '@/src/lib/live/spoiler'
import type { SpoilerState } from '@/hooks/useLiveStream'

/** Hold /live back to match the fan's TV or stream (spec §7.3). */
export function SpoilerControl({ spoiler }: { spoiler: SpoilerState }) {
  const [open, setOpen] = React.useState(false)
  const [note, setNote] = React.useState<string | null>(null)
  const secs = Math.round(spoiler.delayMs / 1000)
  const preset = DELAY_PRESETS.find((p) => p.ms === spoiler.delayMs)

  const sync = () => {
    const d = spoiler.sync()
    setNote(d === null ? 'No basket in the last two minutes yet. Try again after the next one.' : `Synced: ${Math.round(d / 1000)} s behind live.`)
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-line-2 px-3 py-1 font-mono text-[11.5px] transition-colors hover:border-pacific/60',
          secs > 0 ? 'text-text' : 'text-mute',
        )}
      >
        Spoiler delay · {secs > 0 ? `${secs} s` : 'Off'}
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-2 w-[min(320px,calc(100vw-32px))] rounded-[16px] border border-line-2 bg-ink-2/95 p-4 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] backdrop-blur">
          <p className="m-0 mb-3 text-[12.5px] text-mute">Hold this page back so nothing shows before your TV or stream does.</p>
          <Segmented
            size="sm"
            ariaLabel="Delay preset"
            value={preset ? String(preset.ms) : 'custom'}
            options={DELAY_PRESETS.map((p) => ({ value: String(p.ms), label: p.ms ? `${p.label} ${p.ms / 1000}s` : p.label }))}
            onChange={(v) => {
              setNote(null)
              spoiler.setDelay(Number(v))
            }}
          />
          <label className="mt-3 grid gap-1.5 font-mono text-[11px] text-dim">
            Delay {secs} s
            <input
              type="range"
              min={0}
              max={MAX_DELAY_MS / 1000}
              step={1}
              value={secs}
              onChange={(e) => {
                setNote(null)
                spoiler.setDelay(Number(e.target.value) * 1000)
              }}
              className="accent-[var(--pacific)]"
            />
          </label>
          <button
            type="button"
            onClick={sync}
            className="mt-3 w-full rounded-full bg-pacific px-4 py-2 text-[13px] font-semibold text-white transition-[filter] hover:brightness-110"
          >
            Sync to my screen
          </button>
          <p className="m-0 mt-2 text-[11.5px] text-dim" aria-live="polite">
            {note ?? 'Tap it the moment your screen shows a basket.'}
          </p>
        </div>
      )}
    </div>
  )
}
