import { Panel } from '@/components/ui/panel'
import { Eyebrow } from '@/components/ui/eyebrow'
import { formatSpread } from '@/src/lib/ui/odds'
import { TimeAgo } from '@/components/ui/clock'
import { sparklinePath } from '@/src/lib/game-preview-utils'
import type { GamePreviewPayload } from '@/src/lib/ui/types'

const W = 240
const H = 44

/** Spread movement across every stored snapshot, and the model's pregame view. */
export function LineCard({ line }: { line: NonNullable<GamePreviewPayload['line']> }) {
  const values = line.movement.map((p) => p.spread)
  const path = sparklinePath(values, W, H, 4)
  return (
    <Panel className="h-full p-5">
      <Eyebrow aside={line.current ? <TimeAgo at={line.current.captured_at} prefix="updated " suffix=" ago" /> : undefined}>The line</Eyebrow>
      {line.current ? (
        <div>
          <div className="text-[26px] font-semibold tracking-[-0.03em] tabular-nums">LAC {formatSpread(line.current.spread)}</div>
          {path && (
            <figure className="m-0 mt-3">
              <svg viewBox={`0 0 ${W} ${H}`} className="h-[44px] w-full" role="img" aria-label={`Spread moved from ${formatSpread(values[0])} to ${formatSpread(values.at(-1))}`}>
                <path d={path} fill="none" stroke="var(--pacific)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              </svg>
              <figcaption className="mt-1 font-mono text-[11.5px] text-dim tabular-nums">
                Opened {formatSpread(values[0])} · now {formatSpread(values.at(-1))} · {values.length} snapshots
              </figcaption>
            </figure>
          )}
        </div>
      ) : (
        <p className="m-0 text-[13.5px] text-mute">Lines not posted yet.</p>
      )}
      <div className="mt-4 flex items-baseline justify-between gap-3 border-t border-line pt-4">
        <span className="text-[13.5px] text-mute">Model: Clippers win</span>
        <span className="text-[22px] font-semibold tracking-[-0.02em] tabular-nums">{Math.round(line.win_prob.lac * 100)}%</span>
      </div>
      <p className="m-0 mt-1 font-mono text-[11px] text-dim">{line.win_prob.source === 'spread' ? 'from the spread' : 'home-court estimate'}</p>
    </Panel>
  )
}
