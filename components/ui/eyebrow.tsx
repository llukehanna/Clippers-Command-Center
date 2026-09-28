import * as React from 'react'
import { cn } from '@/lib/utils'

interface EyebrowProps {
  children: React.ReactNode
  /** Small secondary marker after the label, e.g. a count. */
  index?: React.ReactNode
  /** Right-aligned note after the hairline. */
  aside?: React.ReactNode
  as?: 'h2' | 'h3' | 'p' | 'div'
  className?: string
}

/** Mono section label with a trailing hairline (lukeghanna.com style). */
export function Eyebrow({ children, index, aside, as: Tag = 'h2', className }: EyebrowProps) {
  return (
    <div className={cn('mb-3.5 flex items-center gap-2.5', className)}>
      <Tag className="m-0 font-mono text-[11.5px] font-normal uppercase leading-none tracking-[0.14em] text-mute">
        {children}
      </Tag>
      {index != null && <span className="font-mono text-[11.5px] leading-none tracking-[0.04em] text-dim">{index}</span>}
      <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-line-2 to-transparent" />
      {aside != null && <span className="font-mono text-[11.5px] leading-none text-dim">{aside}</span>}
    </div>
  )
}
