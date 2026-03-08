'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'

export type SurfaceVariant = 'nav' | 'scoreboard' | 'card'

export interface SurfaceProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: SurfaceVariant
  hover?: boolean
  glow?: boolean
}

const variantStyles: Record<SurfaceVariant, string> = {
  nav: cn(
    'rounded-2xl border border-border-edge shadow-[0_0_0_1px_rgba(255,255,255,0.06)_inset,0_24px_64px_-12px_rgba(0,0,0,0.85),0_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl transition-shadow duration-300',
    'bg-surface-glass-nav'
  ),
  scoreboard: cn(
    'overflow-hidden rounded-2xl border border-border-subtle border-t-white/[0.1] border-l-white/[0.08] shadow-[0_0_0_1px_rgba(255,255,255,0.05)_inset,0_16px_48px_-16px_rgba(0,0,0,0.65)] backdrop-blur-xl transition-shadow duration-300',
    'bg-gradient-to-br from-[var(--surface-alt)]/90 via-[var(--surface)]/92 to-[var(--surface)]/90'
  ),
  card: cn(
    'rounded-xl border border-border-subtle shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_10px_32px_-12px_rgba(0,0,0,0.5)] backdrop-blur-sm transition-all duration-200',
    'bg-surface-glass'
  ),
}

const Surface = React.forwardRef<HTMLDivElement, SurfaceProps>(
  ({ className, variant = 'card', hover = false, glow = false, style, ...props }, ref) => {
    const base = variantStyles[variant]
    const hoverClass = hover ? 'ccc-hover-card' : ''
    const glowClass = glow
      ? 'shadow-[0_0_0_1px_rgba(255,255,255,0.04)_inset,0_0_20px_-8px_rgba(200,16,46,0.15)]'
      : ''
    return (
      <div
        ref={ref}
        className={cn(base, hoverClass, glowClass, className)}
        style={style}
        {...props}
      />
    )
  }
)
Surface.displayName = 'Surface'

export { Surface }
