import Link from 'next/link'
import { Panel } from '@/components/ui/panel'
import { fmtShort } from '@/src/lib/insights/time'
import type { PlayerDetailPayload } from '@/src/lib/ui/types'

type High = PlayerDetailPayload['season_highs'][number]

/** A player's best regular-season games, one tile per stat (insights.css .highs). Each tile opens its game. */
export function SeasonHighs({ highs }: { highs: High[]; seasonLabel?: string }) {
  if (highs.length === 0) return null
  return (
    <Panel className="grid grid-cols-2 gap-2.5 p-4 sm:grid-cols-4">
      {highs.map((h) => (
        <Link
          key={h.stat}
          href={`/history/${h.game_id}`}
          className="block rounded-[14px] bg-[rgba(255,255,255,0.03)] p-3 shadow-[inset_0_0_0_1px_var(--line)] transition-colors duration-300 hover:bg-[rgba(255,255,255,0.06)]"
        >
          <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-dim">{h.label}</div>
          <div className="mt-1.5 text-[24px] font-semibold leading-none tracking-[-0.03em]">{h.value}</div>
          <div className="mt-1.5 font-mono text-[10.5px] text-mute">
            {h.home ? 'vs' : 'at'} {h.opp} · {fmtShort(h.game_date.slice(0, 10))}
          </div>
        </Link>
      ))}
    </Panel>
  )
}
