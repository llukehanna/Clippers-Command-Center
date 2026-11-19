// src/lib/insights/tile.ts
// Everything an insight tile shows besides its text, in one pure call. A
// legacy or live card (frame null, not a merged team-yoy card) is plain: no
// chip, no visual, no Receipts, no sample, and it never throws.
// DB-free, relative imports only.
import { insightCategoryLabel } from '../format';
import type { InsightCardData } from './card';
import { receiptTable, sampleLabel, type ReceiptTable } from './receipts';
import { fmtShort } from './time';
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

export function tileParts(card: InsightCardData): TileParts {
  if (isPlainCard(card)) return PLAIN;
  const visual = pickVisual(card);
  return {
    plain: false,
    chip: whyChip(card),
    visual,
    receipts: receiptTable(card),
    sample: sampleLabel(card),
    big: visual ? bigFigure(visual) : null,
  };
}
