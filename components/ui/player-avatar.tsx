'use client'

import * as React from 'react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { headshotUrl, initials } from '@/src/lib/ui/headshot'

interface PlayerAvatarProps {
  name: string
  nbaPlayerId?: string | number | null
  /** Circle diameter in px (circle variant). */
  size?: number
  variant?: 'circle' | 'card' | 'hero'
  priority?: boolean
  className?: string
}

/**
 * NBA headshot with an initials fallback when the id is missing or the image
 * fails to load. `card` and `hero` crop the 1040x760 image into a panel.
 */
export function PlayerAvatar({ name, nbaPlayerId, size = 32, variant = 'circle', priority, className }: PlayerAvatarProps) {
  const [failed, setFailed] = React.useState(false)
  const src = headshotUrl(nbaPlayerId, variant === 'circle' ? 'sm' : 'lg')
  const showImage = src && !failed

  if (variant === 'circle') {
    return (
      <span
        className={cn(
          'relative grid shrink-0 place-items-center overflow-hidden rounded-full border border-line-2 bg-gradient-to-b from-ink-3 to-ink-2 text-[11px] font-semibold text-mute',
          className,
        )}
        style={{ width: size, height: size }}
      >
        {showImage ? (
          <Image
            src={src}
            alt=""
            fill
            sizes={`${size * 2}px`}
            priority={priority}
            className="object-cover object-top [transform:scale(1.35)_translateY(12%)]"
            onError={() => setFailed(true)}
          />
        ) : (
          <span aria-hidden style={{ fontSize: Math.max(10, size * 0.34) }}>{initials(name)}</span>
        )}
      </span>
    )
  }

  return (
    <div
      className={cn(
        'relative overflow-hidden bg-[radial-gradient(120%_90%_at_50%_100%,rgba(65,143,222,0.28),transparent_60%),linear-gradient(180deg,#0f2748,#0b1220)]',
        variant === 'hero' ? 'aspect-[1040/760]' : 'aspect-[4/3]',
        className,
      )}
    >
      {showImage ? (
        <Image
          src={src}
          alt={name}
          fill
          sizes={variant === 'hero' ? '(min-width: 1024px) 520px, 100vw' : '(min-width: 1024px) 300px, 50vw'}
          priority={priority}
          className="object-contain object-bottom"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="absolute inset-0 grid place-items-center text-[40px] font-semibold tracking-[-0.03em] text-mute/60">
          {initials(name)}
        </span>
      )}
    </div>
  )
}
