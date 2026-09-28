import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { Stat } from '@/components/ui/stat'
import { formatSigned } from '@/src/lib/ui/odds'

interface Split {
  w: number
  l: number
}

interface SeasonPanelProps {
  title: string
  seasonLabel: string
  record: { wins: number; losses: number }
  last10?: { wins: number; losses: number } | null
  last10Margin?: number | null
  splits?: { home: Split; away: Split } | null
  ratings: { net: number | null; off: number | null; def: number | null }
}

function SplitBar({ label, split }: { label: string; split: Split }) {
  const games = split.w + split.l
  const pct = games ? split.w / games : 0
  return (
    <div className="grid grid-cols-[auto_1fr] items-baseline gap-x-2.5 gap-y-1.5">
      <span className="label-mono">{label}</span>
      <span className="justify-self-end text-[18px] font-semibold tracking-[-0.02em] tabular-nums">
        {split.w}–{split.l}
      </span>
      <span
        aria-hidden
        className="col-span-2 h-1 rounded-full"
        style={{ background: `linear-gradient(90deg, var(--pacific) ${pct * 100}%, var(--line) ${pct * 100}%)` }}
      />
    </div>
  )
}

/** Record, recent form, home/away split and team ratings. */
export function SeasonPanel({ title, seasonLabel, record, last10, last10Margin, splits, ratings }: SeasonPanelProps) {
  const fmt = (v: number | null) => (v == null ? '—' : v.toFixed(1))
  return (
    <Panel className="flex h-full flex-col gap-5 p-5 sm:p-6">
      <div>
        <Eyebrow>{title}</Eyebrow>
        <div className="flex items-baseline gap-3">
          <span className="text-[48px] font-semibold leading-none tracking-[-0.05em] tabular-nums sm:text-[56px]">
            {record.wins}–{record.losses}
          </span>
          <span className="font-mono text-[12px] text-mute">{seasonLabel}</span>
        </div>
        {last10 && (
          <p className="m-0 mt-2 text-[13.5px] text-mute">
            Last 10: <span className="text-text">{last10.wins}–{last10.losses}</span>
            {last10Margin != null && (
              <>
                {' '}
                · avg margin <span className="text-text">{formatSigned(last10Margin, 1)}</span>
              </>
            )}
          </p>
        )}
      </div>

      {splits && (
        <div className="grid grid-cols-2 gap-5">
          <SplitBar label="Home" split={splits.home} />
          <SplitBar label="Away" split={splits.away} />
        </div>
      )}

      <div className="mt-auto grid grid-cols-3 gap-2.5">
        <div className="panel-inset p-3">
          <Stat
            label="Net rtg"
            value={ratings.net == null ? '—' : formatSigned(ratings.net, 1)}
            valueTone={ratings.net == null ? 'default' : ratings.net >= 0 ? 'pos' : 'neg'}
            sub="per 100"
            size="sm"
          />
        </div>
        <div className="panel-inset p-3">
          <Stat label="Off rtg" value={fmt(ratings.off)} sub="pts / 100" size="sm" />
        </div>
        <div className="panel-inset p-3">
          <Stat label="Def rtg" value={fmt(ratings.def)} sub="opp / 100" size="sm" />
        </div>
      </div>
    </Panel>
  )
}
