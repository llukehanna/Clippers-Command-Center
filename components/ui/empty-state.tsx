import * as React from 'react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title: string
  body?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

/** Quiet, centered message used for empty, offseason and error states. */
export function EmptyState({ title, body, action, className }: EmptyStateProps) {
  return (
    <div className={cn('panel flex flex-col items-center gap-2 px-6 py-12 text-center', className)}>
      <p className="m-0 text-[16px] font-medium tracking-[-0.01em] text-text">{title}</p>
      {body && <p className="m-0 max-w-[52ch] text-[14px] text-mute">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
