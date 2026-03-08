'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

export interface NavLinkCapsuleProps {
  href: string
  children: React.ReactNode
  active?: boolean
  className?: string
}

/**
 * Nav link with Apple Sports / Raycast-style hover capsule.
 * Inactive: pill appears on hover with soft highlight and slight scale.
 * Active: Clippers red pill, no scale (spec §5.4, §11.2).
 */
export function NavLinkCapsule({ href, children, active = false, className }: NavLinkCapsuleProps) {
  return (
    <Link
      href={href}
      className={cn(
        'group relative rounded-full px-3.5 py-2 text-[0.8125rem] font-medium transition-all duration-200 ease-out',
        active ? 'text-primary' : 'text-muted-foreground hover:text-foreground',
        className
      )}
      aria-current={active ? 'page' : undefined}
    >
      {active ? (
        <>
          <span
            className="absolute inset-0 rounded-full border border-primary/40 bg-primary/15 shadow-[0_0_0_1px_rgba(200,16,46,0.25)_inset,0_0_12px_-2px_rgba(200,16,46,0.2)]"
            aria-hidden
          />
          <span className="relative z-10">{children}</span>
        </>
      ) : (
        <>
          <span
            className="absolute inset-0 rounded-full bg-white/[0.1] opacity-0 shadow-[0_0_0_1px_rgba(255,255,255,0.12)_inset,0_1px_2px_rgba(0,0,0,0.2)] transition-all duration-200 ease-out group-hover:opacity-100 group-hover:scale-[1.04]"
            aria-hidden
          />
          <span className="relative z-10">{children}</span>
        </>
      )}
    </Link>
  )
}
