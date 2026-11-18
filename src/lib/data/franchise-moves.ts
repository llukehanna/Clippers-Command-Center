// src/lib/data/franchise-moves.ts
// GET /api/franchise/moves — every Clippers move (involves_clippers = true), newest first.
// League rows kept only for trade trees (involves_clippers = false) never appear here.
//
// Query params:
//   season  season_id (start year), e.g. 2019; or `latest` = the newest season with a move matching
//           type and player (echoed back as that season in filters.season; null when there is none)
//   type    kind group (R2): trade | signing | release | draft | other | all (absent = all)
//   player  person_key (R3), exact
//   player_id  players.player_id (via person_xref.player_id): the player page's moves
//   limit   1-50 rows (absent = all)
//   sort    `significance` = trades first, then by number of parts, then newest (absent = newest first)
//
// season_counts (moves per season for the type and player filters, ignoring season) feeds the
// era ribbon; player is the filtered person (null without a player filter or when unknown).
// seasons and season_counts scan every season, so a bounded request (limit or player_id: the
// History strip, the player page) skips them and gets [] for both, unless season=latest needs them.

import { type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { CLIPPERS_FRANCHISE_ID } from '@/src/lib/franchise/franchise-ids';
import { tradeHref } from '@/src/lib/franchise/trade-tree';
import type { MoveKindGroup, MoveRow, MoveTypeFilter } from '@/src/lib/ui/types';
import { badRequest, internalError, ok, personRef } from './franchise-common';
import { resolveTeams } from './franchise-teams';

const TTL = 3600;

/** Kinds in each named group; 'other' is every kind outside them. */
export const KIND_GROUPS: Record<Exclude<MoveKindGroup, 'other'>, string[]> = {
  trade: ['trade'],
  signing: ['signing', 're_signing', 'extension', 'two_way', 'ten_day', 'conversion'],
  release: ['waiver', 'claim', 'release'],
  draft: ['draft', 'expansion_draft'],
};
const NAMED_KINDS = Object.values(KIND_GROUPS).flat();
const TYPES: MoveTypeFilter[] = ['trade', 'signing', 'release', 'draft', 'other', 'all'];

export function kindGroup(kind: string): MoveKindGroup {
  for (const [group, kinds] of Object.entries(KIND_GROUPS)) if (kinds.includes(kind)) return group as MoveKindGroup;
  return 'other';
}

interface TxnRow {
  transaction_id: string;
  slug: string;
  date: string | null;
  season_id: number | null;
  kind: string;
  description: string;
  is_complete: boolean;
}

interface PlayerRow {
  display_name: string;
  player_id: string | null;
  nba_person_id: number | string | null;
}

interface PartRow {
  transaction_id: string;
  from_franchise_id: number | null;
  to_franchise_id: number | null;
  person_key: string | null;
  display_name: string | null;
  player_id: string | null;
  nba_person_id: number | string | null;
}

export async function loadFranchiseMoves(url: URL): Promise<ApiResult> {
  const seasonParam = url.searchParams.get('season');
  const typeParam = url.searchParams.get('type');
  const playerParam = url.searchParams.get('player')?.trim() || null;
  const playerIdParam = url.searchParams.get('player_id');
  const limitParam = url.searchParams.get('limit');
  const sortParam = url.searchParams.get('sort');

  if (seasonParam != null && seasonParam !== 'latest' && !/^\d{4}$/.test(seasonParam)) {
    return badRequest('season must be a four-digit season start year or latest');
  }
  if (typeParam != null && !TYPES.includes(typeParam as MoveTypeFilter)) {
    return badRequest(`type must be one of ${TYPES.join(', ')}`);
  }
  if (playerIdParam != null && !/^\d{1,15}$/.test(playerIdParam)) return badRequest('player_id must be a numeric player id');
  if (limitParam != null && !(/^\d{1,2}$/.test(limitParam) && Number(limitParam) >= 1 && Number(limitParam) <= 50)) {
    return badRequest('limit must be an integer from 1 to 50');
  }
  if (sortParam != null && sortParam !== 'significance') return badRequest('sort must be significance');
  const playerId = playerIdParam;
  const limit = limitParam == null ? null : Number(limitParam);
  const bySignificance = sortParam === 'significance';
  const type = (typeParam as MoveTypeFilter | null) ?? null;
  const include = type && type !== 'all' && type !== 'other' ? KIND_GROUPS[type] : null;
  const exclude = type === 'other' ? NAMED_KINDS : null;

  const aggregates = seasonParam === 'latest' || (limit == null && playerId == null);

  try {
    const [seasonRows, countRows, playerRows] = await Promise.all([
      !aggregates ? Promise.resolve([] as { season_id: number }[]) : sql<{ season_id: number }[]>`
        SELECT DISTINCT season_id FROM transactions
        WHERE involves_clippers = true AND season_id IS NOT NULL
        ORDER BY season_id DESC
      `,
      // Per-season counts for the same type and player filters, across every season (the Moves era ribbon).
      !aggregates ? Promise.resolve([] as { season_id: number; n: number | string }[]) : sql<{ season_id: number; n: number | string }[]>`
        SELECT s.season_id, count(*)::int AS n
        FROM transactions s
        WHERE s.involves_clippers = true AND s.season_id IS NOT NULL
          AND (${include}::text[] IS NULL OR s.kind = ANY(${include}::text[]))
          AND (${exclude}::text[] IS NULL OR NOT (s.kind = ANY(${exclude}::text[])))
          AND (${playerParam}::text IS NULL OR EXISTS (
                SELECT 1 FROM transaction_parts sp
                WHERE sp.transaction_id = s.transaction_id AND sp.person_key = ${playerParam}::text))
        GROUP BY s.season_id
        ORDER BY s.season_id DESC
      `,
      playerParam == null
        ? Promise.resolve([] as PlayerRow[])
        : sql<PlayerRow[]>`
            SELECT x.display_name, x.player_id::text AS player_id, COALESCE(x.nba_person_id, pl.nba_person_id) AS nba_person_id
            FROM person_xref x
            LEFT JOIN players pl ON pl.player_id = x.player_id
            WHERE x.person_key = ${playerParam}::text
          `,
    ]);

    const seasonCounts = countRows.map((r) => ({ season_id: r.season_id, count: Number(r.n) }));
    // season=latest: the newest season with a move matching type and player (the Moves page default).
    const season = seasonParam == null ? null : seasonParam === 'latest' ? (seasonCounts[0]?.season_id ?? null) : Number(seasonParam);
    const nothing = seasonParam === 'latest' && season == null;

    const txns = nothing ? [] : await sql<TxnRow[]>`
      SELECT t.transaction_id::text AS transaction_id, t.slug, t.date::text AS date, t.season_id,
             t.kind, t.description, t.is_complete
      FROM transactions t
      WHERE t.involves_clippers = true
        AND (${season}::int IS NULL OR t.season_id = ${season}::int)
        AND (${include}::text[] IS NULL OR t.kind = ANY(${include}::text[]))
        AND (${exclude}::text[] IS NULL OR NOT (t.kind = ANY(${exclude}::text[])))
        AND (${playerParam}::text IS NULL OR EXISTS (
              SELECT 1 FROM transaction_parts pp
              WHERE pp.transaction_id = t.transaction_id AND pp.person_key = ${playerParam}::text))
        AND (${playerId}::bigint IS NULL OR EXISTS (
              SELECT 1 FROM transaction_parts ip
              JOIN person_xref ix ON ix.person_key = ip.person_key
              WHERE ip.transaction_id = t.transaction_id AND ix.player_id = ${playerId}::bigint))
      ORDER BY
        (${bySignificance}::boolean AND t.kind = 'trade') DESC,
        (CASE WHEN ${bySignificance}::boolean
              THEN (SELECT count(*) FROM transaction_parts sp WHERE sp.transaction_id = t.transaction_id)
              ELSE 0 END) DESC,
        t.date DESC NULLS LAST, t.transaction_id DESC
      LIMIT ${limit}::int
    `;

    const ids = txns.map((t) => t.transaction_id);
    const parts = ids.length === 0 ? [] : await sql<PartRow[]>`
      SELECT p.transaction_id::text AS transaction_id, p.from_franchise_id, p.to_franchise_id,
             p.person_key, x.display_name, x.player_id::text AS player_id, COALESCE(x.nba_person_id, pl.nba_person_id) AS nba_person_id
      FROM transaction_parts p
      LEFT JOIN person_xref x ON x.person_key = p.person_key
      LEFT JOIN players pl ON pl.player_id = x.player_id
      WHERE p.transaction_id = ANY(${ids}::bigint[])
      ORDER BY p.part_id
    `;

    const partsByTxn = new Map<string, PartRow[]>();
    for (const p of parts) {
      const list = partsByTxn.get(p.transaction_id) ?? [];
      list.push(p);
      partsByTxn.set(p.transaction_id, list);
    }

    const franchisesOf = (t: TxnRow): number[] => {
      const seen: number[] = [];
      for (const p of partsByTxn.get(t.transaction_id) ?? []) {
        for (const f of [p.from_franchise_id, p.to_franchise_id]) if (f != null && !seen.includes(f)) seen.push(f);
      }
      return [...seen.filter((f) => f === CLIPPERS_FRANCHISE_ID), ...seen.filter((f) => f !== CLIPPERS_FRANCHISE_ID)];
    };
    const team = await resolveTeams(txns.flatMap((t) => franchisesOf(t).map((f): [number, number | null] => [f, t.season_id])));

    const moves: MoveRow[] = txns.map((t) => {
      const people = new Map<string, ReturnType<typeof personRef>>();
      for (const p of partsByTxn.get(t.transaction_id) ?? []) {
        if (p.person_key && !people.has(p.person_key)) people.set(p.person_key, personRef(p.person_key, p.display_name, p.player_id, p.nba_person_id));
      }
      return {
        slug: t.slug,
        date: t.date,
        season_id: t.season_id,
        kind: t.kind,
        kind_group: kindGroup(t.kind),
        description: t.description,
        is_complete: t.is_complete,
        href: t.kind === 'trade' ? tradeHref(t.slug) : null,
        teams: franchisesOf(t).map((f) => team(f, t.season_id)),
        people: [...people.values()],
      };
    });

    return ok({
      filters: { season, type, player: playerParam },
      seasons: seasonRows.map((r) => r.season_id),
      season_counts: seasonCounts,
      player:
        playerParam == null || !playerRows[0]
          ? null
          : personRef(playerParam, playerRows[0].display_name, playerRows[0].player_id, playerRows[0].nba_person_id),
      moves,
    }, TTL);
  } catch (err) {
    return internalError('/api/franchise/moves', err);
  }
}
