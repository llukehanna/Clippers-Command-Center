import { SeasonAverages } from '@/src/lib/player-utils'

interface Player {
  display_name: string
  position: string | null
}

interface PlayerHeaderProps {
  player: Player
  season_averages: SeasonAverages | null
}

function fmt(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : v.toFixed(1)
}

export function PlayerHeader({ player, season_averages }: PlayerHeaderProps) {
  return (
    <div className="flex items-start justify-between py-4 border-b border-white/[0.06]">
      <div>
        <h1 className="text-2xl font-semibold text-foreground">{player.display_name}</h1>
        <p className="text-sm text-muted-foreground">{player.position ?? 'Guard'}</p>
      </div>
      <div className="flex gap-6">
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">PPG</p>
          <p className="text-xl font-semibold tabular-nums text-foreground">
            {fmt(season_averages?.pts_avg)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">RPG</p>
          <p className="text-xl font-semibold tabular-nums text-foreground">
            {fmt(season_averages?.reb_avg)}
          </p>
        </div>
        <div className="text-center">
          <p className="text-xs text-muted-foreground uppercase tracking-wide">APG</p>
          <p className="text-xl font-semibold tabular-nums text-foreground">
            {fmt(season_averages?.ast_avg)}
          </p>
        </div>
      </div>
    </div>
  )
}
