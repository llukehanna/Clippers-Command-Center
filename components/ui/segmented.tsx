'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface Option<T extends string> {
  value: T
  label: React.ReactNode
}

interface SegmentedProps<T extends string> {
  value: T
  options: Option<T>[]
  ariaLabel: string
  onChange?: (value: T) => void
  /** When set, options render as links (URL-driven state, works without JS). */
  hrefFor?: (value: T) => string
  size?: 'sm' | 'md'
  className?: string
}

/** Pill segmented control. */
export function Segmented<T extends string>({ value, options, ariaLabel, onChange, hrefFor, size = 'md', className }: SegmentedProps<T>) {
  const item = cn(
    'relative whitespace-nowrap rounded-full transition-[color,background-color,box-shadow] duration-300 ease-premium',
    size === 'sm' ? 'px-3 py-1 text-[12.5px]' : 'px-3.5 py-1.5 text-[13.5px]',
  )
  const active = 'bg-ink-3 text-text shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_0_0_1px_var(--line)]'
  const idle = 'text-mute hover:bg-white/[0.04] hover:text-text'

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex max-w-full gap-0.5 overflow-x-auto rounded-full border border-line bg-white/[0.025] p-[3px] no-scrollbar', className)}
    >
      {options.map((opt) => {
        const isActive = opt.value === value
        if (hrefFor) {
          return (
            <Link
              key={opt.value}
              href={hrefFor(opt.value)}
              scroll={false}
              aria-current={isActive ? 'true' : undefined}
              className={cn(item, isActive ? active : idle)}
            >
              {opt.label}
            </Link>
          )
        }
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
