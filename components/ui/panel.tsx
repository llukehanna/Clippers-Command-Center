import * as React from 'react'
import { cn } from '@/lib/utils'

type PanelVariant = 'default' | 'inset' | 'hero'

type PanelProps<T extends React.ElementType> = {
  as?: T
  variant?: PanelVariant
  className?: string
  children?: React.ReactNode
} & Omit<React.ComponentPropsWithoutRef<T>, 'as' | 'className' | 'children'>

const VARIANTS: Record<PanelVariant, string> = {
  default: 'panel',
  inset: 'panel-inset',
  hero: 'panel panel-hero',
}

/** Glass surface — the one container style used across the app. */
export function Panel<T extends React.ElementType = 'div'>({
  as,
  variant = 'default',
  className,
  children,
  ...rest
}: PanelProps<T>) {
  const Tag = (as ?? 'div') as React.ElementType
  return (
    <Tag className={cn(VARIANTS[variant], className)} {...rest}>
      {children}
    </Tag>
  )
}
