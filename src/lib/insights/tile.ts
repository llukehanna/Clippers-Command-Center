// src/lib/insights/tile.ts
// Everything an insight tile shows besides its text, in one pure call. A
// legacy or live card (frame null, not a merged team-yoy card) is plain: no
// chip, no visual, no Receipts, no sample, and it never throws.
// DB-free, relative imports only.
import { insightCategoryLabel } from '../format';
import type { InsightCardData } from './card';
import { receiptTable, sampleLabel, type ReceiptTable } from './receipts';
import { visualDrawable } from './kit-geometry';
import { teamYoyChip } from './team-yoy';
import { fmtDate, fmtShort } from './time';
import { bigFigure, pickVisual, type CardVisual } from './visual';
import { whyChip, type WhyChip } from './why';

export interface TileParts {
  plain: boolean;
  chip: WhyChip | null;
  visual: CardVisual | null;
  receipts: ReceiptTable | null;
  sample: string | null;
  big: { n: string; unit: string } | null;
}

const PLAIN: TileParts = { plain: true, chip: null, visual: null, receipts: null, sample: null, big: null };

export function isPlainCard(card: InsightCardData): boolean {
  return card.frame == null && !(Array.isArray(card.team_yoy) && card.team_yoy.length > 0);
}

/**
 * The tile header's two lines. With the subject shown: his name (or
 * "Clippers") over the context label. Without it (player page): the context
 * label over the category topic, the topic dropped when it repeats the label.
 */
export function headerLines(card: InsightCardData, showSubject: boolean): { name: string; sub: string | null } {
  if (showSubject) return { name: card.subject.name, sub: card.context_label || null };
  const topic = insightCategoryLabel(card.category);
  const sub = topic && topic.toLowerCase() !== card.context_label.toLowerCase() ? topic : null;
  return { name: card.context_label, sub };
}

/** The compact row's mono meta line: "Nov 13 · vs OKC", never the date twice. */
export function compactMeta(card: InsightCardData): string {
  const ctx = card.context_label;
  if (!card.fact_date) return ctx;
  const date = fmtShort(card.fact_date);
  if (!ctx || ctx === date) return date;
  return ctx.startsWith(`${date} ·`) ? ctx : `${date} · ${ctx}`;
}

/** The page a card sits on, so it never links back to itself. */
export type CardPage = { kind: 'game'; game_id: string } | { kind: 'player'; player_id: string };

/**
 * Where a card links on a page. On a game page, a card about that game is
 * unlinked (it would open the page it is on). On a player page, a card opens
 * its game when it has one and is otherwise unlinked. Elsewhere: card.href.
 */
export function cardHref(card: InsightCardData, page?: CardPage): string | null {
  if (!page) return card.href;
  if (page.kind === 'player') return card.game_id ? `/history/${card.game_id}` : null;
  return card.href === `/history/${page.game_id}` ? null : card.href;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** True when the card's header (or compact meta) shows its game line: "Nov 17 · W 120-100 vs UTA". */
export function showsGameLine(card: InsightCardData): boolean {
  return !!card.game_id && !!card.fact_date && card.context_label.startsWith(`${fmtShort(card.fact_date)} ·`);
}

/**
 * The card's detail line, or null when it only restates the game the header
 * already shows ("Nov 17, 2026 vs the Utah Jazz" under "Nov 17 · W 120-100 vs
 * UTA"), as a postgame milestone written exactly on its mark does.
 */
export function shownDetail(card: InsightCardData): string | null {
  const d = card.detail;
  if (!d || !card.fact_date || !showsGameLine(card)) return d || null;
  const onlyGame = new RegExp(`^${escapeRe(fmtDate(card.fact_date))}\\s+(?:vs|at)\\s+(?:the\\s+)?[^,.;·]+$`, 'i');
  return onlyGame.test(d.trim()) ? null : d;
}

/**
 * A scouting card's headline without the stored "Up next: " / "Next opponent: "
 * prefix (the panel already says who is next), first letter capitalized.
 * Cosmetic only: the rest of the stored headline is shown as written.
 */
export function scoutHeadline(headline: string): string {
  const rest = headline.replace(/^\s*(?:up next|next opponent)\s*:\s*/i, '');
  if (rest === headline || rest === '') return headline;
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

export function tileParts(card: InsightCardData): TileParts {
  if (isPlainCard(card)) return PLAIN;
  // Only a visual the kit can actually draw counts: the hero's two-column
  // layout and big figure hang off it.
  const picked = pickVisual(card);
  const visual = picked && visualDrawable(picked) ? picked : null;
  const yoy = Array.isArray(card.team_yoy) && card.team_yoy.length > 0 ? card.team_yoy : null;
  return {
    plain: false,
    chip: yoy ? teamYoyChip(yoy) : whyChip(card),
    visual,
    receipts: receiptTable(card),
    sample: sampleLabel(card),
    big: visual ? bigFigure(visual) : null,
  };
}
