import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { periodName } from '@/src/lib/live/win-prob'
import type { GameStoryPayload, StoryPeriodLine } from '@/src/lib/ui/types'

const frac = (m: number, a: number) => `${m}-${a}`

export function QuarterTable({ quarters, oppAbbr }: { quarters: NonNullable<GameStoryPayload['quarters']>; oppAbbr: string }) {
  const cell = (l: StoryPeriodLine) => (
    <>
      <td className="py-2 text-right font-semibold">{l.pts}</td>
      <td className="py-2 text-right text-mute">{frac(l.fgm, l.fga)}</td>
      <td className="py-2 text-right text-mute">{frac(l.fg3m, l.fg3a)}</td>
      <td className="py-2 text-right text-mute">{frac(l.ftm, l.fta)}</td>
    </>
  )
  return (
    <Panel className="h-full overflow-x-auto p-5">
      <Eyebrow>Quarter by quarter</Eyebrow>
      <table className="w-full min-w-[640px] border-collapse text-[13px] tabular-nums">
        <thead>
          <tr className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim">
            <th className="pb-2 text-left font-normal" />
            <th className="pb-2 text-right font-normal">LAC</th>
            <th className="pb-2 text-right font-normal">FG</th>
            <th className="pb-2 text-right font-normal">3PT</th>
            <th className="pb-2 text-right font-normal">FT</th>
            <th className="pb-2 text-right font-normal">{oppAbbr}</th>
            <th className="pb-2 text-right font-normal">FG</th>
            <th className="pb-2 text-right font-normal">3PT</th>
            <th className="pb-2 text-right font-normal">FT</th>
            <th className="pb-2 pl-4 text-left font-normal">Top Clipper</th>
          </tr>
        </thead>
        <tbody>
          {quarters.map((q) => (
            <tr key={q.period} className="border-t border-line">
              <td className="py-2 font-mono text-[12px] text-mute">{periodName(q.period)}</td>
              {cell(q.lac)}
              {cell(q.opp)}
              <td className="py-2 pl-4 text-mute">{q.lac_top ? `${q.lac_top.name} ${q.lac_top.pts}` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  )
}
