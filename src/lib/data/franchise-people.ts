// src/lib/data/franchise-people.ts
// GET /api/franchise/people — every person in a Clippers move (involves_clippers = true), by name,
// with how many of those moves they appear in. Feeds the Moves player search, so the client never
// has to load every move to search by name.

import { type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import type { MovePerson } from '@/src/lib/ui/types';
import { internalError, ok, personRef } from './franchise-common';

const TTL = 3600;

interface PersonRow {
  person_key: string;
  display_name: string | null;
  player_id: string | null;
  nba_person_id: number | string | null;
  move_count: number | string;
}

export async function loadFranchisePeople(): Promise<ApiResult> {
  try {
    const rows = await sql<PersonRow[]>`
      SELECT p.person_key, x.display_name, x.player_id::text AS player_id,
             COALESCE(x.nba_person_id, pl.nba_person_id) AS nba_person_id,
             count(DISTINCT t.transaction_id)::int AS move_count
      FROM transaction_parts p
      JOIN transactions t ON t.transaction_id = p.transaction_id AND t.involves_clippers = true
      LEFT JOIN person_xref x ON x.person_key = p.person_key
      LEFT JOIN players pl ON pl.player_id = x.player_id
      WHERE p.person_key IS NOT NULL
      GROUP BY p.person_key, x.display_name, x.player_id, x.nba_person_id, pl.nba_person_id
      ORDER BY COALESCE(x.display_name, p.person_key), p.person_key
    `;
    const people: MovePerson[] = rows.map((r) => ({
      ...personRef(r.person_key, r.display_name, r.player_id, r.nba_person_id),
      move_count: Number(r.move_count),
    }));
    return ok({ people }, TTL);
  } catch (err) {
    return internalError('/api/franchise/people', err);
  }
}
