'use client'

import { cn } from '@/lib/utils'
import { TeamLogo } from '@/components/ui/team-mark'
import { formatClock } from '@/src/lib/live/win-prob'
import type { LineupState, StintPlayer } from '@/src/lib/types/live-state'

const MAX_FOULS = 6

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))
const tone = (n: number) => (n > 0 ? 'text-pos' : n < 0 ? 'text-neg' : 'text-dim')

function FoulPips({ pf, trouble }: { pf: number; trouble: boolean }) {
  return (
    <span className="flex items-center gap-[3px]" aria-label={`${pf} fouls${trouble ? ', in foul trouble' : ''}`} role="img">
      {Array.from({ length: MAX_FOULS }, (_, i) => (
        <i key={i} className={cn('block h-1.5 w-1.5 rounded-full', i < pf ? (trouble ? 'bg-neg' : 'bg-mute') : 'bg-white/[0.08]')} />
      ))}
    </span>
  )
}

function MinutesBar({ p }: { p: StintPlayer }) {
  if (p.usual_min === null) {
    return <span className="justify-self-end font-mono text-[11px] tabular-nums text-dim">{p.min.toFixed(1)} min</span>
  }
  const pct = Math.min(100, (p.min / p.usual_min) * 100)
  const note = p.pace === 'over' ? ' · heavy' : p.pace === 'under' ? ' · light' : ''
  return (
    <span className="grid min-w-[120px] justify-items-end gap-1">
      <span className={cn('font-mono text-[11px] tabular-nums', p.pace ? 'text-warn' : 'text-dim')}>
        {p.min.toFixed(1)} of usual {p.usual_min.toFixed(0)} min{note}
      </span>
      <span className="h-1 w-full overflow-hidden rounded-full bg-white/[0.08]">
        <span className={cn('block h-full rounded-full', p.pace ? 'bg-warn' : 'bg-pacific/70')} style={{ width: `${pct}%` }} />
      </span>
    </span>
  )
}

function OnCourt({ abbr, players }: { abbr: string; players: StintPlayer[] }) {
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute">
        <TeamLogo abbr={abbr} size="xs" />
        {abbr} on the floor
      </div>
      {players.length === 0 ? (
        <p className="m-0 text-[13px] text-dim">Waiting for the box score.</p>
      ) : (
        <ul className="m-0 grid list-none gap-1.5 p-0">
          {players.map((p) => (
            <li key={p.player_id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-[12px] bg-white/[0.03] px-3 py-2">
              <span className="truncate text-[13.5px] font-medium">{p.name}</span>
              <span className="font-mono text-[12px] tabular-nums text-mute" title={`On since ${p.stint_start.clock} of ${p.stint_start.period <= 4 ? `Q${p.stint_start.period}` : 'OT'}`}>
                {formatClock(p.stint_secs)} <span className={tone(p.stint_plus_minus)}>{signed(p.stint_plus_minus)}</span>
              </span>
              <FoulPips pf={p.pf} trouble={p.foul_trouble} />
              <MinutesBar p={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Who's on the floor, for how long, and how it's going (spec §7.2). */
export function Clipboard({ lineups, lacAbbr, oppAbbr }: { lineups: LineupState; lacAbbr: string; oppAbbr: string }) {
  const { timeouts, bonus, current_unit, units_tonight } = lineups
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] tabular-nums text-mute">
        <span>
          Timeouts {lacAbbr} {timeouts.lac ?? '—'} · {oppAbbr} {timeouts.opp ?? '—'}
        </span>
        {bonus.lac && <span className="text-warn">{lacAbbr} in the bonus</span>}
        {bonus.opp && <span className="text-warn">{oppAbbr} in the bonus</span>}
        <span className="sm:ml-auto">
          This {lacAbbr} five: {formatClock(current_unit.secs_together)} together,{' '}
          <span className={tone(current_unit.lac_plus_minus)}>{signed(current_unit.lac_plus_minus)}</span>
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <OnCourt abbr={lacAbbr} players={lineups.on_court.lac} />
        <OnCourt abbr={oppAbbr} players={lineups.on_court.opp} />
      </div>
      {units_tonight.length > 0 && (
        <div>
          <div className="mb-2 font-mono text-[11px] uppercase tracking-[0.1em] text-mute">{lacAbbr} lineups tonight</div>
          <table className="w-full text-[12.5px] tabular-nums">
            <thead className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-dim">
              <tr>
                <th className="pb-1 text-left font-normal">Five</th>
                <th className="pb-1 text-right font-normal">Min</th>
                <th className="pb-1 text-right font-normal">+/-</th>
              </tr>
            </thead>
            <tbody>
              {units_tonight.map((u) => (
                <tr key={u.player_ids.join('-')} className="border-t border-line">
                  <td className="py-1.5 pr-3 text-mute">{u.names.join(' · ')}</td>
                  <td className="py-1.5 text-right font-mono">{formatClock(u.secs)}</td>
                  <td className={cn('py-1.5 text-right font-mono', tone(u.plus_minus))}>{signed(u.plus_minus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
