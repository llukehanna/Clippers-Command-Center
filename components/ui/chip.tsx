import * as React from 'react'
import { cn } from '@/lib/utils'

export type ChipTone = 'default' | 'blue' | 'pos' | 'neg' | 'live' | 'warn'

const TONES: Record<ChipTone, string> = {
  default: 'border-line-2 bg-white/[0.02] text-mute',
  blue: 'border-pacific/35 bg-pacific/[0.14] text-[#9cc7f2]',
  pos: 'border-pos/30 bg-pos/[0.12] text-pos',
  neg: 'border-neg/30 bg-neg/[0.12] text-neg',
  live: 'border-live/40 bg-live/[0.16] text-[#ff8a9b]',
  warn: 'border-warn/35 bg-warn/[0.12] text-warn',
}

interface ChipProps {
  tone?: ChipTone
  children: React.ReactNode
  className?: string
  title?: string
}

/** Small mono badge. */
export function Chip({ tone = 'default', children, className, title }: ChipProps) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-[3px] font-mono text-[10.5px] uppercase leading-none tracking-[0.08em]',
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Win/loss square used in result columns. */
export function ResultBadge({ result }: { result: 'W' | 'L' }) {
  return (
    <span
      className={cn(
        'inline-grid h-6 w-6 shrink-0 place-items-center rounded-[7px] font-mono text-[11px] font-semibold',
        result === 'W' ? 'bg-pos/[0.14] text-pos' : 'bg-neg/[0.14] text-neg',
      )}
    >
      {result}
    </span>
  )
}
