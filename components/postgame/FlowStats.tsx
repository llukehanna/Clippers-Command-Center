import type { GameStoryPayload } from '@/src/lib/ui/types'

/** The game_flow facts under the chart. */
export function FlowStats({ summary, oppAbbr }: { summary: NonNullable<GameStoryPayload['flow']>['summary']; oppAbbr: string }) {
  const items: Array<[string, string]> = [
    ['Largest lead', summary.largest_lead > 0 ? `LAC +${summary.largest_lead}` : '—'],
    ['Largest deficit', summary.largest_deficit > 0 ? `${oppAbbr} +${summary.largest_deficit}` : '—'],
    ['Lead changes', String(summary.lead_changes)],
    ['Times tied', String(summary.times_tied)],
    ['Best LAC run', `${summary.lac_best_run}-0`],
    [`Best ${oppAbbr} run`, `${summary.opp_best_run}-0`],
  ]
  return (
    <dl className="m-0 mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line pt-4 sm:grid-cols-3 lg:grid-cols-6">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim">{label}</dt>
          <dd className="m-0 mt-1 text-[15px] font-semibold tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
