// src/lib/data/franchise-picks.ts
// GET /api/franchise/picks — future picks and swaps the Clippers own and owe.
//   owned: future picks the Clippers hold (their own and others'), and swap rights they hold;
//   owed:  the Clippers' own future picks someone else holds, and swap rights they gave.
// Each carries protections exactly as stored — unknown stays null — plus a plain-words
// label ("Protections not recorded" unless protections_known is true), and the trade
// it came in (owned) or went out in (owed).

import { type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { CLIPPERS_FRANCHISE_ID } from '@/src/lib/franchise/franchise-ids';
import { protectionsLabel } from '@/src/lib/franchise/protections-text';
import { gapNote, pickSeason, tradeHref } from '@/src/lib/franchise/trade-tree';
import type { OwedAsset, TradeLink } from '@/src/lib/ui/types';
import { internalError, ok } from './franchise-common';
import { resolveTeams } from './franchise-teams';

const TTL = 3600;
const LAC = CLIPPERS_FRANCHISE_ID;

interface PickRow {
  pick_id: number;
  pick_key: string;
  draft_year: number;
  round: number;
  original_franchise_id: number;
  protections: unknown | null;
  protections_text: string | null;
  protections_known: boolean | null;
  final_owner_franchise_id: number | null;
}

interface HopRow {
  slug: string;
  date: string | null;
  season_id: number | null;
  kind: string;
  from_franchise_id: number | null;
  to_franchise_id: number | null;
  gap_reason: string | null;
}

interface SwapRow extends HopRow {
  swap_id: number;
  swap_key: string;
  draft_year: number;
  round: number;
  franchise_a: number;
  franchise_b: number;
  protections: unknown | null;
  protections_text: string | null;
  protections_known: boolean | null;
}

const link = (h: HopRow | undefined): TradeLink | null => (h ? { slug: h.slug, href: tradeHref(h.slug), date: h.date } : null);
const gapNotes = (hops: HopRow[]) => [...new Set(hops.map((h) => gapNote(h.gap_reason)).filter((n): n is string => n != null))];
const lastWhere = <T>(list: T[], pred: (x: T) => boolean): T | undefined => [...list].reverse().find(pred);

export async function loadFranchisePicks(): Promise<ApiResult> {
  try {
    const [picks, swapRows] = await Promise.all([
      sql<PickRow[]>`
        SELECT dp.pick_id, dp.pick_key, dp.draft_year, dp.round, dp.original_franchise_id,
               dp.protections, dp.protections_text, dp.protections_known, dp.final_owner_franchise_id
        FROM draft_picks dp
        WHERE dp.status = 'future'
          AND (dp.original_franchise_id = ${LAC}
               OR COALESCE(dp.final_owner_franchise_id, dp.original_franchise_id) = ${LAC})
        ORDER BY dp.draft_year, dp.round, dp.pick_key
      `,
      // Future swaps (not yet exercised or declined) with every part that moved the right.
      sql<SwapRow[]>`
        SELECT s.swap_id, s.swap_key, s.draft_year, s.round, s.franchise_a, s.franchise_b,
               s.protections, s.protections_text, s.protections_known,
               t.slug, t.date::text AS date, t.season_id, t.kind,
               p.from_franchise_id, p.to_franchise_id, p.gap_reason
        FROM pick_swaps s
        JOIN transaction_parts p ON p.swap_id = s.swap_id
        JOIN transactions t ON t.transaction_id = p.transaction_id
        WHERE s.exercised IS NULL AND (s.franchise_a = ${LAC} OR s.franchise_b = ${LAC})
        ORDER BY s.draft_year, s.round, s.swap_key, t.date NULLS LAST, t.transaction_id
      `,
    ]);

    const ids = picks.map((p) => p.pick_id);
    const hopRows = ids.length === 0 ? [] : await sql<Array<HopRow & { pick_id: number }>>`
      SELECT p.pick_id, t.slug, t.date::text AS date, t.season_id, t.kind,
             p.from_franchise_id, p.to_franchise_id, p.gap_reason
      FROM transaction_parts p
      JOIN transactions t ON t.transaction_id = p.transaction_id
      WHERE p.pick_id = ANY(${ids}::int[])
      ORDER BY t.date NULLS LAST, t.transaction_id, p.part_id
    `;
    const hopsByPick = new Map<number, HopRow[]>();
    for (const h of hopRows) {
      const list = hopsByPick.get(h.pick_id) ?? [];
      list.push(h);
      hopsByPick.set(h.pick_id, list);
    }
    const swaps = new Map<number, { swap: SwapRow; hops: HopRow[] }>();
    for (const r of swapRows) {
      const entry = swaps.get(r.swap_id) ?? { swap: r, hops: [] };
      entry.hops.push(r);
      swaps.set(r.swap_id, entry);
    }

    const keys: Array<[number, number | null]> = [];
    for (const p of picks) {
      keys.push([p.original_franchise_id, pickSeason(p.draft_year)]);
      if (p.final_owner_franchise_id != null) keys.push([p.final_owner_franchise_id, pickSeason(p.draft_year)]);
    }
    for (const { swap } of swaps.values()) {
      keys.push([swap.franchise_a, pickSeason(swap.draft_year)], [swap.franchise_b, pickSeason(swap.draft_year)]);
    }
    const team = await resolveTeams(keys);

    const owned: OwedAsset[] = [];
    const owed: OwedAsset[] = [];

    for (const p of picks) {
      const season = pickSeason(p.draft_year);
      const hops = hopsByPick.get(p.pick_id) ?? [];
      const ownerId = p.final_owner_franchise_id ?? p.original_franchise_id;
      const isOwned = ownerId === LAC;
      const isOwn = p.original_franchise_id === LAC;
      const original = team(p.original_franchise_id, season);
      const owner = team(ownerId, season);
      const asset: OwedAsset = {
        kind: 'pick',
        key: p.pick_key,
        draft_year: p.draft_year,
        round: p.round,
        original_team: original,
        owner,
        counterparty: isOwned ? (isOwn ? null : original) : owner,
        is_own: isOwn,
        protections: p.protections ?? null,
        protections_text: p.protections_text,
        protections_known: p.protections_known,
        protections_label: protectionsLabel(p),
        trade: link(isOwned
          ? lastWhere(hops, (h) => h.to_franchise_id === LAC)
          : lastWhere(hops, (h) => h.from_franchise_id === LAC)),
        gap_notes: gapNotes(hops),
      };
      (isOwned ? owned : owed).push(asset);
    }

    for (const { swap, hops } of swaps.values()) {
      const holder = hops.at(-1)?.to_franchise_id ?? null;
      const gave = lastWhere(hops, (h) => h.from_franchise_id === LAC);
      if (holder !== LAC && !gave) continue; // the Clippers neither hold nor gave this right
      const season = pickSeason(swap.draft_year);
      const other = swap.franchise_a === LAC ? swap.franchise_b : swap.franchise_a;
      const asset: OwedAsset = {
        kind: 'swap',
        key: swap.swap_key,
        draft_year: swap.draft_year,
        round: swap.round,
        original_team: null,
        owner: holder == null ? null : team(holder, season),
        counterparty: team(other, season),
        is_own: false,
        protections: swap.protections ?? null,
        protections_text: swap.protections_text,
        protections_known: swap.protections_known,
        protections_label: protectionsLabel(swap),
        trade: link(holder === LAC ? lastWhere(hops, (h) => h.to_franchise_id === LAC) : gave),
        gap_notes: gapNotes(hops),
      };
      (holder === LAC ? owned : owed).push(asset);
    }

    const order = (a: OwedAsset, b: OwedAsset) =>
      a.draft_year - b.draft_year || a.round - b.round || (a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind === 'pick' ? -1 : 1);
    return ok({ owned: owned.sort(order), owed: owed.sort(order) }, TTL);
  } catch (err) {
    return internalError('/api/franchise/picks', err);
  }
}
