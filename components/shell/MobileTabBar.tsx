'use client'

import { useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { CalendarDays, History, House, Landmark, Newspaper, Radio, Users, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLens } from '@/hooks/useLens'
import { useLiveData } from '@/hooks/useLiveData'
import { NAV_LINKS, matchesTab, useNavTabs, type NavHref } from '@/hooks/useNavTabs'
import { gameIsOn } from '@/src/lib/ui/live'

const ICONS: Record<NavHref, LucideIcon> = {
  '/home': House,
  '/live': Radio,
  '/players': Users,
  '/schedule': CalendarDays,
  '/history': History,
  '/franchise': Landmark,
  '/news': Newspaper,
}

/** Finger travel (px) before a press becomes a slide instead of a tap. */
const SLIDE_SLOP = 8

const PAD = 5

interface Slide {
  pointerId: number
  startX: number
  /** Whether the press has turned into a slide. */
  moving: boolean
  index: number
  /** Lens geometry under the finger, relative to the bar. */
  left: number
  cell: number
  height: number
}

/**
 * Phone navigation: a floating liquid-glass tab bar in thumb reach. Tap a tab,
 * or press and slide along the bar: the glass lens follows the finger and the
 * tab under it lights up, and letting go opens that tab. Tapping the current
 * tab scrolls back to the top, like a native app.
 */
export function MobileTabBar() {
  const router = useRouter()
  const { pathname, current, onSelect } = useNavTabs()
  const { data } = useLiveData()
  const isLive = gameIsOn(data)
  const ref = useRef<HTMLDivElement>(null)
  const lens = useLens(ref, current)
  const [slide, setSlide] = useState<Slide | null>(null)
  // A slide ends with a click on whatever is under the finger; swallow it.
  const swallowClick = useRef(false)

  const sliding = slide?.moving === true
  const lit = sliding ? NAV_LINKS[slide.index].href : current

  /** The tab under a viewport x, and where the lens sits for it. */
  const locate = (el: HTMLElement, clientX: number) => {
    const rect = el.getBoundingClientRect()
    const cell = (rect.width - PAD * 2) / NAV_LINKS.length
    const x = Math.min(Math.max(clientX - rect.left, PAD), rect.width - PAD)
    const index = Math.min(NAV_LINKS.length - 1, Math.max(0, Math.floor((x - PAD) / cell)))
    const left = Math.min(Math.max(x - cell / 2, PAD), rect.width - PAD - cell)
    return { index, left, cell, height: rect.height - PAD * 2 }
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    setSlide({ pointerId: e.pointerId, startX: e.clientX, moving: false, ...locate(e.currentTarget, e.clientX) })
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!slide || e.pointerId !== slide.pointerId) return
    if (!slide.moving && Math.abs(e.clientX - slide.startX) < SLIDE_SLOP) return
    if (!slide.moving) e.currentTarget.setPointerCapture(e.pointerId)
    setSlide({ ...slide, moving: true, ...locate(e.currentTarget, e.clientX) })
  }

  const finish = (e: ReactPointerEvent<HTMLDivElement>, commit: boolean) => {
    if (!slide || e.pointerId !== slide.pointerId) return
    if (slide.moving) {
      swallowClick.current = true
      // The click (if any) fires right after pointerup; clear the flag after it.
      setTimeout(() => (swallowClick.current = false), 0)
      const href = NAV_LINKS[slide.index].href
      if (commit && !matchesTab(pathname, href)) {
        onSelect(href)
        router.push(href)
      }
    }
    setSlide(null)
  }

  // While sliding, the lens rides under the finger, slightly lifted.
  const lensStyle: CSSProperties = sliding
    ? {
        width: slide.cell,
        height: slide.height,
        transform: `translate3d(${slide.left}px, ${PAD}px, 0) scale(1.06)`,
        opacity: 1,
        transition: 'transform 90ms linear',
      }
    : lens

  return (
    <nav
      aria-label="Main"
      data-tabbar
      className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(env(safe-area-inset-bottom,0px)+8px)] md:hidden"
    >
      <div
        ref={ref}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={(e) => finish(e, true)}
        onPointerCancel={(e) => finish(e, false)}
        onClickCapture={(e) => {
          if (swallowClick.current) {
            e.preventDefault()
            e.stopPropagation()
          }
        }}
        className={cn(
          'glass-bar relative mx-auto grid max-w-[560px] touch-none select-none grid-cols-7 rounded-[26px] p-[5px] transition-transform duration-300 ease-premium [-webkit-touch-callout:none]',
          sliding && 'scale-[1.015]',
        )}
      >
        <span aria-hidden className="lens pointer-events-none absolute left-0 top-0 rounded-[21px]" style={lensStyle} />
        {NAV_LINKS.map(({ href, label }) => {
          const Icon = ICONS[href]
          const active = lit === href
          const here = matchesTab(pathname, href)
          return (
            <Link
              key={href}
              href={href}
              prefetch
              draggable={false}
              data-active={current === href}
              aria-current={here ? 'page' : undefined}
              onClick={() => {
                if (pathname === href) window.scrollTo({ top: 0, behavior: 'smooth' })
                onSelect(href)
              }}
              className={cn(
                'relative z-10 flex min-h-[50px] flex-col items-center justify-center gap-[3px] rounded-[21px] transition-[color,transform] duration-200 ease-premium',
                !sliding && 'press',
                active ? 'text-white' : 'text-mute',
                sliding && active && 'scale-[1.08]',
              )}
            >
              <span className="relative">
                <Icon aria-hidden size={21} strokeWidth={active ? 2.1 : 1.7} />
                {href === '/live' && isLive && (
                  <span
                    aria-label="Game in progress"
                    className="pulse-dot absolute -right-1 -top-0.5 h-2 w-2 rounded-full bg-live ring-2 ring-[#0a111f] [--dot:#e0243f]"
                  />
                )}
              </span>
              <span className="text-[10.5px] font-medium leading-none tracking-[0.01em]">{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
