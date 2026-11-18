'use client'

import * as React from 'react'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { InitialsDisc } from './bits'
import { seasonLabel } from '@/src/lib/franchise/display'
import { winPct, type Tenure } from '@/src/lib/franchise/tenures'

const SHOWN = 6
const OPEN = 2

const pct3 = (p: number | null) => (p == null ? '—' : p.toFixed(3).replace(/^0/, ''))
const wl = (w: number | null, l: number | null) => (w == null || l == null ? '—' : `${w}–${l}`)

function years(t: Tenure, currentSeason: number): string {
  const n = t.seasons.length
  const span = t.last >= currentSeason ? `${t.first}–present` : t.first === t.last ? seasonLabel(t.first) : `${t.first}–${t.last + 1}`
  const partial = t.seasons.some((s) => s.note)
  return `${span} · ${n} season${n === 1 ? '' : 's'}${partial && n === 1 ? ', part' : ''}`
}

function TenureBlock({
  t,
  current,
  open,
  onToggle,
  currentSeason,
}: {
  t: Tenure
  current: boolean
  open: boolean
  onToggle: () => void
  currentSeason: number
}) {
  // The column labels sit on the newest tenure only; the columns read the same below it.
  const id = React.useId()
  const playoffs = t.playoffWins == null ? 'playoffs —' : `playoffs ${t.playoffWins}–${t.playoffLosses}`
  return (
    <div className="relative px-3.5 py-3 sm:px-5 sm:py-3.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[14px] py-1 text-left sm:grid-cols-[40px_minmax(0,1fr)_auto_20px] sm:gap-3.5"
      >
        <InitialsDisc
          name={t.coach.name}
          size={40}
          className={cn(
            'relative z-[1] max-sm:!h-[34px] max-sm:!w-[34px] max-sm:!text-[12px]',
            'bg-[radial-gradient(circle_at_30%_20%,#1a2a45,#0e1729)]',
            current && 'border-pacific/55 bg-[radial-gradient(circle_at_30%_20%,#1a3a69,#0c2340)] text-white shadow-[0_0_0_4px_rgba(65,143,222,0.12)]',
          )}
        />
        <span className="min-w-0">
          <span className="block truncate text-[16px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[17px]">{t.coach.name}</span>
          <span className="mt-[3px] block truncate font-mono text-[11px] text-dim">{years(t, currentSeason)}</span>
        </span>
        <span className="text-right">
          <span className="block text-[15px] font-semibold tracking-[-0.02em] tabular-nums sm:text-[17px]">{wl(t.wins, t.losses)}</span>
          <span className="mt-[3px] block whitespace-nowrap font-mono text-[11px] text-dim">
            {pct3(winPct(t.wins, t.losses))}
            <span className="max-sm:hidden"> · {playoffs}</span>
          </span>
        </span>
        <span aria-hidden className={cn('hidden place-items-center text-dim transition-transform duration-300 ease-premium sm:grid', open && 'rotate-90')}>
          <svg width="10" height="10" viewBox="0 0 10 10">
            <path d="M3.5 2 6.5 5 3.5 8" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      <div id={id} hidden={!open} className="ml-11 mt-2.5 grid sm:ml-[54px]">
        {current && (
          <div
            aria-hidden
            className="grid grid-cols-[52px_46px_minmax(30px,1fr)_62px] gap-2.5 px-2.5 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-dim sm:grid-cols-[64px_56px_minmax(60px,1fr)_84px] sm:gap-3.5"
          >
            <span>Season</span>
            <span className="text-right">W–L</span>
            <span>Win %</span>
            <span className="text-right">Playoffs</span>
          </div>
        )}
        {t.seasons.map((s) => {
          const p = winPct(s.wins, s.losses)
          const po = s.playoff_wins == null || s.playoff_losses == null ? null : `${s.playoff_wins}–${s.playoff_losses}`
          return (
            <div
              key={`${s.season_id}-${s.ordinal}`}
              className="row-hover -mx-2.5 grid grid-cols-[52px_46px_minmax(30px,1fr)_62px] items-center gap-2.5 rounded-[10px] px-2.5 py-[7px] text-[13.5px] sm:grid-cols-[64px_56px_minmax(60px,1fr)_84px] sm:gap-3.5 sm:text-[14px]"
            >
              <span className="font-mono text-[11px] text-mute sm:text-[11.5px]">{seasonLabel(s.season_id)}</span>
              <span className="text-right font-semibold tabular-nums">{wl(s.wins, s.losses)}</span>
              <span
                className="relative h-1 rounded-full bg-line"
                role="img"
                aria-label={p == null ? 'Win percentage not recorded' : `${Math.round(p * 100)}% wins`}
              >
                {p != null && <i className="absolute inset-y-0 left-0 rounded-full bg-pacific" style={{ width: `${p * 100}%` }} />}
                <span aria-hidden className="absolute -inset-y-[3px] left-1/2 w-px bg-[rgba(150,178,230,0.28)]" />
              </span>
              <span className={cn('whitespace-nowrap text-right font-mono text-[11.5px]', po ? 'text-mute' : 'text-dim')}>{po ?? '—'}</span>
              {s.note && <span className="col-start-2 col-end-[-1] -mt-1 text-[12.5px] text-mute">{s.note}</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Head coaches as a vertical timeline, newest first. Each tenure expands into its seasons. */
export function CoachTimeline({ tenures, currentSeason }: { tenures: Tenure[]; currentSeason: number }) {
  const [open, setOpen] = React.useState<Set<string>>(() => new Set(tenures.slice(0, OPEN).map((t) => t.key)))
  const [all, setAll] = React.useState(tenures.length <= SHOWN + 1)
  const shown = all ? tenures : tenures.slice(0, SHOWN)
  const rest = tenures.slice(SHOWN)
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  return (
    <Panel className="relative py-2">
      <span
        aria-hidden
        className="absolute bottom-[34px] left-[31px] top-[34px] w-px bg-[linear-gradient(180deg,rgba(65,143,222,0.6),var(--line-2)_18%,var(--line-2)_85%,transparent)] sm:left-[39px]"
      />
      {shown.map((t, i) => (
        <TenureBlock key={t.key} t={t} current={i === 0} open={open.has(t.key)} onToggle={() => toggle(t.key)} currentSeason={currentSeason} />
      ))}
      {!all && rest.length > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="glass-track press relative z-[1] mx-3.5 mb-3 mt-1 flex w-[calc(100%-28px)] items-center justify-between gap-3 rounded-[14px] px-3.5 py-3 text-[14px] text-mute transition-colors hover:text-text sm:mx-5 sm:w-[calc(100%-40px)]"
        >
          Earlier coaches
          <span className="font-mono text-[11.5px] text-dim">
            {rest.length} more · {rest.at(-1)!.first}–{rest[0].last + 1}
          </span>
        </button>
      )}
    </Panel>
  )
}
