import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { Stat } from '@/components/ui/stat'
import { Chip } from '@/components/ui/chip'
import { money, seasonLabel } from '@/src/lib/franchise/display'
import type { PayrollSeason } from '@/src/lib/ui/types'

const M = 1_000_000

/** Round the axis top up to a clean step: $50M steps for modern payrolls, $10M for early ones. */
function axis(max: number): { top: number; step: number } {
  const step = max > 100 * M ? 50 * M : max > 20 * M ? 10 * M : 5 * M
  return { top: Math.max(step, Math.ceil(max / step) * step), step }
}

/** Payroll by season from 1984–85 (recorded salaries, nominal dollars). Partial seasons are hatched and labelled. */
export function PayrollChart({ payroll }: { payroll: PayrollSeason[] }) {
  const seasons = [...payroll].sort((a, b) => a.season_id - b.season_id)
  const known = seasons.filter((s) => s.listed_total_usd != null)
  const latest = payroll[0]
  const peak = known.reduce<PayrollSeason | null>((best, s) => (best == null || s.listed_total_usd! > best.listed_total_usd! ? s : best), null)
  const partial = seasons.filter((s) => s.is_partial).length
  const { top, step } = axis(peak?.listed_total_usd ?? 0)
  const lines = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step)
  const n = seasons.length
  // Ticks sit under their bar (by index): seasons can have gaps (an early partial season, then decades later).
  const ticks = seasons.flatMap((s, i) => (s.season_id % 5 === 0 ? [{ y: s.season_id, i }] : []))
  const pct = (v: number) => `${(v / top) * 100}%`

  return (
    <Panel className="px-4 pb-4 pt-[18px] sm:px-5 sm:pb-[18px] sm:pt-5">
      <div className="mb-[18px] grid grid-cols-3 gap-4 sm:gap-5">
        <Stat label={latest ? seasonLabel(latest.season_id) : 'Latest'} value={money(latest?.listed_total_usd)} sub={latest?.is_partial ? 'partial' : 'recorded'} />
        <Stat label="Peak" value={money(peak?.listed_total_usd)} sub={peak ? seasonLabel(peak.season_id) : '—'} />
        <Stat label="Seasons" value={n} sub={partial ? `${partial} partial` : 'none partial'} />
      </div>

      <div className="relative mt-2 h-[170px] sm:h-[210px]">
        <div aria-hidden className="absolute bottom-[22px] left-[38px] right-0 top-0 sm:left-11">
          {lines.map((v) => (
            <span key={v} className="absolute inset-x-0 h-px bg-[rgba(150,178,230,0.08)]" style={{ bottom: pct(v) }}>
              <em className="absolute -left-[38px] w-8 -translate-y-1/2 text-right font-mono text-[10.5px] not-italic text-dim sm:-left-11 sm:w-[38px]">
                {v === 0 ? '$0' : `$${v / M}M`}
              </em>
            </span>
          ))}
        </div>
        <ol aria-label="Payroll by season" className="absolute bottom-[22px] left-[38px] right-0 top-0 m-0 flex list-none items-end gap-[1.5px] p-0 sm:left-11 sm:gap-[3px]">
          {seasons.map((s, i) => {
            const v = s.listed_total_usd
            const last = i === n - 1
            const isPeak = peak?.season_id === s.season_id
            const label = `${seasonLabel(s.season_id)} · ${v == null ? 'not recorded' : money(v)}${s.is_partial ? ' · partial' : ''}`
            return (
              <li key={s.season_id} title={label} aria-label={label} className="relative flex h-full flex-1 items-end justify-center">
                {isPeak && v != null && (
                  <b className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap font-mono text-[10.5px] font-normal text-text" style={{ bottom: `calc(${pct(v)} + 6px)` }}>
                    {money(v)}
                  </b>
                )}
                <i
                  className={cn(
                    'block w-full max-w-[44px] rounded-t-[4px] rounded-b-[1px] transition-[filter] duration-300 hover:brightness-[1.35]',
                    v == null
                      ? 'bg-[rgba(150,178,230,0.1)]'
                      : s.is_partial
                        ? 'bg-[repeating-linear-gradient(135deg,rgba(65,143,222,0.5)_0_2px,transparent_2px_5px)] shadow-[inset_0_0_0_1px_rgba(65,143,222,0.35)]'
                        : last
                          ? 'bg-[linear-gradient(180deg,#7fb6ec,rgba(65,143,222,0.45))] shadow-[0_0_16px_-4px_rgba(127,182,236,0.8)]'
                          : 'bg-[linear-gradient(180deg,rgba(65,143,222,0.9),rgba(65,143,222,0.25))]',
                  )}
                  style={{ height: v == null ? 2 : pct(v) }}
                />
              </li>
            )
          })}
        </ol>
        <div aria-hidden className="absolute bottom-0 left-[38px] right-0 h-4 sm:left-11">
          {ticks.map((t, k) => (
            <span
              key={t.y}
              className={cn('absolute -translate-x-1/2 font-mono text-[10.5px] text-dim', k % 2 === 1 && ticks.length > 5 && 'max-sm:hidden')}
              style={{ left: `${((t.i + 0.5) / n) * 100}%` }}
            >
              {t.y}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-line pt-3.5 font-mono text-[11px] text-dim">
        <span className="inline-flex items-center gap-[7px]">
          <i aria-hidden className="inline-block h-3 w-3 rounded-[3px] bg-[linear-gradient(180deg,rgba(65,143,222,0.9),rgba(65,143,222,0.3))]" />
          Recorded salaries, nominal $
        </span>
        <span className="inline-flex items-center gap-[7px]">
          <i aria-hidden className="inline-block h-3 w-3 rounded-[3px] bg-[repeating-linear-gradient(135deg,rgba(65,143,222,0.5)_0_2px,transparent_2px_5px)] shadow-[inset_0_0_0_1px_rgba(65,143,222,0.35)]" />
          <Chip tone="warn">Partial</Chip> Some salaries missing for that season
        </span>
      </div>
    </Panel>
  )
}
