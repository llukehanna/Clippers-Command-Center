// src/lib/data/franchise-trade.ts
// GET /api/franchise/trades/{slug} — one trade: header, one side per franchise
// (Clippers first), gap notes, and the "What it became" outline (3 steps deep).
//
// The outline is built from stored rows only (league rows from 2015, counterparties'
// Wikipedia tables before then, pick chains in any era); nothing is fetched from
// outside at request time. Unknown slug (or a slug that is not a trade) → 404.

import { json, type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { buildError } from '@/src/lib/api-utils';
import {
  buildTradeTree, gapNote, TREE_DEPTH, treeTeamKeys,
  type TreePart, type TreePerson, type TreePick, type TreeSwap, type TreeTxn,
} from '@/src/lib/franchise/trade-tree';
import { internalError, ok } from './franchise-common';
import { resolveTeams } from './franchise-teams';

const TTL = 3600;

interface RootRow extends TreeTxn {
  description: string;
  is_complete: boolean;
  sources: string[] | null;
}

type PartRow = TreeTxn & TreePart;

const followsPerson = (p: TreePart) => p.person_key != null && (p.asset_kind === 'player' || p.asset_kind === 'draft_rights');

export async function loadFranchiseTrade(slug: string): Promise<ApiResult> {
  try {
    const [root] = await sql<RootRow[]>`
      SELECT t.transaction_id::text AS transaction_id, t.slug, t.date::text AS date, t.season_id, t.kind,
             t.involves_clippers, t.description, t.is_complete, t.sources
      FROM transactions t
      WHERE t.slug = ${slug}
    `;
    if (!root || root.kind !== 'trade') {
      return json(buildError('NOT_FOUND', `No trade with slug "${slug}"`), { status: 404 });
    }

    // Fetch the root's parts and every move of the assets it followed, widening the
    // asset set until it is stable: the root's people, picks and swaps, then the
    // people drafted with those picks.
    let persons: string[] = [];
    let pickIds: number[] = [];
    let swapIds: number[] = [];
    let rows: PartRow[] = [];
    let picks: TreePick[] = [];
    for (let round = 0; round < 4; round++) {
      rows = await sql<PartRow[]>`
        SELECT t.transaction_id::text AS transaction_id, t.slug, t.date::text AS date, t.season_id, t.kind,
               t.involves_clippers, p.from_franchise_id, p.to_franchise_id, p.asset_kind, p.person_key,
               p.pick_id, p.swap_id, p.unlinked_text, p.gap_reason
        FROM transaction_parts p
        JOIN transactions t ON t.transaction_id = p.transaction_id
        WHERE p.transaction_id = ${root.transaction_id}::bigint
           OR p.transaction_id IN (
                SELECT transaction_id FROM transaction_parts
                WHERE person_key = ANY(${persons}::text[])
                   OR pick_id = ANY(${pickIds}::int[])
                   OR swap_id = ANY(${swapIds}::int[]))
        ORDER BY t.date NULLS LAST, t.transaction_id, p.part_id
      `;
      const allPickIds = [...new Set(rows.map((r) => r.pick_id).filter((id): id is number => id != null))];
      picks = allPickIds.length === 0 ? [] : await sql<TreePick[]>`
        SELECT pick_id, pick_key, draft_year, round, original_franchise_id, protections, protections_text,
               protections_known, status, overall_pick, selected_person, final_owner_franchise_id
        FROM draft_picks
        WHERE pick_id = ANY(${allPickIds}::int[])
      `;

      const rootParts = rows.filter((r) => r.transaction_id === root.transaction_id);
      const rootPicks = new Set(rootParts.map((p) => p.pick_id).filter((id) => id != null));
      const nextPersons = [...new Set([
        ...rootParts.filter(followsPerson).map((p) => p.person_key!),
        ...picks.filter((p) => rootPicks.has(p.pick_id) && p.selected_person).map((p) => p.selected_person!),
      ])].sort();
      const nextPicks = [...rootPicks].map(Number).sort((a, b) => a - b);
      const nextSwaps = [...new Set(rootParts.map((p) => p.swap_id).filter((id): id is number => id != null))].sort((a, b) => a - b);
      const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((x, i) => x === b[i]);
      if (same(nextPersons, persons) && same(nextPicks, pickIds) && same(nextSwaps, swapIds)) break;
      persons = nextPersons;
      pickIds = nextPicks;
      swapIds = nextSwaps;
    }

    const allSwapIds = [...new Set(rows.map((r) => r.swap_id).filter((id): id is number => id != null))];
    const personKeys = [...new Set([
      ...rows.map((r) => r.person_key).filter((k): k is string => k != null),
      ...picks.map((p) => p.selected_person).filter((k): k is string => k != null),
    ])];
    const [swaps, people] = await Promise.all([
      allSwapIds.length === 0 ? Promise.resolve([] as TreeSwap[]) : sql<TreeSwap[]>`
        SELECT swap_id, swap_key, draft_year, round, franchise_a, franchise_b, protections_text,
               protections_known, exercised
        FROM pick_swaps
        WHERE swap_id = ANY(${allSwapIds}::int[])
      `,
      personKeys.length === 0 ? Promise.resolve([] as TreePerson[]) : sql<TreePerson[]>`
        SELECT x.person_key, x.display_name, x.player_id::text AS player_id, COALESCE(x.nba_person_id, pl.nba_person_id) AS nba_person_id
        FROM person_xref x
        LEFT JOIN players pl ON pl.player_id = x.player_id
        WHERE x.person_key = ANY(${personKeys}::text[])
      `,
    ]);

    const transactions = [...new Map(rows.map((r) => [r.transaction_id, {
      transaction_id: r.transaction_id, slug: r.slug, date: r.date, season_id: r.season_id,
      kind: r.kind, involves_clippers: r.involves_clippers,
    }])).values()];
    if (!transactions.some((t) => t.transaction_id === root.transaction_id)) transactions.push(root);
    const parts: TreePart[] = rows.map((r) => ({
      transaction_id: r.transaction_id, from_franchise_id: r.from_franchise_id, to_franchise_id: r.to_franchise_id,
      asset_kind: r.asset_kind, person_key: r.person_key, pick_id: r.pick_id, swap_id: r.swap_id,
      unlinked_text: r.unlinked_text, gap_reason: r.gap_reason,
    }));
    const base = { transactions, parts, picks, swaps, people };
    const team = await resolveTeams(treeTeamKeys(base));
    const { sides, became } = buildTradeTree(root.slug, { ...base, team }, TREE_DEPTH);

    const rootParts = parts.filter((p) => p.transaction_id === root.transaction_id);
    return ok({
      trade: {
        slug: root.slug,
        date: root.date,
        season_id: root.season_id,
        kind: root.kind,
        description: root.description,
        is_complete: root.is_complete,
        involves_clippers: root.involves_clippers,
        sources: root.sources ?? [],
      },
      teams: sides.map((s) => s.team),
      sides,
      gap_notes: [...new Set(rootParts.map((p) => gapNote(p.gap_reason)).filter((n): n is string => n != null))],
      became,
    }, TTL);
  } catch (err) {
    return internalError(`/api/franchise/trades/${slug}`, err);
  }
}
