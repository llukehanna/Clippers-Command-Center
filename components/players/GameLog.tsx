import { Panel } from '@/components/ui/panel'
import { TeamLogo } from '@/components/ui/team-mark'
import { Chip, ResultBadge } from '@/components/ui/chip'
import { gameTypeLabel } from '@/src/lib/ui/season'
import { TableScroll, Th, Td, Tr, RowLink } from '@/components/ui/data-table'
import { formatDayShort } from '@/src/lib/ui/time'
import type { PlayerGameLogRow } from '@/src/lib/ui/types'

export type GameLogRow = PlayerGameLogRow & { result?: 'W' | 'L' | null; score?: string | null }

const dash = (v: unknown) => (typeof v === 'string' ? v.replace(/^(\d+)-(\d+)$/, '$1–$2') : v == null ? '—' : String(v))

/** Most recent games first; each row opens the game. */
export function GameLog({ rows }: { rows: GameLogRow[] }) {
  const best = Math.max(...rows.map((r) => r.PTS ?? 0))
  return (
    <Panel className="overflow-hidden">
      <TableScroll minWidth={780}>
        <thead>
          <tr>
            <Th align="left" sticky>
              Game
            </Th>
            <Th align="left">Result</Th>
            <Th>Min</Th>
            <Th>Pts</Th>
            <Th>Reb</Th>
            <Th>Ast</Th>
            <Th>FG</Th>
            <Th>3PT</Th>
            <Th>FT</Th>
            <Th>TS%</Th>
            <Th>+/−</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const pm = typeof r['+/-'] === 'number' ? r['+/-'] : null
            return (
              <Tr key={r.game_id} href={`/history/${r.game_id}`}>
                <Td align="left" sticky>
                  <RowLink href={`/history/${r.game_id}`} className="flex items-center gap-2.5">
                    <span className="w-[46px] font-mono text-[11.5px] text-dim">{formatDayShort(r.game_date)}</span>
                    <TeamLogo abbr={r.opp} size="xs" />
                    <span className="text-text">
                      <span className="text-mute">{r.home_away === 'home' ? 'vs' : '@'}</span> {r.opp}
                    </span>
                    {gameTypeLabel(r.game_type) && <Chip tone="blue">{gameTypeLabel(r.game_type)}</Chip>}
                  </RowLink>
                </Td>
                <Td align="left">
                  {r.result ? (
                    <span className="flex items-center gap-2">
                      <ResultBadge result={r.result} />
                      <span className="font-mono text-[11.5px] text-mute">{r.score}</span>
                    </span>
                  ) : (
                    <span className="text-dim">—</span>
                  )}
                </Td>
                <Td muted>{dash(r.MIN)}</Td>
                <Td strong={r.PTS === best && best > 0}>{r.PTS}</Td>
                <Td>{r.REB}</Td>
                <Td>{r.AST}</Td>
                <Td>{dash(r.FG)}</Td>
                <Td>{dash(r['3PT'])}</Td>
                <Td>{dash(r.FT)}</Td>
                <Td muted>{r.ts_pct_computed == null ? '—' : (r.ts_pct_computed * 100).toFixed(1)}</Td>
                <Td>
                  {pm == null ? (
                    <span className="text-dim">—</span>
                  ) : (
                    <span className={pm > 0 ? 'text-pos' : pm < 0 ? 'text-neg' : 'text-mute'}>
                      {pm > 0 ? `+${pm}` : pm < 0 ? `−${Math.abs(pm)}` : '0'}
                    </span>
                  )}
                </Td>
              </Tr>
            )
          })}
        </tbody>
      </TableScroll>
    </Panel>
  )
}
