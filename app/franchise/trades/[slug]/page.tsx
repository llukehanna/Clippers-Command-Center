import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Panel } from '@/components/ui/panel'
import { TeamLogo } from '@/components/ui/team-mark'
import { GapNote, plink } from '@/components/franchise/bits'
import { SwapGlyph, TradeSides } from '@/components/franchise/TradeSides'
import { TradeTree } from '@/components/franchise/TradeTree'
import { getJson } from '@/src/lib/ui/api'
import { highlightNames, kindLabel, moveDate, movesHref, seasonLabel } from '@/src/lib/franchise/display'
import { teamFullName } from '@/src/lib/franchise/franchise-ids'
import { assetSummary, sidePanels, sourceNames, tradeHeadline, treeGroups } from '@/src/lib/franchise/trade-display'
import type { FranchisePersonRef, TradePayload } from '@/src/lib/ui/types'

// Live data on every request (loaders read the database directly).
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

function load(slug: string) {
  return getJson<TradePayload>(`/api/franchise/trades/${encodeURIComponent(slug)}`)
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const data = await load((await params).slug)
  if (!data) return { title: 'Trade not found' }
  return { title: `${tradeHeadline(data.trade.description, data.sides)} · ${moveDate(data.trade.date)}` }
}

/** Our generated sentence with the people it names in bright type (linked when they have a page). */
function Description({ text, people }: { text: string; people: FranchisePersonRef[] }) {
  const byName = new Map(people.map((p) => [p.name, p]))
  return (
    <p className="m-0 max-w-[72ch] text-[15px] leading-[1.55] text-mute">
      {highlightNames(text, [...byName.keys()]).map((s, i) => {
        if (!s.name) return <span key={i}>{s.text}</span>
        const person = byName.get(s.name)
        return person?.href ? (
          <Link key={i} href={person.href} prefetch={false} className={cn('font-medium text-text', plink)}>
            {s.text}
          </Link>
        ) : (
          <span key={i} className="font-medium text-text">
            {s.text}
          </span>
        )
      })}
    </p>
  )
}

/**
 * One trade: who got what (era names and marks), then "What it became", an outline that
 * follows each asset through its next moves, up to three steps.
 */
export default async function TradePage({ params }: Params) {
  const { slug } = await params
  const data = await load(slug)
  if (!data) notFound()

  const { trade, teams, sides } = data
  const panels = sidePanels(sides)
  const groups = treeGroups(data.became, sides)
  const headline = tradeHeadline(trade.description, sides)
  const sources = sourceNames(trade.sources)
  const people = sides.flatMap((s) => [...s.received, ...s.sent]).flatMap((a) => (a.person ? [a.person] : []))
  // Back to that season's trades; a league trade (reached from an outline) isn't listed there, so it goes to Moves.
  const backSeason = trade.involves_clippers ? trade.season_id : null
  const back = backSeason != null ? movesHref({ season: backSeason, type: 'trade', player: null }) : '/franchise'

  return (
    <div className="grid gap-5 sm:gap-6 [&>*]:min-w-0">
      <Link
        href={back}
        prefetch={false}
        className="enter w-fit font-mono text-[12px] text-mute transition-colors hover:text-text"
        style={{ ['--i' as string]: 2 }}
      >
        ← {backSeason != null ? `${seasonLabel(backSeason)} trades` : 'Moves'}
      </Link>

      <Panel as="header" variant="hero" className="enter grid gap-[18px] px-4 py-5 sm:p-7" style={{ ['--i' as string]: 3 }}>
        <div>
          <p className="label-mono m-0 flex flex-wrap items-center gap-x-2 gap-y-1 text-mute">
            <span>{kindLabel(trade.kind)}</span>
            <span aria-hidden>·</span>
            <time dateTime={trade.date ?? undefined}>{moveDate(trade.date)}</time>
            {trade.season_id != null && (
              <>
                <span aria-hidden>·</span>
                <span>{seasonLabel(trade.season_id)} season</span>
              </>
            )}
          </p>
          <h2 className="m-0 mt-2 text-[28px] font-semibold leading-[1.1] tracking-[-0.04em] sm:text-[36px]">{headline}</h2>
        </div>

        <ul className="m-0 flex list-none flex-wrap items-center gap-x-[22px] gap-y-3.5 p-0">
          {teams.map((t, i) => {
            const side = sides.find((s) => s.team.franchise_id === t.franchise_id)
            return (
              <li key={t.franchise_id} className="flex min-w-0 items-center gap-x-[22px]">
                {i > 0 && teams.length === 2 && <SwapGlyph size={18} className="max-sm:hidden" />}
                <span className="flex min-w-0 items-center gap-3.5">
                  <TeamLogo abbr={t.abbreviation} size="lg" priority className="max-sm:!h-11 max-sm:!w-11" />
                  <span className="min-w-0">
                    <span className="block text-[17px] font-semibold leading-[1.2] tracking-[-0.02em] sm:text-[18px]">{teamFullName(t)}</span>
                    <span className="mt-0.5 block font-mono text-[11.5px] text-mute">got {side ? assetSummary(side.received) : 'nothing recorded'}</span>
                  </span>
                </span>
              </li>
            )
          })}
        </ul>

        <Description text={trade.description} people={people} />

        <div className="flex flex-wrap items-center gap-x-[18px] gap-y-1.5 border-t border-line pt-3.5 font-mono text-[11px] text-dim">
          <span>{sources.length ? `Sources: ${sources.join(' · ')}` : 'Source not recorded'}</span>
          {!trade.is_complete && <GapNote>details pending</GapNote>}
          {data.gap_notes.map((n) => (
            <GapNote key={n}>{n}</GapNote>
          ))}
        </div>
      </Panel>

      <div className="enter" style={{ ['--i' as string]: 4 }}>
        <TradeSides panels={panels} />
      </div>

      <div className="enter" style={{ ['--i' as string]: 5 }}>
        <TradeTree groups={groups} />
      </div>
    </div>
  )
}
