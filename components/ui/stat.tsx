import * as React from 'react'
import { cn } from '@/lib/utils'

export type Tone = 'pos' | 'neg' | 'mute' | 'default'

const TONE: Record<Tone, string> = {
  pos: 'text-pos',
  neg: 'text-neg',
  mute: 'text-mute',
  default: 'text-text',
}

interface StatProps {
  label: React.ReactNode
  value: React.ReactNode
  sub?: React.ReactNode
  subTone?: Tone
  valueTone?: Tone
  /** 0..1 — renders a thin pacific meter under the value. */
  meter?: number | null
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE = {
  sm: 'text-[18px]',
  md: 'text-[24px]',
  lg: 'text-[32px] sm:text-[36px]',
}

/** Label / big number / context line. */
export function Stat({ label, value, sub, subTone = 'mute', valueTone = 'default', meter, size = 'md', className }: StatProps) {
  return (
    <div className={cn('min-w-0', className)}>
      <div className="label-mono truncate">{label}</div>
      <div className={cn('mt-1.5 font-semibold leading-none tracking-[-0.03em] tabular-nums', SIZE[size], TONE[valueTone])}>
        {value}
      </div>
      {sub != null && <div className={cn('mt-1.5 truncate font-mono text-[11px]', TONE[subTone])}>{sub}</div>}
      {meter != null && (
        <div className="mt-3 h-[3px] overflow-hidden rounded-full bg-line" aria-hidden>
          <div
            className="h-full rounded-full bg-pacific transition-[width] duration-700 ease-premium"
            style={{ width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%` }}
          />
        </div>
      )}
    </div>
  )
}
