import Link from 'next/link'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { TeamLogo } from '@/components/ui/team-mark'
import { GapNote, RoundBadge, plink } from './bits'
import { capitalize, moveDate, ordinal, possessive, teamPlace } from '@/src/lib/franchise/display'
import { GAP_NOTES } from '@/src/lib/franchise/trade-tree'
import type { OwedAsset } from '@/src/lib/ui/types'

const roundWord = (r: number) => (r === 1 ? 'first' : r === 2 ? 'second' : `${ordinal(r)}-round pick`)

function Arrow() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden className="text-dim">
      <path d="M2.5 6h7M6.5 3l3 3-3 3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SwapIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden className="text-dim">
      <path d="M3 5.5h9.5M10 3l2.5 2.5L10 8M13 10.5H3.5M6 8l-2.5 2.5L6 13" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** Title line in plain words: "Own first", "Philadelphia’s second", "Own first to Philadelphia", "Swap rights with Philadelphia". */
function title(a: OwedAsset): string {
  if (a.kind === 'swap') return `Swap rights with ${teamPlace(a.counterparty)}`
  const pick = a.is_own ? `Own ${roundWord(a.round)}` : `${possessive(a.original_team)} ${roundWord(a.round)}`
  return a.holder_status === 'owed' ? `${pick} to ${teamPlace(a.owner)}` : pick
}

/** What a swap means for the Clippers, before its protections. */
function swapLine(a: OwedAsset): string {
  const round = roundWord(a.round)
  return a.owner?.is_clippers
    ? `The Clippers may swap their ${round} for ${possessive(a.counterparty)}`
    : `${teamPlace(a.owner ?? a.counterparty)} may swap its ${round} for the Clippers’`
}

function Logos({ a }: { a: OwedAsset }) {
  if (a.kind === 'swap') {
    return (
      <>
        <TeamLogo abbr="LAC" size="sm" />
        <SwapIcon />
        <TeamLogo abbr={a.counterparty?.abbreviation} size="sm" />
      </>
    )
  }
  if (a.holder_status === 'held') return <TeamLogo abbr={a.original_team?.abbreviation} size="sm" />
  return (
    <>
      <TeamLogo abbr="LAC" size="sm" />
      <Arrow />
      {a.owner ? (
        <TeamLogo abbr={a.owner.abbreviation} size="sm" />
      ) : (
        <span aria-label="Holder not recorded" className="grid h-7 w-7 place-items-center rounded-full border border-dashed border-line-2 font-mono text-[10px] text-dim">
          ?
        </span>
      )}
    </>
  )
}

function Source({ a }: { a: OwedAsset }) {
  if (!a.trade) return null
  const verb = a.holder_status === 'held' ? 'from' : a.holder_status === 'owed' ? 'in' : 'possibly in'
  return (
    <span className="mt-[3px] block font-mono text-[11px] text-dim">
      {verb} the{' '}
      <Link href={a.trade.href} prefetch={false} className={cn('text-mute', plink)}>
        {a.trade.date ? `${moveDate(a.trade.date)} trade` : 'trade'}
      </Link>
      {a.holder_status === 'uncertain' && a.counterparty && <> with {a.counterparty.abbreviation ?? teamPlace(a.counterparty)}</>}
    </span>
  )
}

function AssetRow({ a, wideLogos }: { a: OwedAsset; wideLogos: boolean }) {
  const unknown = a.protections_known !== true
  // The protections line already says "not recorded"; other gap notes stay as quiet notes.
  const notes = a.gap_notes.filter((n) => n !== GAP_NOTES.protections_unknown)
  return (
    <div
      className={cn(
        'row-hover -mx-2.5 grid items-center gap-2.5 rounded-[14px] px-2.5 py-2 sm:gap-3',
        wideLogos ? 'grid-cols-[40px_76px_minmax(0,1fr)] sm:grid-cols-[44px_84px_minmax(0,1fr)]' : 'grid-cols-[44px_28px_minmax(0,1fr)]',
      )}
    >
      <RoundBadge className="py-[5px]">{a.kind === 'swap' ? 'Swap' : ordinal(a.round)}</RoundBadge>
      <span className="flex items-center gap-1">
        <Logos a={a} />
      </span>
      <div className="min-w-0">
        <div className="text-[14.5px] font-medium tracking-[-0.01em]">{title(a)}</div>
        {a.kind === 'swap' && <div className="mt-0.5 text-[13px] text-mute">{swapLine(a)}</div>}
        <div className={cn('mt-0.5 text-[13px]', unknown ? 'italic text-dim' : 'text-mute')}>{a.protections_label}</div>
        {a.note && <div className="mt-0.5 text-[13px] text-mute">{capitalize(a.note)}</div>}
        <Source a={a} />
        {notes.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
            {notes.map((n) => (
              <GapNote key={n}>{n}</GapNote>
            ))}
          </span>
        )}
      </div>
    </div>
  )
}

/** Assets grouped by draft year (oldest year first: the next draft is the most pressing). */
export function PicksOwedList({ assets }: { assets: OwedAsset[] }) {
  // Two-logo rows (LAC → team, LAC ⇄ team) need the wider logo column; keep one width per panel so rows align.
  const wideLogos = assets.some((a) => a.kind === 'swap' || a.holder_status !== 'held')
  const years = [...new Set(assets.map((a) => a.draft_year))].sort((a, b) => a - b)
  return (
    <Panel className="py-1">
      {years.map((y) => (
        <div key={y} className="grid px-3.5 py-3.5 sm:grid-cols-[64px_minmax(0,1fr)] sm:gap-x-3.5 sm:px-[18px] [&+&]:border-t [&+&]:border-line">
          <div className="mb-1 text-[18px] font-semibold tracking-[-0.02em] sm:mb-0 sm:pt-2">{y}</div>
          <div className="grid gap-1">
            {assets
              .filter((a) => a.draft_year === y)
              .map((a) => (
                <AssetRow key={a.key} a={a} wideLogos={wideLogos} />
              ))}
          </div>
        </div>
      ))}
    </Panel>
  )
}
