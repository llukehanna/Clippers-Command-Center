'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
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

/** Pill segmented control (client state). For URL-driven state use SegmentedLinks. */
export function Segmented<T extends string>({ value, options, ariaLabel, onChange, size = 'md', className }: SegmentedProps<T>) {
  const { item, active, idle, group } = segmentedClasses(size)
  return (
    <div role="group" aria-label={ariaLabel} className={cn(group, className)}>
      {options.map((opt) => {
        const isActive = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            aria-pressed={isActive}
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
