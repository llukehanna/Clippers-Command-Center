import * as React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'

export type TeamMarkSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

const PX: Record<TeamMarkSize, number> = { xs: 20, sm: 28, md: 40, lg: 56, xl: 68 }

const KNOWN = new Set([
  'atl', 'bkn', 'bos', 'cha', 'chi', 'cle', 'dal', 'den', 'det', 'gsw', 'hou', 'ind', 'lac', 'lal', 'mem',
  'mia', 'mil', 'min', 'nop', 'nyk', 'okc', 'orl', 'phi', 'phx', 'por', 'sac', 'sas', 'tor', 'uta', 'was',
])

interface TeamLogoProps {
  abbr: string | null | undefined
  size?: TeamMarkSize
  className?: string
  priority?: boolean
}

/** Team logo (trimmed 256px PNGs in /public/teams). Falls back to the abbreviation. */
export function TeamLogo({ abbr, size = 'md', className, priority }: TeamLogoProps) {
  const px = PX[size]
  const slug = (abbr ?? '').toLowerCase()
  if (!KNOWN.has(slug)) {
    return (
      <span
        className={cn('grid shrink-0 place-items-center rounded-full border border-line-2 bg-ink-2 font-mono font-semibold text-mute', className)}
        style={{ width: px, height: px, fontSize: Math.max(9, px * 0.28) }}
        aria-label={abbr ?? 'Unknown team'}
      >
        {(abbr ?? '—').slice(0, 3)}
      </span>
    )
  }
  return (
    <Image
      src={`/teams/${slug}.png`}
      alt={`${abbr} logo`}
      width={px}
      height={px}
      priority={priority}
      className={cn('shrink-0 object-contain drop-shadow-[0_6px_14px_rgba(0,0,0,0.45)]', className)}
    />
  )
}

interface TeamMarkProps extends TeamLogoProps {
  name?: React.ReactNode
  meta?: React.ReactNode
  align?: 'left' | 'right'
}

/** Logo with a name and a mono meta line. */
export function TeamMark({ abbr, size = 'md', name, meta, align = 'left', className, priority }: TeamMarkProps) {
  const big = size === 'lg' || size === 'xl'
  return (
    <div className={cn('flex min-w-0 items-center gap-3', big && 'gap-4', align === 'right' && 'flex-row-reverse text-right', className)}>
      <TeamLogo abbr={abbr} size={size} priority={priority} />
      {(name || meta) && (
        <div className="min-w-0">
          {name && (
            <div
              className={cn(
                'truncate font-semibold leading-tight tracking-[-0.02em]',
                size === 'xl' ? 'text-[22px] sm:text-[24px]' : big ? 'text-[18px]' : 'text-[14.5px] font-medium',
              )}
            >
              {name}
            </div>
          )}
          {meta && <div className="mt-0.5 truncate font-mono text-[11.5px] text-mute">{meta}</div>}
        </div>
      )}
    </div>
  )
}
