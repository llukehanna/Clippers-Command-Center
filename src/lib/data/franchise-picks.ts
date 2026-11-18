// src/lib/data/franchise-picks.ts
// GET /api/franchise/picks — future picks and swaps the Clippers hold, owe, or may have traded.
//
// Holder rule (pipeline data model): draft_picks.final_owner_franchise_id stays NULL for
// future picks. A future pick's current holder is the to_franchise_id of its most recent
// linked transaction_parts row; with no linked part, it is the original franchise.
//   owned (held):  the Clippers hold it (their own or another team's);
//   owed:          a Clippers-original pick someone else holds;
//   uncertain:     a Clippers-original pick with no linked part sending it out, while a
//                  Clippers trade sent an unidentified pick (pick_id null, gap
//                  'pick_unidentified') of the same draft year and round — "may have been
//                  traded; details not recorded". Also a pick whose latest part has no receiver.
// Swaps: the holder of the right is the receiver of the swap's latest part.
// Draft-year floor: only drafts from the next one on (nextDraftYear, the pipeline's rule). The
// pipeline leaves a swap's exercised null unless a source says "not exercised", and a pick stays
// 'future' until the import after its draft, so neither field alone means "still to come".
//
// Protections are returned exactly as stored — unknown stays null — plus a plain-words label
// ("Protections not recorded" unless protections_known is true).

import { type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { nextDraftYear } from '@/src/lib/season';
import { CLIPPERS_FRANCHISE_ID } from '@/src/lib/franchise/franchise-ids';
import { byTime, currentHolder, mentionsPick } from '@/src/lib/franchise/pick-holder';
import { protectionsLabel } from '@/src/lib/franchise/protections-text';
import { gapNote, pickSeason, tradeHref } from '@/src/lib/franchise/trade-tree';
import type { OwedAsset, PickHolderStatus, TradeLink } from '@/src/lib/ui/types';
import { internalError, ok } from './franchise-common';
import { resolveTeams } from './franchise-teams';

const TTL = 3600;
const LAC = CLIPPERS_FRANCHISE_ID;

export const UNCERTAIN_NOTE = 'may have been traded; details not recorded';
export const HOLDER_UNKNOWN_NOTE = 'holder not recorded';

interface PickRow {
  pick_id: number;
  pick_key: string;
  draft_year: number;
  round: number;
  original_franchise_id: number;
  protections: unknown | null;
  protections_text: string | null;
  protections_known: boolean | null;
}

interface HopRow {
  transaction_id: string;
  slug: string;
  date: string | null;
  season_id: number | null;
  kind: string;
  from_franchise_id: number | null;
  to_franchise_id: number | null;
  gap_reason: string | null;
}

interface UnlinkedRow {
  transaction_id: string;
  slug: string;
  date: string | null;
  season_id: number | null;
  kind: string;
  unlinked_text: string | null;
  from_franchise_id: number | null;
  to_franchise_id: number | null;
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

/** A pick's place in the payload before team names are resolved. */
interface Placed {
  pick: PickRow;
  hops: HopRow[];
  status: PickHolderStatus;
  holderId: number | null;
  counterpartyId: number | null;
  trade: { slug: string; date: string | null } | undefined;
  note: string | null;
}

const link = (h: { slug: string; date: string | null } | undefined): TradeLink | null =>
  (h ? { slug: h.slug, href: tradeHref(h.slug), date: h.date } : null);
const gapNotes = (hops: HopRow[]) => [...new Set(hops.map((h) => gapNote(h.gap_reason)).filter((n): n is string => n != null))];
const lastWhere = <T>(list: T[], pred: (x: T) => boolean): T | undefined => [...list].reverse().find(pred);

/** Where a future pick belongs: held, owed, uncertain, or nowhere (another team's pick the Clippers passed on). */
export function placePick(pick: PickRow, linked: HopRow[], unlinked: UnlinkedRow[]): Placed | null {
  const hops = byTime(linked);
  const holderId = currentHolder(pick.original_franchise_id, hops);
  const isOwn = pick.original_franchise_id === LAC;
  const sentOut = hops.some((h) => h.from_franchise_id === LAC);
  const base = { pick, hops, holderId };

  if (holderId === LAC) {
    if (isOwn && !sentOut) {
      const maybe = lastWhere(byTime(unlinked), (u) => mentionsPick(u.unlinked_text, pick.draft_year, pick.round));
      if (maybe) {
        return { ...base, status: 'uncertain', holderId: null, counterpartyId: maybe.to_franchise_id, trade: maybe, note: UNCERTAIN_NOTE };
      }
    }
    const original = isOwn ? null : pick.original_franchise_id;
    return { ...base, status: 'held', counterpartyId: original, trade: lastWhere(hops, (h) => h.to_franchise_id === LAC), note: null };
  }
  if (holderId == null) {
    // The latest linked part names no receiver: the holder is unknown, never guessed.
    if (!isOwn && hops.at(-1)?.from_franchise_id !== LAC) return null;
    return { ...base, status: 'uncertain', counterpartyId: null, trade: hops.at(-1), note: HOLDER_UNKNOWN_NOTE };
  }
  if (!isOwn) return null;
  return { ...base, status: 'owed', counterpartyId: holderId, trade: lastWhere(hops, (h) => h.from_franchise_id === LAC), note: null };
}

export async function loadFranchisePicks(): Promise<ApiResult> {
  const floor = nextDraftYear();
  try {
    const [picks, swapRows, unlinked] = await Promise.all([
      sql<PickRow[]>`
        SELECT dp.pick_id, dp.pick_key, dp.draft_year, dp.round, dp.original_franchise_id,
               dp.protections, dp.protections_text, dp.protections_known
        FROM draft_picks dp
        WHERE dp.status = 'future'
          AND dp.draft_year >= ${floor}
          AND (dp.original_franchise_id = ${LAC}
               OR EXISTS (SELECT 1 FROM transaction_parts lp
                          WHERE lp.pick_id = dp.pick_id
                            AND (lp.from_franchise_id = ${LAC} OR lp.to_franchise_id = ${LAC})))
        ORDER BY dp.draft_year, dp.round, dp.pick_key
      `,
      // Future swaps (not yet exercised or declined, from the next draft on) with every part that moved the right.
      sql<SwapRow[]>`
        SELECT s.swap_id, s.swap_key, s.draft_year, s.round, s.franchise_a, s.franchise_b,
               s.protections, s.protections_text, s.protections_known,
               t.transaction_id::text AS transaction_id, t.slug, t.date::text AS date, t.season_id, t.kind,
               p.from_franchise_id, p.to_franchise_id, p.gap_reason
        FROM pick_swaps s
        JOIN transaction_parts p ON p.swap_id = s.swap_id
        JOIN transactions t ON t.transaction_id = p.transaction_id
        WHERE s.exercised IS NULL AND s.draft_year >= ${floor}
          AND (s.franchise_a = ${LAC} OR s.franchise_b = ${LAC})
        ORDER BY s.draft_year, s.round, s.swap_key, t.date NULLS LAST, t.transaction_id
      `,
      // Picks the Clippers sent that no source identified (the uncertain case).
      sql<UnlinkedRow[]>`
        SELECT t.transaction_id::text AS transaction_id, t.slug, t.date::text AS date, t.season_id, t.kind,
               u.unlinked_text, u.from_franchise_id, u.to_franchise_id
        FROM transaction_parts u
        JOIN transactions t ON t.transaction_id = u.transaction_id
        WHERE u.pick_id IS NULL AND u.gap_reason = 'pick_unidentified'
          AND u.asset_kind = 'pick' AND u.from_franchise_id = ${LAC}
        ORDER BY t.date NULLS LAST, t.transaction_id
      `,
    ]);

    const ids = picks.map((p) => p.pick_id);
    const hopRows = ids.length === 0 ? [] : await sql<Array<HopRow & { pick_id: number }>>`
      SELECT p.pick_id, t.transaction_id::text AS transaction_id, t.slug, t.date::text AS date, t.season_id, t.kind,
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

    const placed = picks
      .map((p) => placePick(p, hopsByPick.get(p.pick_id) ?? [], unlinked))
      .filter((x): x is Placed => x != null);

    const keys: Array<[number, number | null]> = [];
    for (const { pick, holderId, counterpartyId } of placed) {
      const season = pickSeason(pick.draft_year);
      for (const f of [pick.original_franchise_id, holderId, counterpartyId]) if (f != null) keys.push([f, season]);
    }
    for (const { swap, hops } of swaps.values()) {
      const season = pickSeason(swap.draft_year);
      keys.push([swap.franchise_a, season], [swap.franchise_b, season]);
      for (const h of hops) if (h.to_franchise_id != null) keys.push([h.to_franchise_id, season]);
    }
    const team = await resolveTeams(keys);

    const lists: Record<PickHolderStatus, OwedAsset[]> = { held: [], owed: [], uncertain: [] };

    for (const x of placed) {
      const { pick } = x;
      const season = pickSeason(pick.draft_year);
      lists[x.status].push({
        kind: 'pick',
        holder_status: x.status,
        key: pick.pick_key,
        draft_year: pick.draft_year,
        round: pick.round,
        original_team: team(pick.original_franchise_id, season),
        owner: x.holderId == null ? null : team(x.holderId, season),
        counterparty: x.counterpartyId == null ? null : team(x.counterpartyId, season),
        is_own: pick.original_franchise_id === LAC,
        protections: pick.protections ?? null,
        protections_text: pick.protections_text,
        protections_known: pick.protections_known,
        protections_label: protectionsLabel(pick),
        trade: link(x.trade),
        note: x.note,
        gap_notes: gapNotes(x.hops),
      });
    }

    for (const { swap, hops: raw } of swaps.values()) {
      const hops = byTime(raw);
      const holder = hops.at(-1)?.to_franchise_id ?? null;
      const gave = lastWhere(hops, (h) => h.from_franchise_id === LAC);
      if (holder !== LAC && !gave) continue; // the Clippers neither hold nor gave this right
      const season = pickSeason(swap.draft_year);
      const other = swap.franchise_a === LAC ? swap.franchise_b : swap.franchise_a;
      const status: PickHolderStatus = holder === LAC ? 'held' : holder == null ? 'uncertain' : 'owed';
      lists[status].push({
        kind: 'swap',
        holder_status: status,
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
        note: holder == null ? HOLDER_UNKNOWN_NOTE : null,
        gap_notes: gapNotes(hops),
      });
    }

    const order = (a: OwedAsset, b: OwedAsset) =>
      a.draft_year - b.draft_year || a.round - b.round || (a.kind === b.kind ? a.key.localeCompare(b.key) : a.kind === 'pick' ? -1 : 1);
    return ok({
      owned: lists.held.sort(order),
      owed: lists.owed.sort(order),
      uncertain: lists.uncertain.sort(order),
    }, TTL);
  } catch (err) {
    return internalError('/api/franchise/picks', err);
  }
}
