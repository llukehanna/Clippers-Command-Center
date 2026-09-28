'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { useLens } from '@/hooks/useLens'
import { segmentedClasses } from './segmented-styles'

interface Option<T extends string> {
  value: T
  label: React.ReactNode
}

interface SegmentedProps<T extends string> {
  value: T
  options: Option<T>[]
  ariaLabel: string
  onChange?: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

/** Pill segmented control (client state) with a sliding glass lens. For URL state use SegmentedLinks. */
export function Segmented<T extends string>({ value, options, ariaLabel, onChange, size = 'md', className }: SegmentedProps<T>) {
  const { item, active, idle, group, lens } = segmentedClasses(size)
  const ref = React.useRef<HTMLDivElement>(null)
  const lensStyle = useLens(ref, value)
  return (
    <div ref={ref} role="group" aria-label={ariaLabel} className={cn(group, className)}>
      <span aria-hidden className={lens} style={lensStyle} />
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={isActive}
            data-active={isActive}
            onClick={() => onChange?.(opt.value)}
            className={cn(item, isActive ? active : idle)}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}
