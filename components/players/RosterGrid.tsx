import Link from 'next/link'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { Chip } from '@/components/ui/chip'
import { Panel } from '@/components/ui/panel'
import { TableScroll, Th, Td, Tr, RowLink } from '@/components/ui/data-table'
import type { RosterPlayer } from '@/src/lib/ui/types'

const POSITION_NAMES: Record<string, string> = { G: 'Guard', F: 'Forward', C: 'Center' }

export function positionLabel(pos: string | null | undefined): string {
  if (!pos) return '—'
  return pos
    .split('-')
    .map((p) => POSITION_NAMES[p] ?? p)
    .join(' / ')
}

/** Headshot cards, 2 → 3 → 4 → 5 across. */
export function RosterCards({ players }: { players: RosterPlayer[] }) {
  return (
    <ul className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-3 lg:grid-cols-4 lg:gap-3 xl:grid-cols-5">
      {players.map((p, i) => (
        <li key={p.player_id} className="enter" style={{ ['--i' as string]: Math.min(i, 12) }}>
          <Link href={`/players/${p.player_id}`} prefetch={false} className="panel group block overflow-hidden transition-colors duration-300 hover:border-line-2">
            <PlayerAvatar name={p.display_name} nbaPlayerId={p.nba_person_id} variant="card" className="border-b border-line" />
            <div className="flex items-start justify-between gap-2 p-3.5">
              <div className="min-w-0">
                <div className="truncate text-[14.5px] font-medium tracking-[-0.01em] group-hover:text-white">{p.display_name}</div>
                <div className="truncate font-mono text-[11px] text-dim">
                  {p.jersey ? `#${p.jersey} · ` : ''}
                  {positionLabel(p.position)}
                </div>
              </div>
              {p.is_traded && <Chip>Traded</Chip>}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  )
}

/** Compact table view of the same roster. */
export function RosterTable({ players }: { players: RosterPlayer[] }) {
  return (
    <Panel className="overflow-hidden">
      <TableScroll minWidth={420}>
        <thead>
          <tr>
            <Th align="left">Player</Th>
            <Th align="left">Position</Th>
            <Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <Tr key={p.player_id} href={`/players/${p.player_id}`}>
              <Td align="left">
                <RowLink href={`/players/${p.player_id}`} className="flex items-center gap-3">
                  <PlayerAvatar name={p.display_name} nbaPlayerId={p.nba_person_id} size={30} />
                  <span className="font-medium text-text">{p.display_name}</span>
                </RowLink>
              </Td>
              <Td align="left" muted>
                {positionLabel(p.position)}
              </Td>
              <Td>{p.is_traded ? <Chip>Traded</Chip> : <span className="font-mono text-[11.5px] text-dim">Active</span>}</Td>
            </Tr>
          ))}
        </tbody>
      </TableScroll>
    </Panel>
  )
}
