'use client'

import * as React from 'react'
import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { SCALE, ZONE_LABEL, toCourt, zoneSummary, type Shot } from '@/src/lib/shots'

const COURT_W = 50 * SCALE
const COURT_H = 47 * SCALE

/** Half court, baseline at the top, 10 units per foot. */
function Court() {
  const line = { fill: 'none', stroke: 'var(--line-2)', strokeWidth: 2 } as const
  return (
    <g>
      <rect x={0} y={0} width={COURT_W} height={COURT_H} {...line} />
      <rect x={170} y={0} width={160} height={190} {...line} />
      <circle cx={250} cy={190} r={60} {...line} />
      <line x1={220} y1={40} x2={280} y2={40} {...line} />
      <circle cx={250} cy={52.5} r={7.5} {...line} />
      <path d="M 210 52.5 A 40 40 0 0 0 290 52.5" {...line} />
      <path d="M 30 0 L 30 140 A 237.5 237.5 0 0 0 470 140 L 470 0" {...line} />
      <path d="M 190 470 A 60 60 0 0 1 310 470" {...line} />
    </g>
  )
}

export function ShotChart({ shots, located, total }: { shots: Shot[]; located: number; total: number }) {
  const players = React.useMemo(() => {
    const counts = new Map<string, { name: string; n: number }>()
    for (const s of shots) counts.set(s.player_id, { name: s.player, n: (counts.get(s.player_id)?.n ?? 0) + 1 })
    return [...counts.entries()].sort((a, b) => b[1].n - a[1].n)
  }, [shots])
  const [player, setPlayer] = React.useState<string>('all')
  const shown = player === 'all' ? shots : shots.filter((s) => s.player_id === player)
  const zones = zoneSummary(shown)
  const onCourt = shown.filter((s) => s.y + 5.25 <= 47)

  return (
    <Panel className="h-full p-5">
      <Eyebrow aside={`${located} of ${total} shots located · via ESPN`}>Shot chart</Eyebrow>
      <label className="mb-3 flex items-center gap-2 text-[13px] text-mute">
        Player
        <select
          value={player}
          onChange={(e) => setPlayer(e.target.value)}
          className="rounded-[8px] border border-line bg-ink-1 px-2 py-1 text-[13px] text-text"
        >
          <option value="all">All Clippers</option>
          {players.map(([id, p]) => (
            <option key={id} value={id}>
              {p.name} ({p.n})
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <svg viewBox={`0 0 ${COURT_W} ${COURT_H}`} className="w-full" role="img" aria-label={`Shot chart: ${shown.filter((s) => s.made).length} of ${shown.length} made`}>
          <Court />
          {onCourt.map((s, i) => {
            const { cx, cy } = toCourt(s.x, s.y)
            return s.made ? (
              <circle key={i} cx={cx} cy={cy} r={7} fill="var(--pacific)" fillOpacity={0.85} />
            ) : (
              <circle key={i} cx={cx} cy={cy} r={6} fill="none" stroke="var(--neg)" strokeWidth={2} strokeOpacity={0.8} />
            )
          })}
        </svg>
        <table className="w-full self-start border-collapse text-[13px] tabular-nums">
          <tbody>
            {zones.map((z) => (
              <tr key={z.zone} className="border-t border-line first:border-t-0">
                <td className="py-2 text-mute">{ZONE_LABEL[z.zone]}</td>
                <td className="py-2 text-right">{z.made}-{z.att}</td>
                <td className="py-2 text-right text-mute">{z.att ? `${Math.round((z.made / z.att) * 100)}%` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
