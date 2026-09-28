import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import type { PlayerDetailPayload } from '@/src/lib/ui/types'

type Splits = NonNullable<PlayerDetailPayload['splits']>
type Split = Splits['home']

function Row({ label, split, max, lead }: { label: string; split: Split; max: number; lead: boolean }) {
  return (
    <div className="grid grid-cols-[60px_minmax(0,1fr)_44px_60px] items-center gap-3 tabular-nums">
      <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-dim">{label}</span>
      <span className="h-2 overflow-hidden rounded-full bg-white/[0.05]">
        <span
          className={`block h-full rounded-full ${lead ? 'bg-pacific' : 'bg-pacific/40'}`}
          style={{ width: `${((split.pts_avg ?? 0) / max) * 100}%` }}
        />
      </span>
      <span className={`text-right text-[15px] ${lead ? 'font-semibold text-text' : 'text-mute'}`}>
        {split.pts_avg == null ? '—' : split.pts_avg.toFixed(1)}
      </span>
      <span className="text-right font-mono text-[11px] text-dim">{split.ts_pct == null ? '' : `${(split.ts_pct * 100).toFixed(1)} TS`}</span>
    </div>
  )
}

function Pair({ title, a, b, aLabel, bLabel }: { title: string; a: Split; b: Split; aLabel: string; bLabel: string }) {
  const max = Math.max(a.pts_avg ?? 0, b.pts_avg ?? 0, 1)
  const aLead = (a.pts_avg ?? 0) >= (b.pts_avg ?? 0)
  return (
    <div className="grid gap-3">
      <div className="text-[13px] text-mute">{title}</div>
      <Row label={aLabel} split={a} max={max} lead={aLead} />
      <Row label={bLabel} split={b} max={max} lead={!aLead} />
    </div>
  )
}

/** Points per game split by venue and by result. */
export function SplitsPanel({ splits }: { splits: Splits }) {
  return (
    <Panel className="p-5 sm:p-6">
      <Eyebrow as="h2" aside="points per game">
        Splits
      </Eyebrow>
      <div className="grid gap-7">
        <Pair title="Venue" a={splits.home} b={splits.away} aLabel="Home" bLabel="Away" />
        <Pair title="Result" a={splits.wins} b={splits.losses} aLabel="Wins" bLabel="Losses" />
      </div>
    </Panel>
  )
}
