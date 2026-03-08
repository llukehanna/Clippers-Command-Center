'use client'

import * as React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

export type TeamLogoSize = 'scoreboard' | 'sm' | 'md' | 'lg'

const sizeClasses: Record<TeamLogoSize, string> = {
  scoreboard: 'h-20 w-20 md:h-24 md:w-24',
  sm: 'h-8 w-8',
  md: 'h-10 w-10',
  lg: 'h-12 w-12',
}

export interface TeamLogoProps {
  /** Team abbreviation slug, e.g. 'lac', 'lal' */
  slug: string
  /** Alt text; defaults to "{slug} logo" */
  alt?: string
  size?: TeamLogoSize
  /** Base path for logo assets; default /logos/ (supports public/logos/ or public/logos/nba/) */
  basePath?: string
  className?: string
}

/**
 * Team logo — clean image only, no badge or ring (spec §6.3, §12.2).
 * Scoreboard size: 80px base, 96px on md+.
 */
export function TeamLogo({
  slug,
  alt,
  size = 'scoreboard',
  basePath = '/logos/',
  className,
}: TeamLogoProps) {
  const src = `${basePath.replace(/\/$/, '')}/${slug}.png`
  const resolvedAlt = alt ?? `${slug.toUpperCase()} logo`
  return (
    <div className={cn('relative shrink-0', sizeClasses[size], className)}>
      <Image
        src={src}
        alt={resolvedAlt}
        fill
        sizes={size === 'scoreboard' ? '96px' : '48px'}
        className="object-contain"
      />
    </div>
  )
}

export interface TeamLogoWithAbbrProps extends TeamLogoProps {
  /** Team abbreviation shown below logo, e.g. 'LAC' */
  abbr: string
}

/**
 * Team logo with abbreviation below (scoreboard layout).
 */
export function TeamLogoWithAbbr({ abbr, ...logoProps }: TeamLogoWithAbbrProps) {
  return (
    <div className="flex flex-col items-center gap-2">
      <TeamLogo {...logoProps} />
      <span className="ccc-section-title text-center">{abbr}</span>
    </div>
  )
}
