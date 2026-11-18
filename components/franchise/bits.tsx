import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { initials } from '@/src/lib/ui/headshot'
import type { FranchisePersonRef } from '@/src/lib/ui/types'

/** Underlined text link used inside Franchise rows (players, trades). */
export const plink =
  'underline decoration-[rgba(150,178,230,0.28)] decoration-1 underline-offset-4 transition-[text-decoration-color] duration-300 ease-premium hover:decoration-text'

/** A person's name; a link to their player page when they have one. */
export function PersonName({ person, className }: { person: FranchisePersonRef; className?: string }) {
  if (!person.href) return <span className={className}>{person.name}</span>
  return (
    <Link href={person.href} prefetch={false} className={cn(plink, className)}>
      {person.name}
    </Link>
  )
}

/** Quiet gap marker ("details pending", "protections not recorded"): small, dim, never an error. */
export function GapNote({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-dim', className)}>
      <span aria-hidden className="inline-block h-1.5 w-1.5 rounded-full border border-dashed border-dim" />
      {children}
    </span>
  )
}

/** Round chip used by Draft and Picks owed ("R1 · 30", "1st", "Swap"). */
export function RoundBadge({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn('glass-track inline-flex justify-center whitespace-nowrap rounded-full px-2 py-1 font-mono text-[11px] leading-none text-mute', className)}>
      {children}
    </span>
  )
}

/** Initials disc for people without a headshot (coaches, executives). */
export function InitialsDisc({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn('grid shrink-0 place-items-center rounded-full border border-line-2 bg-gradient-to-b from-ink-3 to-ink-2 font-semibold text-mute', className)}
      style={{ width: size, height: size, fontSize: Math.max(10, size * 0.34) }}
    >
      {initials(name)}
    </span>
  )
}
