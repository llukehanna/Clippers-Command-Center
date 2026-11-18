import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import type { GameStoryPayload, StoryClutchLine } from '@/src/lib/ui/types'

const line = (l: StoryClutchLine) => `${l.pts} pts · ${l.fgm}-${l.fga} FG`

export function ClutchCard({ clutch, oppAbbr }: { clutch: NonNullable<GameStoryPayload['clutch']>; oppAbbr: string }) {
  return (
    <Panel className="h-full p-5">
      <Eyebrow aside="last 5:00, within 5">Clutch</Eyebrow>
      <dl className="m-0 grid grid-cols-2 gap-3">
        <div>
          <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim">LAC</dt>
          <dd className="m-0 mt-1 text-[15px] font-semibold tabular-nums">{line(clutch.lac)}</dd>
        </div>
        <div>
          <dt className="font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim">{oppAbbr}</dt>
          <dd className="m-0 mt-1 text-[15px] font-semibold tabular-nums">{clutch.opp ? line(clutch.opp) : '0 pts · 0-0 FG'}</dd>
        </div>
      </dl>
      {clutch.players.length > 0 && (
        <ul className="m-0 mt-4 grid list-none gap-1.5 border-t border-line p-0 pt-3 text-[13.5px]">
          {clutch.players.map((p) => (
            <li key={p.name} className="flex justify-between gap-3 tabular-nums">
              <span>{p.name}</span>
              <span className="text-mute">{p.pts} pts · {p.fgm}-{p.fga}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
