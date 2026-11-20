// src/lib/franchise/display.ts
// Formatting for the /franchise tabs. Pure. Unknown stays unknown: null renders —.

import type { DraftLottery, DraftPick, FranchiseTeamRef, MovesPayload, MoveTypeFilter } from '@/src/lib/ui/types'
import { PICK_STATUS_NOTES } from './trade-tree'

export const UNKNOWN = '—'

/** A payroll season's completeness: "partial", "recorded", or — when not recorded. */
export function partialWord(isPartial: boolean | null | undefined): string {
  return isPartial === true ? 'partial' : isPartial === false ? 'recorded' : UNKNOWN
}

/** "no further record" → "No further record". */
export const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** 2019 → "2019–20". */
export function seasonLabel(seasonId: number | null | undefined): string {
  if (seasonId == null) return UNKNOWN
  return `${seasonId}–${String((seasonId + 1) % 100).padStart(2, '0')}`
}

const day = (date: string) => new Date(`${date.slice(0, 10)}T12:00:00Z`)

/** "Jul 10, 2019"; — when unknown. */
export function moveDate(date: string | null | undefined): string {
  if (!date) return UNKNOWN
  return day(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

/** "Jul 2019"; — when unknown. */
export function monthYear(date: string | null | undefined): string {
  if (!date) return UNKNOWN
  return day(date).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

/** "$50.3M", "$750K"; — when unknown. */
export function money(usd: number | null | undefined): string {
  if (usd == null) return UNKNOWN
  if (usd === 0) return '$0'
  if (Math.abs(usd) >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M`
  return `$${Math.round(usd / 1000)}K`
}

/** draft_lottery.odds_first is a 0–1 fraction: 0.177 → "17.7%". */
export function oddsPercent(fraction: number | null | undefined): string {
  if (fraction == null) return UNKNOWN
  return `${(fraction * 100).toFixed(1)}%`
}

export function ordinal(n: number): string {
  const mod100 = n % 100
  if (mod100 >= 11 && mod100 <= 13) return `${n}th`
  return `${n}${{ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th'}`
}

const KIND_LABELS: Record<string, string> = {
  trade: 'Trade',
  signing: 'Signing',
  re_signing: 'Re-signing',
  extension: 'Extension',
  two_way: 'Two-way',
  ten_day: '10-day',
  conversion: 'Conversion',
  waiver: 'Waiver',
  claim: 'Claim',
  release: 'Release',
  draft: 'Draft',
  expansion_draft: 'Expansion draft',
}

export function kindLabel(kind: string): string {
  if (KIND_LABELS[kind]) return KIND_LABELS[kind]
  const words = kind.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

export interface LotteryText {
  entered: string
  odds: string
  outcome: string | null
  tone: 'pos' | 'neg' | 'default'
}

/** "Entered 8th · 2.8% odds · won No. 1, up 7". Movement only when both ends are known. */
export function lotteryLine(l: DraftLottery): LotteryText {
  const from = l.pre_lottery_slot
  const to = l.pick_won
  const entered = from == null ? `Entry slot ${UNKNOWN}` : `Entered ${ordinal(from)}`
  const odds = l.odds_first == null ? `odds ${UNKNOWN}` : `${oddsPercent(l.odds_first)} odds`
  if (to == null) return { entered, odds, outcome: null, tone: 'default' }
  if (from == null) return { entered, odds, outcome: `landed No. ${to}`, tone: 'default' }
  if (to < from) return { entered, odds, outcome: `won No. ${to}, up ${from - to}`, tone: 'pos' }
  if (to > from) return { entered, odds, outcome: `fell to No. ${to}, down ${to - from}`, tone: 'neg' }
  return { entered, odds, outcome: `stayed No. ${to}`, tone: 'default' }
}

export interface TextSegment {
  text: string
  /** Set when the segment is one of the given names. */
  name?: string
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Splits generated text around the people it names, so names can read brighter than the connective text. */
export function highlightNames(text: string, names: string[]): TextSegment[] {
  const list = [...new Set(names.filter((n) => n.trim()))].sort((a, b) => b.length - a.length)
  if (list.length === 0) return [{ text }]
  // Letters/digits on either side mean the match is inside a longer word.
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(${list.map(escapeRe).join('|')})(?![\\p{L}\\p{N}])`, 'gu')
  const out: TextSegment[] = []
  let last = 0
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0
    if (at > last) out.push({ text: text.slice(last, at) })
    out.push({ text: m[0], name: m[0] })
    last = at + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

export interface Era {
  key: 'BUF' | 'SDC' | 'LAC'
  name: string
  short: string
  first: number
  /** Last season start year; null = still current. */
  last: number | null
}

/** The franchise's three eras, by season start year. */
export const ERAS: Era[] = [
  { key: 'BUF', name: 'Buffalo Braves', short: 'BUF', first: 1970, last: 1977 },
  { key: 'SDC', name: 'San Diego Clippers', short: 'SD', first: 1978, last: 1983 },
  { key: 'LAC', name: 'Los Angeles Clippers', short: 'LA', first: 1984, last: null },
]

export function eraOf(seasonId: number): Era {
  return ERAS.find((e) => seasonId >= e.first && (e.last == null || seasonId <= e.last)) ?? ERAS[ERAS.length - 1]
}

/** "Philadelphia"; the era name or abbreviation when the city is unknown. */
export function teamPlace(t: FranchiseTeamRef | null | undefined): string {
  if (!t) return 'an unknown team'
  return t.city ?? t.name ?? t.abbreviation ?? 'an unknown team'
}

/** "Philadelphia’s", "Dallas’". */
export function possessive(t: FranchiseTeamRef | null | undefined): string {
  const place = teamPlace(t)
  return place.endsWith('s') ? `${place}’` : `${place}’s`
}

export interface MovesFilters {
  /** A season start year; 'all' (Trades or a player filter only: both bounded); null = the default, the latest season with matching moves. */
  season: number | 'all' | null
  type: MoveTypeFilter
  player: string | null
}

/** "All seasons" is offered only where the list stays bounded: Trades, or one player's moves. */
export function allowsAllSeasons(f: Pick<MovesFilters, 'type' | 'player'>): boolean {
  return f.type === 'trade' || f.player != null
}

/** The Moves type tabs, in tab order (the /franchise/moves/<type> segments). */
export const MOVE_TYPES: MoveTypeFilter[] = ['trade', 'signing', 'release', 'draft', 'other', 'all']

/** A /franchise/moves/<type> segment; null for anything else. */
export function parseMoveType(raw: string | undefined): MoveTypeFilter | null {
  return MOVE_TYPES.find((t) => t === raw) ?? null
}

/**
 * A person_key as a /franchise/person/<key> segment. Next prerenders a param
 * with only the path delimiters escaped, and a request whose path escapes more
 * (nba%3A123 for nba:123) misses the page, so the colon (nba:… keys) stays raw.
 */
export function personSegment(key: string): string {
  return encodeURIComponent(key).replace(/%3A/gi, ':')
}

/** Person keys whose segment is the key itself, so the link and the prerendered path agree. */
export const PATH_SAFE_PERSON_KEY = /^[A-Za-z0-9._~:-]+$/

/**
 * Moves URL, one prerendered page each: /franchise (trades, latest season),
 * /franchise/moves/<type> (that type's latest season), /franchise/moves/<type>/<season|all>.
 * Any player filter goes to that person's page, where type and season are in-page
 * toggles (no URL state). 'all' seasons where it isn't offered falls back to the latest.
 */
export function movesHref(f: MovesFilters): string {
  if (f.player) return `/franchise/person/${personSegment(f.player)}`
  const season = f.season === 'all' && !allowsAllSeasons(f) ? null : f.season
  if (season == null) return f.type === 'trade' ? '/franchise' : `/franchise/moves/${f.type}`
  return `/franchise/moves/${f.type}/${season}`
}

/** Reads the Moves season segment: a year, 'all' where allowed, else null. */
export function parseMovesSeason(raw: string | undefined, f: Pick<MovesFilters, 'type' | 'player'>): MovesFilters['season'] {
  if (raw && /^\d{4}$/.test(raw)) return Number(raw)
  if (raw === 'all' && allowsAllSeasons(f)) return 'all'
  return null
}

/**
 * A person page's view under in-page type/season filters, from that person's
 * all-types, all-seasons list: what /api/franchise/moves returns for the same
 * filters (rows of the type, per-season counts for the type, season null = the
 * latest season with a matching move), plus the filters as the page shows them.
 */
export function personMoves(all: MovesPayload, f: MovesFilters): { filters: MovesFilters; data: MovesPayload } {
  const ofType = f.type === 'all' ? all.moves : all.moves.filter((m) => m.kind_group === f.type)
  const counts = new Map<number, number>()
  for (const m of ofType) if (m.season_id != null) counts.set(m.season_id, (counts.get(m.season_id) ?? 0) + 1)
  const season_counts = [...counts].map(([season_id, count]) => ({ season_id, count })).sort((a, b) => b.season_id - a.season_id)
  const season = f.season === 'all' ? null : (f.season ?? season_counts[0]?.season_id ?? null)
  const moves = f.season === 'all' ? ofType : season == null ? [] : ofType.filter((m) => m.season_id === season)
  return {
    filters: { season: f.season === 'all' ? 'all' : season, type: f.type, player: f.player },
    data: { ...all, filters: { season, type: f.type, player: f.player }, season_counts, moves },
  }
}

/** Neighbours of `current` in a newest-first list of seasons (current need not be in it). */
export function adjacentSeasons(seasons: number[], current: number): { newer: number | null; older: number | null } {
  const newer = seasons.filter((s) => s > current)
  const older = seasons.filter((s) => s < current)
  return { newer: newer.length ? Math.min(...newer) : null, older: older.length ? Math.max(...older) : null }
}

/** Groups rows by season_id, keeping first-seen order; rows without a season go last. */
export function groupBySeason<T extends { season_id: number | null }>(rows: T[]): Array<{ season_id: number | null; rows: T[] }> {
  const groups = new Map<number | null, T[]>()
  for (const r of rows) {
    const list = groups.get(r.season_id) ?? []
    list.push(r)
    groups.set(r.season_id, list)
  }
  const out = [...groups.entries()].map(([season_id, list]) => ({ season_id, rows: list }))
  return [...out.filter((g) => g.season_id != null), ...out.filter((g) => g.season_id == null)]
}

/** The six Franchise tabs, one URL each. */
export const FRANCHISE_TABS = [
  { value: 'moves', label: 'Moves', href: '/franchise' },
  { value: 'draft', label: 'Draft', href: '/franchise/draft' },
  { value: 'contracts', label: 'Contracts', href: '/franchise/contracts' },
  { value: 'picks', label: 'Picks owed', href: '/franchise/picks' },
  { value: 'front-office', label: 'Front office', href: '/franchise/front-office' },
  { value: 'honors', label: 'Honors', href: '/franchise/honors' },
] as const

/** Active tab for a pathname. Anything else under /franchise (trade pages: /franchise/trades/…) belongs to Moves. */
export function franchiseTab(pathname: string): string {
  const seg = pathname.replace(/^\/franchise\/?/, '').split('/')[0]
  return FRANCHISE_TABS.some((t) => t.value === seg) ? seg : 'moves'
}

/** How a Draft-tab row reads. Status first: only a used pick has a player or a "traded to" line. */
export interface DraftPickOutcome {
  /** used: the Clippers used it; traded: someone else used it; other: never used (label says why). */
  view: 'used' | 'traded' | 'other'
  label: string | null
}

export function draftPickOutcome(p: Pick<DraftPick, 'status' | 'traded_away'>): DraftPickOutcome {
  if (p.status === 'used') return { view: p.traded_away ? 'traded' : 'used', label: null }
  const note = p.status != null && p.status !== 'future' ? PICK_STATUS_NOTES[p.status] : undefined
  return { view: 'other', label: note ? capitalize(note) : 'Outcome not recorded' }
}

/** "2 picks · 1 traded · 1 forfeited": only used picks count as picks. */
export function draftYearMeta(picks: Array<Pick<DraftPick, 'status' | 'traded_away'>>): string {
  const outcomes = picks.map(draftPickOutcome)
  const used = outcomes.filter((o) => o.view === 'used').length
  const traded = outcomes.filter((o) => o.view === 'traded').length
  const other = new Map<string, number>()
  for (const o of outcomes) if (o.view === 'other') other.set(o.label!.toLowerCase(), (other.get(o.label!.toLowerCase()) ?? 0) + 1)
  return [
    used ? `${used} pick${used === 1 ? '' : 's'}` : null,
    traded ? (used ? `${traded} traded` : `${traded} traded away`) : null,
    ...[...other].map(([label, n]) => `${n} ${label}`),
  ]
    .filter(Boolean)
    .join(' · ')
}

