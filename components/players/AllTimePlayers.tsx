'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Panel } from '@/components/ui/panel'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { Segmented } from '@/components/ui/segmented'
import { TableScroll, Th, Td, Tr, RowLink } from '@/components/ui/data-table'
import type { AllTimePlayer } from '@/src/lib/data/players-all-time'

type Sort = 'points' | 'games' | 'ppg' | 'seasons'

const SORTS: Array<{ value: Sort; label: string }> = [
  { value: 'points', label: 'Points' },
  { value: 'games', label: 'Games' },
  { value: 'ppg', label: 'PPG' },
  { value: 'seasons', label: 'Seasons' },
]

/** Era chips: season start years, inclusive. */
const ERAS: Array<{ key: string; label: string; from: number; to: number }> = [
  { key: 'all', label: 'All eras', from: 0, to: 9999 },
  { key: '2020s', label: '2020s', from: 2020, to: 2029 },
  { key: '2010s', label: '2010s', from: 2010, to: 2019 },
  { key: '2000s', label: '2000s', from: 2000, to: 2009 },
  { key: '1990s', label: '1990s', from: 1990, to: 1999 },
  { key: '1980s', label: '1980s', from: 1980, to: 1989 },
  { key: 'sd', label: 'San Diego', from: 1978, to: 1983 },
  { key: 'buf', label: 'Buffalo', from: 1970, to: 1977 },
]

/** PPG ranks only count players with a real sample. */
const PPG_MIN_GAMES = 100
const LEADERS = 8

export function yearsLabel(first: number, last: number): string {
  return `${first}–${String(last + 1).slice(2)}`
}

const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1))

function sortPlayers(players: AllTimePlayer[], sort: Sort): AllTimePlayer[] {
  const list = sort === 'ppg' ? players.filter((p) => p.games >= PPG_MIN_GAMES) : [...players]
  const key: Record<Sort, (p: AllTimePlayer) => number> = {
    points: (p) => p.pts_total,
    games: (p) => p.games,
    ppg: (p) => p.pts_avg ?? 0,
    seasons: (p) => p.seasons * 10_000 + p.games,
  }
  return list.sort((a, b) => key[sort](b) - key[sort](a) || a.display_name.localeCompare(b.display_name))
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Everyone who has played for the franchise: leaders as headshot cards, then
 * the full list. Sorting, eras and search all run in the browser (~500 rows).
 */
export function AllTimePlayers({ players }: { players: AllTimePlayer[] }) {
  const [sort, setSort] = React.useState<Sort>('points')
  const [era, setEra] = React.useState('all')
  const [query, setQuery] = React.useState('')

  const eraRange = ERAS.find((e) => e.key === era) ?? ERAS[0]
  const q = fold(query.trim())
  const filtered = sortPlayers(
    players.filter((p) => p.first_season <= eraRange.to && p.last_season >= eraRange.from && (!q || fold(p.display_name).includes(q))),
    sort,
  )
  const leaders = q ? [] : filtered.slice(0, LEADERS)
  const sortLabel = SORTS.find((s) => s.value === sort)?.label.toLowerCase()

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <div className="flex flex-wrap items-center gap-2.5">
        <Segmented ariaLabel="Sort by" size="sm" value={sort} options={SORTS} onChange={setSort} />
        <label className="glass-track flex min-w-0 flex-[1_1_220px] items-center gap-2.5 rounded-full px-4 py-2 sm:max-w-[320px]">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden className="shrink-0 text-dim">
            <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
            <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <span className="sr-only">Search players</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`Search ${players.length} players`}
            className="min-w-0 flex-1 bg-transparent text-[16px] text-text outline-none placeholder:text-dim md:text-[14px]"
          />
        </label>
      </div>

      <div role="group" aria-label="Era" className="-mt-2 flex flex-wrap gap-1.5">
        {ERAS.map((e) => (
          <button
            key={e.key}
            type="button"
            aria-pressed={era === e.key}
            onClick={() => setEra(e.key)}
            className={cn(
              'press rounded-full border px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors duration-300',
              era === e.key ? 'border-pacific/45 bg-pacific/[0.16] text-[#9cc7f2]' : 'border-line-2 bg-white/[0.02] text-mute hover:text-text',
            )}
          >
            {e.label}
          </button>
        ))}
      </div>

      {leaders.length > 0 && (
        <section aria-label="Franchise leaders">
          <Eyebrow aside={`by ${sortLabel}${sort === 'ppg' ? ` · ${PPG_MIN_GAMES}+ games` : ''}`}>Franchise leaders</Eyebrow>
          <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-3 lg:grid-cols-4 lg:gap-3">
            {leaders.map((p, i) => (
              <li key={p.player_id}>
                <Link
                  href={`/players/${p.player_id}`}
                  prefetch={false}
                  className="panel group block overflow-hidden transition-colors duration-300 hover:border-line-2"
                >
                  <div className="relative">
                    <PlayerAvatar name={p.display_name} nbaPlayerId={p.nba_person_id} clippersSeason={p.last_season} variant="card" className="border-b border-line" />
                    <span className="absolute left-3 top-2.5 font-mono text-[11px] tracking-[0.1em] text-white/70">#{i + 1}</span>
                  </div>
                  <div className="grid gap-1 p-3.5">
                    <div className="truncate text-[15px] font-medium tracking-[-0.01em] group-hover:text-white">{p.display_name}</div>
                    <div className="truncate font-mono text-[11px] text-dim">
                      {yearsLabel(p.first_season, p.last_season)} · {p.games} games
                    </div>
                    <div className="mt-1 flex gap-3.5 text-[12.5px] text-mute tabular-nums">
                      <span>
                        <b className="text-[15px] font-semibold text-text">{fmt(p.pts_avg)}</b> PPG
                      </span>
                      <span>
                        <b className="text-[15px] font-semibold text-text">{p.pts_total.toLocaleString()}</b> PTS
                      </span>
                    </div>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="All players">
        <Eyebrow aside={filtered.length.toLocaleString()}>{q ? 'Results' : 'Everyone'}</Eyebrow>
        {filtered.length === 0 ? (
          <Panel className="px-6 py-10 text-center text-[14px] text-mute">No one matches “{query}”.</Panel>
        ) : (
          <Panel className="overflow-hidden">
            <TableScroll minWidth={560}>
              <thead>
                <tr>
                  <Th align="left" className="w-[52px]">
                    #
                  </Th>
                  <Th align="left" sticky>
                    Player
                  </Th>
                  <Th>GP</Th>
                  <Th>PPG</Th>
                  <Th>RPG</Th>
                  <Th>APG</Th>
                  <Th>PTS</Th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p, i) => (
                  <Tr key={p.player_id} href={`/players/${p.player_id}`}>
                    <Td align="left" muted className="font-mono text-[12px]">
                      {i + 1}
                    </Td>
                    <Td align="left" sticky>
                      <RowLink href={`/players/${p.player_id}`} className="flex items-center gap-3">
                        <PlayerAvatar name={p.display_name} nbaPlayerId={p.nba_person_id} clippersSeason={p.last_season} size={30} />
                        <span className="min-w-0">
                          <span className="block truncate text-text">{p.display_name}</span>
                          <span className="block font-mono text-[11px] text-dim">{yearsLabel(p.first_season, p.last_season)}</span>
                        </span>
                      </RowLink>
                    </Td>
                    <Td>{p.games}</Td>
                    <Td strong>{fmt(p.pts_avg)}</Td>
                    <Td>{fmt(p.reb_avg)}</Td>
                    <Td>{fmt(p.ast_avg)}</Td>
                    <Td muted>{p.pts_total.toLocaleString()}</Td>
                  </Tr>
                ))}
              </tbody>
            </TableScroll>
          </Panel>
        )}
      </section>
    </div>
  )
}
