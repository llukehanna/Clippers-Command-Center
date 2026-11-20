'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { useLens } from '@/hooks/useLens'
import { segmentedClasses } from './segmented-styles'
import { isPlainClick } from './plain-click'

interface SegmentedLinksProps {
  value: string
  options: Array<{ value: string; label: React.ReactNode; href: string }>
  ariaLabel: string
  size?: 'sm' | 'md'
  className?: string
  /**
   * In-page state instead of navigation: a plain click calls this and stays on
   * the page (modified clicks still follow the href, e.g. to a new tab).
   */
  onSelect?: (value: string) => void
}

/**
 * Segmented control whose options are links (URL-driven state). The lens moves
 * to the clicked option immediately; the page catches up.
 */
export function SegmentedLinks({ value, options, ariaLabel, size = 'md', className, onSelect }: SegmentedLinksProps) {
  const { item, active, idle, group, lens } = segmentedClasses(size)
  const [pending, setPending] = React.useState<string | null>(null)
  const ref = React.useRef<HTMLElement>(null)

  // The URL caught up: drop the optimistic selection.
  React.useEffect(() => {
    // Resetting derived UI state when the selected value changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPending(null)
  }, [value])

  // On narrow screens the row scrolls: keep the selected option in view (centred only when it was cut off).
  React.useEffect(() => {
    const nav = ref.current
    const active = nav?.querySelector<HTMLElement>('[aria-current="true"]')
    if (!nav || !active) return
    const left = active.offsetLeft
    const right = left + active.offsetWidth
    if (left >= nav.scrollLeft && right <= nav.scrollLeft + nav.clientWidth) return
    nav.scrollTo({ left: Math.max(0, left - (nav.clientWidth - active.offsetWidth) / 2) })
  }, [value])

  const current = pending ?? value
  const lensStyle = useLens(ref, current)
  return (
    <nav ref={ref} aria-label={ariaLabel} className={cn(group, className)}>
      <span aria-hidden className={lens} style={lensStyle} />
      {options.map((opt) => {
        const isActive = opt.value === current
        return (
          <Link
            key={opt.value}
            href={opt.href}
            scroll={false}
            data-active={isActive}
            aria-current={opt.value === value ? 'true' : undefined}
            onClick={(e) => {
              if (onSelect && isPlainClick(e)) {
                e.preventDefault()
                onSelect(opt.value)
              } else if (opt.value !== value) setPending(opt.value)
            }}
            className={cn(item, isActive ? active : idle)}
          >
            {opt.label}
          </Link>
        )
      })}
    </nav>
  )
}
