'use client'

import * as React from 'react'
import { Command } from 'cmdk'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { TeamLogo } from '@/components/ui/team-mark'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { playedGames, type HistoryGame } from '@/src/lib/ui/season'
import { formatDayShort } from '@/src/lib/ui/time'
import { moveDate } from '@/src/lib/franchise/display'
import type { MovesPayload, PlayersPayload } from '@/src/lib/ui/types'

export const OPEN_PALETTE_EVENT = 'ccc:open-palette'

/** Trades listed before anything is typed; typing searches every trade. */
const RECENT_TRADES = 5

const PAGES = [
  { href: '/home', label: 'Home', hint: 'Next game, form, trends' },
  { href: '/live', label: 'Live', hint: 'Scoreboard and box score' },
  { href: '/players', label: 'Players', hint: 'Roster' },
  { href: '/schedule', label: 'Schedule', hint: 'Upcoming games' },
  { href: '/history', label: 'History', hint: 'Past seasons' },
  { href: '/franchise', label: 'Franchise', hint: 'Draft, trades, contracts' },
  { href: '/news', label: 'News', hint: 'Articles and social' },
]

const json = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return r.json()
  })

interface SeasonGames {
  label: string
  games: ReturnType<typeof playedGames>
}

async function loadRecentGames(): Promise<SeasonGames[]> {
  const { seasons } = (await json('/api/history/seasons')) as { seasons: Array<{ season_id: number; label: string }> }
  const recent = [...seasons].sort((a, b) => b.season_id - a.season_id).slice(0, 2)
  const lists = await Promise.all(
    recent.map(async (s) => {
      const { games } = (await json(`/api/history/games?season_id=${s.season_id}&limit=200`)) as { games: HistoryGame[] }
      return { label: s.label, games: playedGames(games).reverse() }
    }),
  )
  return lists
}

/** ⌘K / Ctrl+K palette: jump to any page, player, trade (by player name), or recent game. */
export function CommandPalette() {
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState('')
  const router = useRouter()

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setSearch('') // each open starts with an empty search
        setOpen((o) => !o)
      }
    }
    const onOpen = () => {
      setSearch('')
      setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener(OPEN_PALETTE_EVENT, onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener(OPEN_PALETTE_EVENT, onOpen)
    }
  }, [])

  // Load lazily on first open; SWR keeps it cached afterwards.
  const { data: roster } = useSWR<PlayersPayload>(open ? '/api/players' : null, json, { revalidateOnFocus: false })
  const { data: seasons } = useSWR<SeasonGames[]>(open ? 'palette:games' : null, loadRecentGames, { revalidateOnFocus: false })
  const { data: trades } = useSWR<MovesPayload>(open ? '/api/franchise/moves?type=trade' : null, json, { revalidateOnFocus: false })

  const typed = search.trim() !== ''

  const go = (href: string) => {
    setOpen(false)
    router.push(href)
  }

  const item =
    'flex cursor-pointer items-center gap-3 rounded-[12px] px-3 py-3 text-[15px] md:py-2.5 md:text-[14px] text-mute outline-none data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-text'
  const group =
    '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1.5 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:font-mono [&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-[0.12em] [&_[cmdk-group-heading]]:text-dim'

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Search"
      overlayClassName="fixed inset-0 z-50 bg-[rgba(3,6,12,0.45)] backdrop-blur-[6px] data-[state=open]:animate-in data-[state=open]:fade-in-0"
      contentClassName="fixed left-1/2 top-[calc(env(safe-area-inset-top,0px)+10px)] z-50 w-[min(640px,calc(100vw-20px))] md:top-[12vh] -translate-x-1/2 overflow-hidden glass-bar rounded-[26px] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.9)] data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-[0.98]"
    >
      <div className="flex items-center gap-3 border-b border-line px-4">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden className="text-dim">
          <circle cx="7" cy="7" r="4.75" stroke="currentColor" strokeWidth="1.5" />
          <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <Command.Input
          autoFocus
          value={search}
          onValueChange={setSearch}
          placeholder="Search players, games, trades…"
          className="h-14 min-w-0 flex-1 bg-transparent text-[16px] text-text md:text-[15px] outline-none placeholder:text-dim"
        />
        <kbd className="hidden rounded-md border border-line-2 bg-ink-2 px-1.5 py-0.5 font-mono text-[10.5px] text-dim md:inline">esc</kbd>
        <button type="button" onClick={() => setOpen(false)} className="press -mr-1 h-10 px-2 text-[15px] text-pacific md:hidden">
          Cancel
        </button>
      </div>
      <Command.List className="max-h-[min(60dvh,480px)] overflow-y-auto overscroll-contain p-2">
        <Command.Empty className="px-3 py-8 text-center text-[14px] text-mute">No matches.</Command.Empty>

        <Command.Group heading="Pages" className={group}>
          {PAGES.map((p) => (
            <Command.Item key={p.href} value={`page ${p.label}`} onSelect={() => go(p.href)} className={item}>
              <span className="text-text">{p.label}</span>
              <span className="ml-auto text-[12.5px] text-dim">{p.hint}</span>
            </Command.Item>
          ))}
        </Command.Group>

        {roster && roster.players.length > 0 && (
          <Command.Group heading="Players" className={group}>
            {roster.players.map((p) => (
              <Command.Item
                key={p.player_id}
                value={`player ${p.display_name} ${p.player_id}`}
                keywords={[p.position ?? '']}
                onSelect={() => go(`/players/${p.player_id}`)}
                className={item}
              >
                <PlayerAvatar name={p.display_name} nbaPlayerId={p.nba_person_id} size={26} />
                <span className="text-text">{p.display_name}</span>
                <span className="ml-auto font-mono text-[11px] text-dim">{p.position}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {trades && (trades.moves.length > 0 || typed) && (
          <Command.Group heading="Trades" className={group}>
            {trades.moves.length === 0 ? (
              // The archive is empty until the import runs; say so once someone searches.
              <Command.Item forceMount value="no trades recorded yet" onSelect={() => go('/franchise')} className={item}>
                <span className="text-text">No trades recorded yet</span>
                <span className="ml-auto text-[12.5px] text-dim">The franchise history import hasn&apos;t run</span>
              </Command.Item>
            ) : (
              // Empty query: the most recent few. Typing searches them all, by player name or team.
              (typed ? trades.moves : trades.moves.slice(0, RECENT_TRADES)).map((m) => {
                const other = m.teams.find((t) => !t.is_clippers)
                const names = m.people.map((p) => p.name)
                return (
                  <Command.Item
                    key={m.slug}
                    value={`${names.join(' ')} ${m.date ?? ''} ${m.slug}`}
                    keywords={[other?.city ?? '', other?.name ?? '', other?.abbreviation ?? '']}
                    onSelect={() => go(m.href ?? '/franchise')}
                    className={item}
                  >
                    <TeamLogo abbr={other?.abbreviation} size="xs" />
                    <span className="min-w-0 truncate text-text">{names.slice(0, 3).join(', ') || m.description}</span>
                    <span className="ml-auto shrink-0 font-mono text-[11.5px] text-dim">{moveDate(m.date)}</span>
                  </Command.Item>
                )
              })
            )}
          </Command.Group>
        )}

        {seasons?.map((s) =>
          s.games.length > 0 ? (
            <Command.Group key={s.label} heading={`Games · ${s.label}`} className={group}>
              {s.games.map((g) => (
                <Command.Item
                  key={g.game_id}
                  value={`game ${g.opponent_abbr} ${g.game_date} ${formatDayShort(g.game_date)} ${s.label} ${g.game_id}`}
                  onSelect={() => go(`/history/${g.game_id}`)}
                  className={item}
                >
                  <TeamLogo abbr={g.opponent_abbr} size="xs" />
                  <span className="text-text">
                    {g.home_away === 'home' ? 'vs' : '@'} {g.opponent_abbr}
                  </span>
                  <span className="font-mono text-[11.5px] text-dim">{formatDayShort(g.game_date)}</span>
                  <span className={`ml-auto font-mono text-[12px] tabular-nums ${g.result === 'W' ? 'text-pos' : 'text-neg'}`}>
                    {g.result} {g.final_score.team}–{g.final_score.opp}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null,
        )}
      </Command.List>
    </Command.Dialog>
  )
}
