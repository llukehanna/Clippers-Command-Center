// src/lib/franchise/trade-display.ts
// Display logic for the trade page (/franchise/trades/[slug]). Pure. Unknown stays
// unknown: a part with no recorded receiver is never assigned to a team.

import type { FranchiseTeamRef, TradeAsset, TradeSide, TreeNode } from '@/src/lib/ui/types'
import { capitalize, ordinal, teamPlace } from './display'

/** The word a team goes by in headings: "Clippers", "Braves", "Thunder". */
export function teamWord(t: FranchiseTeamRef | null | undefined): string {
  if (!t) return 'Unknown team'
  return t.name ?? t.abbreviation ?? t.city ?? 'Unknown team'
}

const TEAM_COUNT = ['', '', '', 'three-team', 'four-team', 'five-team']

function people(sides: TradeSide[]): string[] {
  const names: string[] = []
  for (const s of sides) {
    for (const a of [...s.received, ...s.sent]) if (a.person && !names.includes(a.person.name)) names.push(a.person.name)
  }
  return names
}

/**
 * "Paul George trade": the person our generated description names first (it leads with the
 * headline player), else a player the Clippers received, else the other teams.
 */
export function tradeHeadline(description: string, sides: TradeSide[]): string {
  const suffix = sides.length >= 3 ? ` ${TEAM_COUNT[sides.length] ?? 'multi-team'} trade` : ' trade'
  let best: { name: string; at: number } | null = null
  for (const name of people(sides)) {
    const at = description.indexOf(name)
    if (at >= 0 && (best == null || at < best.at)) best = { name, at }
  }
  if (best) return `${best.name}${suffix}`
  const clippers = sides.find((s) => s.team.is_clippers)
  const lead = [...(clippers?.received ?? []), ...(clippers?.sent ?? [])].find((a) => a.person)?.person
  if (lead) return `${lead.name}${suffix}`
  const others = sides.filter((s) => !s.team.is_clippers).map((s) => teamPlace(s.team))
  return others.length ? `Trade with ${others.join(' and ')}` : 'Trade'
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const ROUND_WORD: Record<number, [string, string]> = { 1: ['first', 'firsts'], 2: ['second', 'seconds'] }

/** "2 players · 5 firsts · 2 swaps · cash". */
export function assetSummary(assets: TradeAsset[]): string {
  const count = (k: TradeAsset['kind']) => assets.filter((a) => a.kind === k).length
  const out: string[] = []
  if (count('player')) out.push(plural(count('player'), 'player'))
  if (count('draft_rights')) out.push(count('draft_rights') === 1 ? 'draft rights' : `${count('draft_rights')} draft rights`)
  const picks = assets.filter((a) => a.kind === 'pick')
  const rounds = [...new Set(picks.flatMap((a) => (a.pick ? [a.pick.round] : [])))].sort((a, b) => a - b)
  for (const r of rounds) {
    const n = picks.filter((a) => a.pick?.round === r).length
    const [one, many] = ROUND_WORD[r] ?? [`round-${r} pick`, `round-${r} picks`]
    out.push(plural(n, one, many))
  }
  const unidentified = picks.filter((a) => !a.pick).length
  if (unidentified) out.push(plural(unidentified, 'pick'))
  if (count('swap')) out.push(plural(count('swap'), 'swap'))
  if (count('cash')) out.push('cash')
  if (count('exception')) out.push(count('exception') === 1 ? 'a trade exception' : `${count('exception')} trade exceptions`)
  if (count('other')) out.push(plural(count('other'), 'other asset'))
  return out.length ? out.join(' · ') : 'nothing recorded'
}

const SOURCES: Array<[string, string]> = [
  ['nba', 'NBA.com'],
  ['bbref', 'Basketball Reference'],
  ['wiki', 'Wikipedia'],
  ['espn', 'ESPN'],
]

/** Source keys ("nba:Trade 1158000") as names, in key priority order, once each. */
export function sourceNames(sources: string[]): string[] {
  const prefixes = new Set(sources.map((s) => s.split(':')[0]).filter(Boolean))
  const known = SOURCES.filter(([p]) => prefixes.has(p)).map(([, name]) => name)
  const other = [...prefixes].filter((p) => !SOURCES.some(([k]) => k === p))
  return [...known, ...other]
}

/** How a protections line reads: only protections_known = true is ever plain or protected. */
export function protectionsTone(known: boolean | null, label: string): 'unknown' | 'plain' | 'protected' {
  if (known !== true) return 'unknown'
  return label === 'Unprotected' ? 'plain' : 'protected'
}

export interface SidePanel {
  key: string
  title: string
  /** The team the assets went to; null when the receiver isn't recorded. */
  team: FranchiseTeamRef | null
  aside: string | null
  assets: TradeAsset[]
}

const NO_RECEIVER = 'Receiver not recorded'
const NO_SENDER = 'sender not recorded'
const noSenderKey = (franchiseId: number) => `${franchiseId}-nosender`

/** Assets no side received: sent parts whose receiver isn't stated. */
function orphans(sides: TradeSide[], skip?: TradeSide): TradeAsset[] {
  return sides.filter((s) => s !== skip).flatMap((s) => s.sent.filter((a) => a.counterparty == null))
}

/**
 * The trade's sides as panels. A two-team Clippers deal reads from the Clippers side
 * ("Clippers got" / "Clippers gave", plus "X got · sender not recorded" for parts the other
 * team received from an unstated sender); any other deal shows what each team got.
 */
export function sidePanels(sides: TradeSide[]): SidePanel[] {
  const clippers = sides.find((s) => s.team.is_clippers)
  const panels: SidePanel[] = []
  if (sides.length === 2 && clippers) {
    const other = sides.find((s) => s !== clippers)!
    const word = teamWord(clippers.team)
    panels.push(
      { key: 'got', title: `${word} got`, team: clippers.team, aside: `from ${teamPlace(other.team)}`, assets: clippers.received },
      { key: 'gave', title: `${word} gave`, team: other.team, aside: `to ${teamPlace(other.team)}`, assets: clippers.sent.filter((a) => a.counterparty != null) },
    )
    const unsent = other.received.filter((a) => a.counterparty == null)
    if (unsent.length) {
      panels.push({ key: noSenderKey(other.team.franchise_id), title: `${teamWord(other.team)} got`, team: other.team, aside: NO_SENDER, assets: unsent })
    }
  } else {
    for (const s of sides) panels.push({ key: String(s.team.franchise_id), title: `${teamWord(s.team)} got`, team: s.team, aside: null, assets: s.received })
  }
  const rest = orphans(sides)
  if (rest.length) panels.push({ key: 'none', title: NO_RECEIVER, team: null, aside: null, assets: rest })
  return panels
}

export interface RootRow {
  node: TreeNode
  /** The trade asset the row was matched to (by label); null when none matched. */
  asset: TradeAsset | null
  title: string
  /** Mono detail after the title: the pick's original team. */
  meta: string | null
  /** Logo abbreviation for the row's mark (a pick's original team). */
  logo: string | null
  glyph: 'person' | 'pick' | 'swap' | 'cash' | 'other'
}

/** Pairs each top-level outline row with its trade asset (matched by label) for a compact title and mark. */
export function rootRows(became: TreeNode[], sides: TradeSide[]): RootRow[] {
  const pool = [...sides.flatMap((s) => s.received), ...orphans(sides)]
  const used = new Set<number>()
  return became.map((node, i) => {
    // The builder orders rows like the sides' received lists; the label check guards that assumption.
    const at = !used.has(i) && pool[i]?.label === node.label ? i : pool.findIndex((a, j) => !used.has(j) && a.label === node.label)
    if (at >= 0) used.add(at)
    const a = at >= 0 ? pool[at] : null
    if (a?.pick) {
      const abbr = a.pick.original_team.abbreviation
      return { node, asset: a, title: `${a.pick.draft_year} ${ordinal(a.pick.round)}`, meta: abbr, logo: abbr, glyph: 'pick' }
    }
    if (a?.swap) return { node, asset: a, title: `${a.swap.draft_year} ${ordinal(a.swap.round)} swap`, meta: null, logo: null, glyph: 'swap' }
    const glyph: RootRow['glyph'] = node.person ? 'person' : node.kind === 'pick' ? 'pick' : node.kind === 'swap' ? 'swap' : node.kind === 'cash' ? 'cash' : 'other'
    return { node, asset: a, title: capitalize(node.label), meta: null, logo: null, glyph }
  })
}

export interface TreeGroup {
  key: string
  heading: string
  team: FranchiseTeamRef | null
  rows: RootRow[]
}

/** Top-level outline rows grouped by who received them, headed like the side panels. */
export function treeGroups(became: TreeNode[], sides: TradeSide[]): TreeGroup[] {
  const panels = sidePanels(sides).filter((p) => p.team)
  const rows = rootRows(became, sides)
  const groups: TreeGroup[] = []
  for (const r of rows) {
    const fid = r.node.team?.franchise_id ?? null
    // A part with an unstated sender has its own panel in a two-team deal: never "Clippers gave".
    const unsent = fid == null || r.asset?.counterparty != null ? null : panels.find((p) => p.key === noSenderKey(fid))
    const panel = unsent ?? (fid == null ? null : panels.find((p) => p.team!.franchise_id === fid && p.aside !== NO_SENDER))
    const key = unsent ? unsent.key : fid == null ? 'none' : String(fid)
    let g = groups.find((x) => x.key === key)
    if (!g) {
      const heading = unsent ? `${unsent.title} · ${NO_SENDER}` : panel?.title ?? (fid == null ? NO_RECEIVER : `${teamWord(r.node.team)} got`)
      g = { key, heading, team: panel?.team ?? r.node.team, rows: [] }
      groups.push(g)
    }
    g.rows.push(r)
  }
  return [...groups.filter((g) => g.key !== 'none'), ...groups.filter((g) => g.key === 'none')]
}
