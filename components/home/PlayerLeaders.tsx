import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import type { PlayerTrend } from '@/src/lib/ui/types'

interface Leader extends PlayerTrend {
  position?: string | null
  nba_player_id?: string | null
}

const one = (v: number | null) => (v == null ? '—' : v.toFixed(1))

/** Scoring leaders over the recent window, linking to player pages. */
export function PlayerLeaders({ players }: { players: Leader[] }) {
  const grid = 'grid grid-cols-[22px_minmax(0,1fr)_44px_44px] items-center gap-2.5 sm:grid-cols-[26px_minmax(0,1fr)_56px_56px_56px_56px] sm:gap-3'
  return (
    <Panel className="p-2 tabular-nums">
      <div className={`${grid} px-3 pb-1.5 pt-2.5 sm:px-3.5`}>
        <span />
        <span className="label-mono">Player</span>
        <span className="label-mono text-right">Pts</span>
        <span className="label-mono text-right">Reb</span>
        <span className="label-mono hidden text-right sm:block">Ast</span>
        <span className="label-mono hidden text-right sm:block">Min</span>
      </div>
      <ol className="m-0 list-none p-0">
        {players.map((p, i) => (
          <li key={p.player_id}>
            <Link href={`/players/${p.player_id}`} className={`${grid} row-hover rounded-[14px] px-3 py-2.5 sm:px-3.5`}>
              <span className="font-mono text-[11.5px] text-dim">{String(i + 1).padStart(2, '0')}</span>
              <span className="flex min-w-0 items-center gap-3">
                <PlayerAvatar name={p.name} nbaPlayerId={p.nba_player_id} size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-[14.5px] font-medium">{p.name}</span>
                  <span className="block font-mono text-[11px] text-dim">
                    {[p.position, `${p.window_games} gp`].filter(Boolean).join(' · ')}
                  </span>
                </span>
              </span>
              <span className="text-right text-[14.5px] font-semibold">{one(p.pts_avg)}</span>
              <span className="text-right text-[14.5px]">{one(p.reb_avg)}</span>
              <span className="hidden text-right text-[14.5px] sm:block">{one(p.ast_avg)}</span>
              <span className="hidden text-right text-[14.5px] text-mute sm:block">{one(p.minutes_avg)}</span>
            </Link>
          </li>
        ))}
      </ol>
    </Panel>
  )
}
