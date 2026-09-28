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
import type { BoxScorePlayer, BoxScoreTeam, BoxValue } from '@/src/lib/ui/types'

const COLS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', '+/-'] as const
const LEADER_COLS = new Set(['PTS', 'REB', 'AST'])

interface BoxScoreProps {
  teams: BoxScoreTeam[]
  /** Link LAC players to their pages (history ids are internal player ids). */
  linkPlayers?: boolean
  /** Live box scores carry NBA person ids as player_id — enables headshots. */
  playerIdsAreNba?: boolean
  className?: string
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
export function BoxScore({ teams, linkPlayers = true, playerIdsAreNba = false, className }: BoxScoreProps) {
  const ordered = React.useMemo(
    () => [...teams].sort((a, b) => (a.team_abbr === 'LAC' ? -1 : b.team_abbr === 'LAC' ? 1 : 0)),
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
  const isLac = team.team_abbr === 'LAC'

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
                {teamName(t.team_abbr)}
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
                  {linkPlayers && isLac && !playerIdsAreNba ? (
                    <Link href={`/players/${p.player_id}`} className="hover:underline">
                      {name}
                    </Link>
                  ) : (
                    name
                  )}
                </Td>
                {COLS.map((c) =>
                  c === '+/-' ? (
                    <Td key={c}>{plusMinus(p[c])}</Td>
                  ) : (
                    <Td
                      key={c}
                      strong={LEADER_COLS.has(c) && num(p[c]) === leaders[c] && leaders[c] > 0}
                      muted={c === 'MIN'}
                    >
                      {cell(p[c])}
                    </Td>
                  ),
                )}
              </tr>
            )
          })}
          <tr>
            <Td align="left" sticky strong className="border-line-2">
              Team
            </Td>
            {COLS.map((c) => (
              <Td key={c} strong className="border-line-2">
                {c === '+/-' || c === 'MIN' ? '' : cell(team.totals[c], '')}
              </Td>
            ))}
          </tr>
        </tbody>
      </TableScroll>
    </Panel>
  )
}
