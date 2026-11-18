import * as React from 'react'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { PlayerAvatar } from '@/components/ui/player-avatar'
import { TeamLogo } from '@/components/ui/team-mark'
import { GapNote, PersonName } from './bits'
import { ordinal, teamPlace } from '@/src/lib/franchise/display'
import { teamFullName } from '@/src/lib/franchise/franchise-ids'
import { protectionsTone, type SidePanel } from '@/src/lib/franchise/trade-display'
import type { TradeAsset } from '@/src/lib/ui/types'

export function SwapGlyph({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden className={cn('text-dim', className)}>
      <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function SubLabel({ children }: { children: React.ReactNode }) {
  return <p className="label-mono m-0 mb-1 mt-3.5">{children}</p>
}

function Protections({ known, label }: { known: boolean | null; label: string }) {
  const tone = protectionsTone(known, label)
  return <div className={cn('mt-px text-[12.5px]', tone === 'unknown' ? 'italic text-dim' : tone === 'protected' ? 'text-text' : 'text-mute')}>{label}</div>
}

function PlayerRow({ a, big, showFrom }: { a: TradeAsset; big: boolean; showFrom: boolean }) {
  const person = a.person!
  const meta = [a.kind === 'draft_rights' ? 'Draft rights' : null, showFrom && a.counterparty ? `from ${teamFullName(a.counterparty)}` : null].filter(Boolean).join(' · ')
  return (
    <div className={cn('row-hover -mx-2.5 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-[14px] px-2.5', big ? 'py-3' : 'py-2')}>
      <PlayerAvatar name={person.name} nbaPlayerId={person.nba_person_id} size={big ? 56 : 40} />
      <div className="min-w-0">
        <PersonName person={person} className={cn('font-medium tracking-[-0.01em]', big ? 'text-[20px] font-semibold tracking-[-0.025em]' : 'text-[15px]')} />
        {meta && <div className="mt-0.5 font-mono text-[11px] text-dim">{meta}</div>}
        {a.gap_note && (
          <div className="mt-1">
            <GapNote>{a.gap_note}</GapNote>
          </div>
        )}
      </div>
    </div>
  )
}

function Tile({ children, dashed }: { children: React.ReactNode; dashed?: boolean }) {
  return (
    <span
      className={cn(
        'grid h-[34px] w-[34px] place-items-center rounded-[10px]',
        dashed ? 'border border-dashed border-line-2 font-mono text-[11px] text-dim' : 'glass-track',
      )}
    >
      {children}
    </span>
  )
}

function PickRow({ a }: { a: TradeAsset }) {
  const p = a.pick
  return (
    <div className="row-hover -mx-2.5 grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-[12px] px-2.5 py-[7px]">
      {p ? (
        <Tile>
          <TeamLogo abbr={p.original_team.abbreviation} size="xs" />
        </Tile>
      ) : (
        <Tile dashed>?</Tile>
      )}
      <div className="min-w-0">
        {p ? (
          <>
            <div className="text-[14px] font-medium">
              {p.draft_year} {ordinal(p.round)} <span className="font-mono text-[12px] font-normal text-mute">· {p.original_team.abbreviation ?? teamPlace(p.original_team)}</span>
            </div>
            <Protections known={p.protections_known} label={p.protections_label} />
          </>
        ) : (
          <div className="text-[14px] font-medium">{capitalize(a.label)}</div>
        )}
        {a.gap_note && (
          <div className="mt-1">
            <GapNote>{a.gap_note}</GapNote>
          </div>
        )}
      </div>
    </div>
  )
}

function SwapRow({ a }: { a: TradeAsset }) {
  const s = a.swap
  return (
    <div className="row-hover -mx-2.5 grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-[12px] px-2.5 py-[7px]">
      <Tile>
        <SwapGlyph />
      </Tile>
      <div className="min-w-0">
        {s ? (
          <>
            <div className="text-[14px] font-medium">
              {s.draft_year} {ordinal(s.round)} swap{' '}
              <span className="font-mono text-[12px] font-normal text-mute">· {s.teams.map((t) => t.abbreviation ?? teamPlace(t)).join(' ⇄ ')}</span>
            </div>
            <Protections known={s.protections_known} label={s.protections_label} />
          </>
        ) : (
          <div className="text-[14px] font-medium">{capitalize(a.label)}</div>
        )}
        {a.gap_note && (
          <div className="mt-1">
            <GapNote>{a.gap_note}</GapNote>
          </div>
        )}
      </div>
    </div>
  )
}

function OtherRow({ a }: { a: TradeAsset }) {
  return (
    <div className="row-hover -mx-2.5 grid grid-cols-[34px_minmax(0,1fr)] items-center gap-2.5 rounded-[12px] px-2.5 py-[7px]">
      <Tile>
        <span aria-hidden className="font-mono text-[12px] text-mute">
          {a.kind === 'cash' ? '$' : a.kind === 'exception' ? 'TE' : '·'}
        </span>
      </Tile>
      <div className="min-w-0">
        <div className="text-[14px] font-medium">{capitalize(a.label)}</div>
        {a.gap_note && (
          <div className="mt-1">
            <GapNote>{a.gap_note}</GapNote>
          </div>
        )}
      </div>
    </div>
  )
}

function SidePanelView({ panel, showFrom }: { panel: SidePanel; showFrom: boolean }) {
  const players = panel.assets.filter((a) => (a.kind === 'player' || a.kind === 'draft_rights') && a.person)
  const picks = panel.assets.filter((a) => a.kind === 'pick')
  const swaps = panel.assets.filter((a) => a.kind === 'swap')
  const other = panel.assets.filter((a) => !players.includes(a) && !picks.includes(a) && !swaps.includes(a))
  const big = panel.assets.length === 1 && players.length === 1
  const grid = 'grid gap-x-[18px] gap-y-0.5 @md:grid-cols-2'
  return (
    <Panel as="section" aria-label={panel.title} className="@container px-3.5 pb-2.5 pt-4 sm:px-5 sm:pb-3.5 sm:pt-[18px]">
      <div className="mb-2.5 flex items-center gap-2.5">
        {panel.team ? (
          <TeamLogo abbr={panel.team.abbreviation} size="xs" />
        ) : (
          <span aria-hidden className="h-5 w-5 rounded-full border border-dashed border-line-2" />
        )}
        <h3 className="m-0 font-mono text-[11.5px] font-normal uppercase leading-none tracking-[0.14em] text-mute">{panel.title}</h3>
        <span aria-hidden className="h-px flex-1 bg-gradient-to-r from-line-2 to-transparent" />
        {panel.aside && <span className="font-mono text-[11px] leading-none text-dim">{panel.aside}</span>}
      </div>

      {panel.assets.length === 0 && <p className="m-0 py-2 text-[13.5px] text-dim">Nothing recorded</p>}

      {players.length > 0 && (
        <div className={cn(!big && players.length > 3 && grid)}>
          {players.map((a, i) => (
            <PlayerRow key={`${a.person!.person_key}-${i}`} a={a} big={big} showFrom={showFrom} />
          ))}
        </div>
      )}
      {picks.length > 0 && (
        <>
          {(players.length > 0 || swaps.length > 0) && <SubLabel>Picks</SubLabel>}
          <div className={grid}>
            {picks.map((a, i) => (
              <PickRow key={a.pick?.pick_key ?? `pick-${i}`} a={a} />
            ))}
          </div>
        </>
      )}
      {swaps.length > 0 && (
        <>
          {(players.length > 0 || picks.length > 0) && <SubLabel>Swaps</SubLabel>}
          <div className={grid}>
            {swaps.map((a, i) => (
              <SwapRow key={a.swap?.swap_key ?? `swap-${i}`} a={a} />
            ))}
          </div>
        </>
      )}
      {other.length > 0 && (
        <>
          {panel.assets.length > other.length && <SubLabel>Also</SubLabel>}
          <div className={grid}>
            {other.map((a, i) => (
              <OtherRow key={`other-${i}`} a={a} />
            ))}
          </div>
        </>
      )}
    </Panel>
  )
}

/** Column template for the side panels: the busier side gets more room. */
function columns(panels: SidePanel[]): string {
  if (panels.length >= 4) return 'lg:grid-cols-2'
  if (panels.length === 3) return 'lg:grid-cols-3'
  if (panels.length === 2) {
    const [a, b] = panels.map((p) => p.assets.length)
    if (b > a + 1) return 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)]'
    if (a > b + 1) return 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]'
    return 'lg:grid-cols-2'
  }
  return ''
}

/** What each side of the trade got: players, picks (with protections in plain words), swaps, cash. */
export function TradeSides({ panels }: { panels: SidePanel[] }) {
  // "from X" earns its place only when more than one team could have sent it.
  const showFrom = panels.filter((p) => p.team).length > 2
  return (
    <div className={cn('grid items-start gap-4 lg:gap-[18px] [&>*]:min-w-0', columns(panels))}>
      {panels.map((p) => (
        <SidePanelView key={p.key} panel={p} showFrom={showFrom} />
      ))}
    </div>
  )
}
