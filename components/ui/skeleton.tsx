import type * as React from 'react'
import { cn } from '@/lib/utils'

/** Shimmering placeholder block. Size it with className. */
export function Skeleton({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return <div aria-hidden style={style} className={cn('shimmer rounded-[12px]', className)} />
}
