// src/lib/data/franchise-contracts.ts
// GET /api/franchise/contracts — the current cap sheet (the newest contracts
// snapshot only; older snapshots never mix in) and payroll by season from 1984-85.

import { type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { formatSeasonLabel } from '@/src/lib/home-utils';
import type { ContractSeason, ContractsPayload, PayrollSeason } from '@/src/lib/ui/types';
import { internalError, isoTime, num, ok, personRef } from './franchise-common';

const TTL = 3600;
const FIRST_PAYROLL_SEASON = 1984;

interface ContractRow {
  snapshot_id: string;
  fetched_at: Date | string;
  person_key: string;
  display_name: string | null;
  player_id: string | null;
  season_id: number;
  amount_usd: string | number | null;
  guaranteed_usd: string | number | null;
  option: ContractSeason['option'];
}

interface PayrollRow {
  season_id: number;
  listed_players: number | null;
  roster_players: number | null;
  listed_total_usd: string | number | null;
  is_partial: boolean | null;
}

export async function loadFranchiseContracts(): Promise<ApiResult> {
  try {
    const [rows, payrollRows] = await Promise.all([
      sql<ContractRow[]>`
        WITH snap AS (
          SELECT snapshot_id FROM contracts
          ORDER BY fetched_at DESC, snapshot_id DESC
          LIMIT 1
        )
        SELECT c.snapshot_id, c.fetched_at, c.person_key, x.display_name, x.player_id::text AS player_id,
               c.season_id, c.amount_usd, c.guaranteed_usd, c.option
        FROM contracts c
        JOIN snap ON snap.snapshot_id = c.snapshot_id
        LEFT JOIN person_xref x ON x.person_key = c.person_key
        ORDER BY c.person_key, c.season_id
      `,
      sql<PayrollRow[]>`
        SELECT season_id, listed_players, roster_players, listed_total_usd, is_partial
        FROM payroll_seasons
        WHERE season_id >= ${FIRST_PAYROLL_SEASON}
        ORDER BY season_id DESC
      `,
    ]);

    const byPerson = new Map<string, ContractsPayload['players'][number]>();
    let fetchedAt: string | null = null;
    for (const r of rows) {
      const at = isoTime(r.fetched_at);
      if (at && (!fetchedAt || at > fetchedAt)) fetchedAt = at;
      let p = byPerson.get(r.person_key);
      if (!p) {
        p = { person: personRef(r.person_key, r.display_name, r.player_id), seasons: [] };
        byPerson.set(r.person_key, p);
      }
      p.seasons.push({ season_id: r.season_id, amount_usd: num(r.amount_usd), guaranteed_usd: num(r.guaranteed_usd), option: r.option });
    }
    const seasons = [...new Set(rows.map((r) => r.season_id))].sort((a, b) => a - b);
    const first = (p: ContractsPayload['players'][number]) => p.seasons[0]?.amount_usd ?? -1;
    const players = [...byPerson.values()].sort((a, b) => first(b) - first(a) || a.person.name.localeCompare(b.person.name));

    const totals = seasons.map((season_id) => {
      const amounts = players.flatMap((p) => p.seasons.filter((s) => s.season_id === season_id).map((s) => s.amount_usd));
      return { season_id, amount_usd: amounts.some((a) => a == null) ? null : amounts.reduce((a, b) => a! + b!, 0) };
    });

    const payroll: PayrollSeason[] = payrollRows.map((r) => ({
      season_id: r.season_id,
      season_label: formatSeasonLabel(r.season_id),
      listed_players: r.listed_players,
      roster_players: r.roster_players,
      listed_total_usd: num(r.listed_total_usd),
      is_partial: r.is_partial,
    }));

    return ok({
      snapshot_id: rows[0]?.snapshot_id ?? null,
      snapshot_fetched_at: fetchedAt,
      seasons,
      players,
      totals,
      payroll,
    }, TTL);
  } catch (err) {
    return internalError('/api/franchise/contracts', err);
  }
}
