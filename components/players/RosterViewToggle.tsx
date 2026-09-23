'use client'

import React from 'react'
import Link from 'next/link'

export type Player = {
  player_id: string
  display_name: string
  position: string
  is_active: boolean
  is_traded?: boolean
}

interface RosterViewToggleProps {
  players: Player[]
}

type ViewMode = 'list' | 'cards' | 'grid'

function TradedBadge() {
  return (
    <span className="text-xs text-muted-foreground border border-white/[0.06] rounded px-1.5 py-0.5 shrink-0">
      Traded
    </span>
  )
}

function ListView({ players }: { players: Player[] }) {
  return (
    <div>
      {/* Column headers */}
      <div className="flex items-center gap-4 px-2 pb-1 border-b border-white/[0.06]">
        <span className="text-xs text-muted-foreground uppercase tracking-wide flex-1 min-w-0">Name</span>
        <span className="text-xs text-muted-foreground uppercase tracking-wide w-8 shrink-0">Pos</span>
      </div>
      <div className="divide-y divide-white/[0.06]">
        {players.map((player) => (
          <Link
            key={player.player_id}
            href={`/players/${player.player_id}`}
            className="flex items-center gap-4 py-3 px-2 hover:bg-surface-alt rounded-lg transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <span className="text-foreground font-medium truncate">{player.display_name}</span>
              {player.is_traded && <TradedBadge />}
            </div>
            <span className="text-muted-foreground text-sm w-8 shrink-0">{player.position}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}

function CardsView({ players }: { players: Player[] }) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {players.map((player) => (
        <Link
          key={player.player_id}
          href={`/players/${player.player_id}`}
          className="bg-surface border border-white/[0.06] rounded-xl p-4 hover:bg-surface-alt transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-foreground font-medium truncate">{player.display_name}</span>
            {player.is_traded && <TradedBadge />}
          </div>
          <p className="text-sm text-muted-foreground">{player.position}</p>
        </Link>
      ))}
    </div>
  )
}

function GridView({ players }: { players: Player[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {players.map((player) => (
        <Link
          key={player.player_id}
          href={`/players/${player.player_id}`}
          className="bg-surface border border-white/[0.06] rounded-lg p-3 hover:bg-surface-alt transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-foreground font-medium text-sm truncate">{player.display_name}</span>
            {player.is_traded && <TradedBadge />}
          </div>
          <p className="text-xs text-muted-foreground">{player.position}</p>
        </Link>
      ))}
    </div>
  )
}

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'cards', label: 'Cards' },
  { id: 'grid', label: 'Grid' },
]

export function RosterViewToggle({ players }: RosterViewToggleProps) {
  const [viewMode, setViewMode] = React.useState<ViewMode>('list')

  return (
    <div className="space-y-4">
      {/* Toggle bar */}
      <div className="flex gap-1 border border-white/[0.06] rounded-lg p-1 w-fit">
        {VIEW_MODES.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            aria-pressed={viewMode === id}
            onClick={() => setViewMode(id)}
            className={[
              'px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer',
              viewMode === id
                ? 'bg-surface-alt text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Roster layouts */}
      {viewMode === 'list' && <ListView players={players} />}
      {viewMode === 'cards' && <CardsView players={players} />}
      {viewMode === 'grid' && <GridView players={players} />}
    </div>
  )
}

