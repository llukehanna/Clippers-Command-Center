'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { movesHref, type MovesFilters } from '@/src/lib/franchise/display'
import type { FranchisePersonRef, MovesPayload } from '@/src/lib/ui/types'

const json = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** People in the moves of the current type, most moves first. */
function peopleOf(payload: MovesPayload | undefined): Array<{ person: FranchisePersonRef; count: number }> {
  const byKey = new Map<string, { person: FranchisePersonRef; count: number }>()
  for (const m of payload?.moves ?? []) {
    for (const p of m.people) {
      const cur = byKey.get(p.person_key)
      if (cur) cur.count += 1
      else byKey.set(p.person_key, { person: p, count: 1 })
    }
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.person.name.localeCompare(b.person.name))
}

/**
 * Player filter for Moves. With a player set it's a removable chip; otherwise a button that
 * opens a search over the people in this type's moves (loaded on first open).
 */
export function PlayerFilter({ filters, player }: { filters: MovesFilters; player: FranchisePersonRef | null }) {
  const router = useRouter()
  const [open, setOpen] = React.useState(false)
  const [query, setQuery] = React.useState('')
  const root = React.useRef<HTMLDivElement>(null)
  const { data, error } = useSWR<MovesPayload>(open ? `/api/franchise/moves?type=${filters.type}` : null, json, { revalidateOnFocus: false })

  React.useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  if (filters.player) {
    return (
      <span className="glass-track inline-flex items-center gap-2 rounded-full py-[3px] pl-[3px] pr-1 text-[13px] text-text md:text-[12.5px]">
        <PlayerAvatar name={player?.name ?? filters.player} size={24} />
        {player?.name ?? filters.player}
        <Link
          href={movesHref({ ...filters, player: null })}
          scroll={false}
          aria-label="Remove player filter"
          className="press grid h-7 w-7 place-items-center rounded-full text-mute transition-colors hover:bg-white/[0.08] hover:text-text md:h-[22px] md:w-[22px]"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </Link>
      </span>
    )
  }

  const all = peopleOf(data)
  const q = fold(query.trim())
  const results = (q ? all.filter((p) => fold(p.person.name).includes(q)) : all).slice(0, 8)
  const hrefFor = (key: string) => movesHref({ season: null, type: filters.type, player: key })

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
        className="glass-track press inline-flex items-center gap-2 rounded-full py-2 pl-3.5 pr-4 text-[14px] text-mute transition-colors hover:text-text md:py-1.5 md:pl-3 md:pr-3.5 md:text-[13px]"
      >
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        Player
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Filter moves by player"
          className="glass-bar absolute left-0 top-full z-30 mt-2 bg-[rgba(10,17,31,0.94)] w-[min(320px,calc(100vw-28px))] overflow-hidden rounded-[20px] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.9)] animate-in fade-in-0 zoom-in-[0.98]"
        >
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && results[0]) {
                setOpen(false)
                router.push(hrefFor(results[0].person.person_key), { scroll: false })
              }
            }}
            placeholder="Search players…"
            aria-label="Player name"
            className="h-12 w-full border-b border-line bg-transparent px-4 text-[16px] text-text outline-none placeholder:text-dim md:h-11 md:text-[14px]"
          />
          <ul className="m-0 max-h-[320px] list-none overflow-y-auto overscroll-contain p-1.5">
            {error && <li className="px-3 py-4 text-[13px] text-mute">Players couldn&apos;t load. Try again in a moment.</li>}
            {!data && !error && <li className="px-3 py-4 font-mono text-[11.5px] text-dim">Loading players…</li>}
            {data && results.length === 0 && (
              <li className="px-3 py-4 text-[13px] text-mute">{all.length ? 'No player by that name in these moves.' : 'No players in these moves yet.'}</li>
            )}
            {results.map(({ person, count }) => (
              <li key={person.person_key}>
                <Link
                  href={hrefFor(person.person_key)}
                  scroll={false}
                  onClick={() => setOpen(false)}
                  className="row-hover flex items-center gap-3 rounded-[12px] px-2.5 py-2 text-[14px] text-text outline-none focus-visible:bg-white/[0.06]"
                >
                  <PlayerAvatar name={person.name} size={26} />
                  <span className="min-w-0 flex-1 truncate">{person.name}</span>
                  <span className="font-mono text-[11px] text-dim">
                    {count} move{count === 1 ? '' : 's'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
