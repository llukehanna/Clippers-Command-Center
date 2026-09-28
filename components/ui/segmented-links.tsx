import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { segmentedClasses } from './segmented-styles'

interface SegmentedLinksProps {
  value: string
  options: Array<{ value: string; label: React.ReactNode; href: string }>
  ariaLabel: string
  size?: 'sm' | 'md'
  className?: string
}

/** Segmented control whose options are links — URL-driven state, works in server components. */
export function SegmentedLinks({ value, options, ariaLabel, size = 'md', className }: SegmentedLinksProps) {
  const { item, active, idle, group } = segmentedClasses(size)
  return (
    <nav aria-label={ariaLabel} className={cn(group, className)}>
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <Link key={opt.value} href={opt.href} scroll={false} aria-current={isActive ? 'true' : undefined} className={cn(item, isActive ? active : idle)}>
            {opt.label}
          </Link>
        )
      })}
    </nav>
  )
}
