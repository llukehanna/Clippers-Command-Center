'use client'

import * as React from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { Segmented } from '@/components/ui/segmented'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { TeamLogo } from '@/components/ui/team-mark'
import { TableScroll, Th, Td } from '@/components/ui/data-table'
import { teamName } from '@/src/lib/ui/teams'
import { playerHref } from '@/src/lib/ui/live'
import type { BoxTags } from '@/src/lib/data/season-highs'
import type { BoxScorePlayer, BoxScoreTeam, BoxValue } from '@/src/lib/ui/types'

const COLS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', '+/-'] as const
const LEADER_COLS = new Set(['PTS', 'REB', 'AST'])

interface BoxScoreProps {
  teams: BoxScoreTeam[]
  /** Link LAC players to their pages (by internal id, or by NBA id via /players/nba on live). */
  linkPlayers?: boolean
  /** Live box scores carry NBA person ids as player_id — enables headshots. */
  playerIdsAreNba?: boolean
  /** Era display names by team_abbr (history); falls back to the current-franchise lookup. */
  names?: Record<string, string>
  /** Season-high and rare marks by player_id → column (history). Absent elsewhere. */
  tags?: BoxTags
  className?: string
}

/** The Clippers side: by identity when the payload says so (history), else the 'LAC' tricode (live). */
const isLacTeam = (t: BoxScoreTeam) => t.is_lac ?? t.team_abbr === 'LAC'

const TAG_COLS = new Set(['PTS', 'REB', 'AST', 'STL', 'BLK', '3PT'])

/** Number pill over a small mono label: blue for rare, grey for a season high. */
function TagPill({ tag, children }: { tag: { tone: 'rare' | 'season_high'; label: string }; children: React.ReactNode }) {
  const rare = tag.tone === 'rare'
  return (
    <span className="inline-flex flex-col items-end gap-[3px]">
      <span
        className={cn(
          'inline-block min-w-[26px] rounded-md px-1.5 py-px text-center',
          rare
            ? 'bg-[rgba(65,143,222,0.2)] text-white shadow-[inset_0_0_0_1px_rgba(65,143,222,0.45)]'
            : 'bg-white/[0.07] text-text shadow-[inset_0_0_0_1px_var(--line-2)]',
        )}
      >
        {children}
      </span>
      <span className={cn('whitespace-nowrap font-mono text-[9px] font-normal tracking-[0.04em]', rare ? 'text-[#9cc7f2]' : 'text-dim')}>
        {tag.label}
      </span>
    </span>
  )
}

const num = (v: BoxValue | boolean | undefined) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : null)

function plusMinus(v: BoxValue | boolean | undefined) {
  const n = num(v)
  if (n == null) return <span className="text-dim">—</span>
  if (n === 0) return <span className="text-mute">0</span>
  return <span className={n > 0 ? 'text-pos' : 'text-neg'}>{n > 0 ? `+${n}` : `−${Math.abs(n)}`}</span>
}

/** Shot fractions read better with an en dash: "10-17" → "10–17". */
function cell(v: BoxValue | boolean | undefined, empty = '—') {
  if (v == null || typeof v === 'boolean') return empty
  return typeof v === 'string' ? v.replace(/^(\d+)-(\d+)$/, '$1–$2') : v
}

function shortName(name: string) {
  const parts = name.split(' ')
  if (parts.length < 2) return name
  return `${parts[0][0]}. ${parts.slice(1).join(' ')}`
}

/** Box score with team tabs; starters first, column leaders in bold, totals row. */
export function BoxScore({ teams, linkPlayers = true, playerIdsAreNba = false, names, tags, className }: BoxScoreProps) {
  const ordered = React.useMemo(
    () => [...teams].sort((a, b) => (isLacTeam(a) ? -1 : isLacTeam(b) ? 1 : 0)),
    [teams],
  )
  const [active, setActive] = React.useState(ordered[0]?.team_abbr ?? '')
  const team = ordered.find((t) => t.team_abbr === active) ?? ordered[0]
  if (!team) return null

  const hasStarters = team.players.some((p) => p.starter)
  const players: BoxScorePlayer[] = hasStarters
    ? [...team.players.filter((p) => p.starter), ...team.players.filter((p) => !p.starter)]
    : team.players
  const leaders = Object.fromEntries(
    [...LEADER_COLS].map((c) => [c, Math.max(...players.map((p) => num(p[c]) ?? -Infinity))]),
  )
  const isLac = isLacTeam(team)
  const tagFor = (p: BoxScorePlayer, c: string) => (TAG_COLS.has(c) ? tags?.[String(p.player_id)]?.[c as keyof BoxTags[string]] : undefined)
  const hasTags = players.some((p) => [...TAG_COLS].some((c) => tagFor(p, c)))

  return (
    <Panel className={cn('overflow-hidden', className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-3 pt-3 sm:px-4">
        <Segmented
          ariaLabel="Team"
          size="sm"
          value={team.team_abbr}
          onChange={setActive}
          options={ordered.map((t) => ({
            value: t.team_abbr,
            label: (
              <span className="flex items-center gap-2">
                <TeamLogo abbr={t.team_abbr} size="xs" />
                {teamName(t.team_abbr, names?.[t.team_abbr])}
              </span>
            ),
          }))}
        />
        {hasStarters && (
          <span className="flex items-center gap-2 font-mono text-[11px] text-dim">
            <span aria-hidden className="h-3 w-[2px] rounded bg-pacific" /> starter
          </span>
        )}
      </div>
      {hasTags && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 px-3 pt-3 font-mono text-[10.5px] text-dim sm:px-4">
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden className="inline-block size-2.5 rounded-[3px] bg-[rgba(65,143,222,0.45)]" />
            Rare: has an insight above
          </span>
          <span className="inline-flex items-center gap-1.5">
            <i aria-hidden className="inline-block size-2.5 rounded-[3px] bg-white/[0.14]" />
            His season high
          </span>
        </div>
      )}
      <TableScroll minWidth={720} className="mt-1">
        <thead>
          <tr>
            <Th align="left" sticky>
              Player
            </Th>
            {COLS.map((c) => (
              <Th key={c}>{c === '+/-' ? '+/−' : c}</Th>
            ))}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => {
            const name = (
              <span className="flex items-center gap-2.5">
                <PlayerAvatar name={p.name} nbaPlayerId={p.nba_person_id ?? (playerIdsAreNba ? p.player_id : null)} size={26} />
                <span className="font-medium text-text">
                  <span className="sm:hidden">{shortName(p.name)}</span>
                  <span className="hidden sm:inline">{p.name}</span>
                </span>
              </span>
            )
            return (
              <tr key={p.player_id} className="hover:[&>td]:bg-[#0f1829]">
                <Td align="left" sticky className={cn(p.starter && 'shadow-[inset_2px_0_0_var(--pacific)]')}>
                  {linkPlayers && isLac && (playerIdsAreNba ? playerHref(p.player_id) : true) ? (
                    <Link href={playerIdsAreNba ? playerHref(p.player_id)! : `/players/${p.player_id}`} className="hover:underline">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </Td>
                {COLS.map((c) => {
                  if (c === '+/-') return <Td key={c}>{plusMinus(p[c])}</Td>
                  const tag = tagFor(p, c)
                  return (
                    <Td
                      key={c}
                      strong={LEADER_COLS.has(c) && num(p[c]) === leaders[c] && leaders[c] > 0}
                      muted={c === 'MIN'}
                      className={tag ? 'align-top' : undefined}
                    >
                      {tag ? <TagPill tag={tag}>{cell(p[c])}</TagPill> : cell(p[c])}
                    </Td>
                  )
                })}
              </tr>
            )
          })}
          <tr>
            <Td align="left" sticky strong className="border-line-2">
              Team
            </Td>
            {COLS.map((c) => (
              <Td key={c} strong className="border-line-2">
                {c === '+/-' || c === 'MIN' ? '' : team.totals[c] === null ? '—' : cell(team.totals[c], '')}
              </Td>
            ))}
          </tr>
        </tbody>
      </TableScroll>
    </Panel>
  )
}
