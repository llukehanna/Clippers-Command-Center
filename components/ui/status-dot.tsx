import { cn } from '@/lib/utils'

const COLORS = { live: 'var(--live)', ok: 'var(--pos)', warn: 'var(--warn)' } as const

/** Small status dot; pulses by default. */
export function StatusDot({ tone, pulse = true, className }: { tone: keyof typeof COLORS; pulse?: boolean; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('inline-block h-[7px] w-[7px] shrink-0 rounded-full', pulse && 'pulse-dot', className)}
      style={{ background: COLORS[tone], ['--dot' as string]: COLORS[tone] }}
    />
  )
}
