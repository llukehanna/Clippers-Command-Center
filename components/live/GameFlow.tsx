'use client'

import * as React from 'react'
import {
  Area,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { axisTick } from '@/components/charts/chart-theme'
import { DEFAULT_SIGMA, formatGameTime } from '@/src/lib/live/win-prob'
import {
  flowDomainEnd,
  flowRows,
  flowSummary,
  largestLeadText,
  marginDomain,
  marginText,
  markersOf,
  modelFitNote,
  periodTicks,
  tickLabel,
  type FlowRow,
} from '@/src/lib/live/flow-view'
import type { LiveFlow, LiveWinProb } from '@/src/lib/types/live-state'

const LAC = 'var(--pacific)'
const OPP = 'var(--neg)'

const signed = (n: number) => (n > 0 ? `+${n}` : String(n))

function FlowTooltip({ row, oppAbbr }: { row: FlowRow | undefined; oppAbbr: string }) {
  if (!row) return null
  return (
    <div className="max-w-[260px] rounded-[12px] border border-line-2 bg-ink-2/95 px-3 py-2 shadow-[0_12px_32px_-8px_rgba(0,0,0,0.7)] backdrop-blur">
      <div className="mb-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-dim">{formatGameTime(row.t)}</div>
      <div className="text-[12.5px] font-semibold tabular-nums text-text">
        {marginText(row.m, oppAbbr)} · LAC {row.wp}%
      </div>
      {row.d && <div className="mt-1 text-[12px] text-mute">{row.d}</div>}
    </div>
  )
}

/** "About this model": what the WP line is, how well it's calibrated. A model estimate, labeled as one. */
function ModelNote({ wp }: { wp: LiveWinProb }) {
  const [open, setOpen] = React.useState(false)
  const c = wp.calibration
  const note = modelFitNote(wp)
  return (
    <div className="mt-2 font-mono text-[11px] text-dim">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="underline decoration-dotted underline-offset-2 transition-colors hover:text-mute"
      >
        About this model
      </button>
      {open && (
        <div className="mt-2 grid gap-2 font-sans text-[12.5px] leading-relaxed text-mute">
          <p className="m-0">
            A model estimate, not a betting line. It treats the rest of the game as the current margin plus the pregame
            expectation for the time left, with spread σ = {wp.sigma}. Pregame expectation: LAC {signed(wp.expected_margin)} (
            {wp.expected_source === 'spread' ? 'closing spread' : 'home-court default'}).
          </p>
          {note.kind === 'default_until_spread_fit' && c && (
            <p className="m-0">
              Games with a closing spread use the default σ {DEFAULT_SIGMA} until about 50 of them have been fitted. The σ fitted
              on past games without a stored spread ({c.sigma}) doesn&apos;t apply here: it absorbs the team-strength gap the spread
              already accounts for.
            </p>
          )}
          {note.kind === 'fit' && c && (
            <>
              <p className="m-0">
                Fitted on {note.n_games.toLocaleString()} Clippers games
                {note.basis === 'spread' ? ' with a closing spread' : note.basis === 'home_court' ? ' without a stored spread' : ''} ·
                Brier score {note.brier.toFixed(3)} · updated {new Date(c.fitted_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </p>
              <p className="m-0 font-mono text-[11px] text-dim">All fitted games (σ {c.sigma}):</p>
              <table className="w-full max-w-[320px] font-mono text-[11px] tabular-nums">
                <thead className="text-dim">
                  <tr>
                    <th className="text-left font-normal">Predicted</th>
                    <th className="text-right font-normal">Actual</th>
                    <th className="text-right font-normal">Moments</th>
                  </tr>
                </thead>
                <tbody>
                  {c.reliability.map((b) => (
                    <tr key={b.lo}>
                      <td>{Math.round(b.mean_p * 100)}%</td>
                      <td className="text-right">{Math.round(b.observed * 100)}%</td>
                      <td className="text-right text-dim">{b.n.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {note.kind === 'uncalibrated' && <p className="m-0">Not calibrated yet — using the default σ.</p>}
        </div>
      )}
    </div>
  )
}

/** The game's margin over time with the model's win probability (spec §7.1). */
export function GameFlow({
  flow,
  wp,
  oppAbbr,
  compact = false,
}: {
  flow: LiveFlow
  wp: LiveWinProb | null
  oppAbbr: string
  compact?: boolean
}) {
  const rows = React.useMemo(() => flowRows(flow), [flow])
  const end = flowDomainEnd(flow)
  const [lo, hi] = marginDomain(flow)

  const areas = [
    <Area key="lead" yAxisId="m" type="stepAfter" dataKey="lead" stroke={LAC} strokeWidth={1.5} fill={LAC} fillOpacity={0.22} dot={false} activeDot={false} isAnimationActive={false} />,
    <Area key="trail" yAxisId="m" type="stepAfter" dataKey="trail" stroke={OPP} strokeWidth={1.5} fill={OPP} fillOpacity={0.18} dot={false} activeDot={false} isAnimationActive={false} />,
  ]

  if (compact) {
    return (
      <div className="h-11 w-full" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
            <XAxis dataKey="t" type="number" domain={[0, end]} hide />
            <YAxis yAxisId="m" domain={[lo, hi]} hide />
            <ReferenceLine yAxisId="m" y={0} stroke="var(--line-2)" />
            {areas}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    )
  }

  const ticks = periodTicks(end)
  const summary = flowSummary(flow)
  const leadText = largestLeadText(summary, oppAbbr)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11.5px] text-mute tabular-nums">
        <span>Lead changes {summary.leadChanges}</span>
        {leadText && <span>{leadText}</span>}
        {wp && <span className="ml-auto text-text">LAC win probability {Math.round(wp.lac * 100)}%</span>}
      </div>
      <div className="h-[230px] w-full sm:h-[260px]" role="img" aria-label={`Game flow. ${marginText(flow.points.at(-1)?.m ?? 0, oppAbbr)}.`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: 0, bottom: 0, left: -8 }}>
            <XAxis dataKey="t" type="number" domain={[0, end]} ticks={ticks} tickFormatter={tickLabel} tick={axisTick} axisLine={false} tickLine={false} />
            <YAxis yAxisId="m" domain={[lo, hi]} tick={axisTick} axisLine={false} tickLine={false} width={34} tickFormatter={signed} />
            <YAxis yAxisId="wp" orientation="right" domain={[0, 100]} ticks={[0, 50, 100]} tick={axisTick} axisLine={false} tickLine={false} width={34} tickFormatter={(v: number) => `${v}%`} />
            <ReferenceLine yAxisId="m" y={0} stroke="var(--line-2)" />
            {ticks.slice(1).map((t) => (
              <ReferenceLine key={`p-${t}`} yAxisId="m" x={t} stroke="var(--line)" strokeDasharray="3 3" />
            ))}
            {markersOf(flow, 'run').map((r) => (
              <ReferenceArea
                key={`run-${r.t_start}`}
                yAxisId="m"
                x1={r.t_start}
                x2={r.t}
                fill={r.side === 'lac' ? LAC : OPP}
                fillOpacity={0.08}
                label={{ value: `${r.pts}-0`, position: 'insideTop', fill: 'var(--dim)', fontSize: 10 }}
              />
            ))}
            {areas}
            <Line yAxisId="wp" type="monotone" dataKey="wp" stroke="var(--text)" strokeOpacity={0.55} strokeWidth={1.25} strokeDasharray="4 3" dot={false} activeDot={false} isAnimationActive={false} />
            {markersOf(flow, 'max_lead').map((m) => (
              <ReferenceDot key={`max-${m.side}`} yAxisId="m" x={m.t} y={m.side === 'lac' ? m.margin : -m.margin} r={3.5} fill={m.side === 'lac' ? LAC : OPP} stroke="var(--ink-1)" />
            ))}
            {markersOf(flow, 'timeout').map((m) => (
              <ReferenceDot key={`to-${m.t}-${m.side}`} yAxisId="m" x={m.t} y={lo} r={2} fill={m.side === 'lac' ? LAC : 'var(--dim)'} stroke="none" />
            ))}
            <Tooltip
              cursor={{ stroke: 'var(--line-2)' }}
              content={({ active, payload }) => (
                <FlowTooltip row={active ? (payload?.[0]?.payload as FlowRow | undefined) : undefined} oppAbbr={oppAbbr} />
              )}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {wp && <ModelNote wp={wp} />}
    </div>
  )
}
