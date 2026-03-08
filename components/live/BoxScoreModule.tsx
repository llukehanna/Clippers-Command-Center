'use client'

import { Surface } from '@/components/ui/surface'
import { cn } from '@/lib/utils'
import { BoxScoreTable, BoxScoreColumn, BoxScoreRow } from '@/components/box-score/BoxScoreTable'
import { BoxScoreSkeleton } from '@/components/skeletons/BoxScoreSkeleton'

// Column definition is hardcoded — do not derive from box_score.columns
// This ensures stable column order and widths regardless of API payload ordering
const COLUMNS: BoxScoreColumn[] = [
  { key: 'name',  label: 'Player', numeric: false, width: 'w-36' },
  { key: 'MIN',   label: 'MIN',   numeric: true,  width: 'w-14' },
  { key: 'PTS',   label: 'PTS',   numeric: true,  width: 'w-10' },
  { key: 'REB',   label: 'REB',   numeric: true,  width: 'w-10' },
  { key: 'AST',   label: 'AST',   numeric: true,  width: 'w-10' },
  { key: 'STL',   label: 'STL',   numeric: true,  width: 'w-10' },
  { key: 'BLK',   label: 'BLK',   numeric: true,  width: 'w-10' },
  { key: 'TO',    label: 'TO',    numeric: true,  width: 'w-10' },
  { key: 'FG',    label: 'FG',    numeric: true,  width: 'w-16' },
  { key: '3PT',   label: '3PT',   numeric: true,  width: 'w-16' },
  { key: 'FT',    label: 'FT',    numeric: true,  width: 'w-16' },
  { key: '+/-',   label: '+/-',   numeric: true,  width: 'w-10' },
]

interface BoxScoreModuleProps {
  // When null/undefined: render BoxScoreSkeleton
  boxScore: {
    columns: string[]
    teams: Array<{
      team_abbr: string
      players: Array<{ player_id: string; name: string; [key: string]: string | number | null }>
      totals: { [key: string]: string | number | null }
    }>
  } | null | undefined
  className?: string
}

function buildRows(
  players: Array<{ player_id: string; name: string; [key: string]: string | number | null }>,
  totals: { [key: string]: string | number | null },
  teamAbbr: string
): BoxScoreRow[] {
  const playerRows: BoxScoreRow[] = players.map((p) => ({
    id: p.player_id,
    name: p.name,
    MIN: p.MIN ?? null,
    PTS: p.PTS ?? null,
    REB: p.REB ?? null,
    AST: p.AST ?? null,
    STL: p.STL ?? null,
    BLK: p.BLK ?? null,
    TO: p.TO ?? null,
    FG: p.FG ?? null,
    '3PT': p['3PT'] ?? null,
    FT: p.FT ?? null,
    '+/-': p['+/-'] ?? null,
  }))

  // Totals row appended as last row with team abbreviation prefix for visual distinction
  const totalsRow: BoxScoreRow = {
    id: `totals-${teamAbbr}`,
    name: `${teamAbbr} TOTALS`,
    MIN: totals.MIN ?? null,
    PTS: totals.PTS ?? null,
    REB: totals.REB ?? null,
    AST: totals.AST ?? null,
    STL: totals.STL ?? null,
    BLK: totals.BLK ?? null,
    TO: totals.TO ?? null,
    FG: totals.FG ?? null,
    '3PT': totals['3PT'] ?? null,
    FT: totals.FT ?? null,
    '+/-': totals['+/-'] ?? null,
  }

  return [...playerRows, totalsRow]
}

export function BoxScoreModule({ boxScore, className }: BoxScoreModuleProps) {
  if (!boxScore) {
    return <BoxScoreSkeleton className={className} />
  }

  return (
    <Surface variant="card" className={cn('overflow-hidden p-0', className)}>
      {boxScore.teams.map((team, index) => (
        <div key={team.team_abbr}>
          {/* Divider between teams — BoxScoreTable instances sort independently */}
          {index > 0 && <div className="my-2 h-px border-t border-border-subtle" />}

          {/* Team label row */}
          <div className="ccc-section-title bg-surface-alt px-3 py-2">
            {team.team_abbr}
          </div>

          {/* Box score table with player rows + totals row */}
          <BoxScoreTable
            columns={COLUMNS}
            rows={buildRows(team.players, team.totals, team.team_abbr)}
          />
        </div>
      ))}
    </Surface>
  )
}
