// src/lib/data/franchise-draft.ts
// GET /api/franchise/draft — every pick the Clippers used, plus picks they owned
// (their own, or one they held) that someone else used. Grouped by year, newest first.
// Each pick carries "from X via Y" (original team, then the owners in between,
// from the trades that moved it) and its lottery row when there is one (1985 on).

import { type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { CLIPPERS_FRANCHISE_ID } from '@/src/lib/franchise/franchise-ids';
import { currentHolder } from '@/src/lib/franchise/pick-holder';
import { pickSeason, tradeHref } from '@/src/lib/franchise/trade-tree';
import type { DraftLottery, DraftPick, FranchiseTeamRef, PickHop } from '@/src/lib/ui/types';
import { internalError, num, ok, personRef } from './franchise-common';
import { resolveTeams } from './franchise-teams';

const TTL = 3600;
const LAC = CLIPPERS_FRANCHISE_ID;

interface PickRow {
  pick_id: number;
  pick_key: string;
  draft_year: number;
  round: number;
  original_franchise_id: number;
  status: string | null;
  overall_pick: number | null;
  final_owner_franchise_id: number | null;
  selected_person: string | null;
  display_name: string | null;
  player_id: string | null;
  nba_person_id: number | string | null;
  pre_lottery_slot: number | null;
  odds_first: string | number | null;
  pick_won: number | null;
  tie_unresolved: boolean | null;
  lottery_source: 'wiki' | 'derived' | null;
}

interface HopRow {
  pick_id: number;
  transaction_id: string;
  slug: string;
  date: string | null;
  season_id: number | null;
  kind: string;
  from_franchise_id: number | null;
  to_franchise_id: number | null;
}

function lotteryOf(r: PickRow): DraftLottery | null {
  if (r.lottery_source == null) return null;
  const slot = r.pre_lottery_slot;
  const won = r.pick_won;
  return {
    pre_lottery_slot: slot,
    odds_first: num(r.odds_first),
    pick_won: won,
    tie_unresolved: r.tie_unresolved,
    movement: slot == null || won == null ? null : won < slot ? 'jumped' : won > slot ? 'fell' : 'held',
    source: r.lottery_source,
  };
}

export async function loadFranchiseDraft(): Promise<ApiResult> {
  try {
    const picks = await sql<PickRow[]>`
      SELECT dp.pick_id, dp.pick_key, dp.draft_year, dp.round, dp.original_franchise_id, dp.status,
             dp.overall_pick, dp.final_owner_franchise_id, dp.selected_person,
             x.display_name, x.player_id::text AS player_id, COALESCE(x.nba_person_id, pl.nba_person_id) AS nba_person_id,
             l.pre_lottery_slot, l.odds_first, l.pick_won, l.tie_unresolved, l.source AS lottery_source
      FROM draft_picks dp
      LEFT JOIN person_xref x ON x.person_key = dp.selected_person
      LEFT JOIN players pl ON pl.player_id = x.player_id
      LEFT JOIN draft_lottery l ON l.pick_id = dp.pick_id AND l.draft_year = dp.draft_year
      WHERE COALESCE(dp.status, '') <> 'future'
        AND (dp.final_owner_franchise_id = ${LAC}
             OR dp.original_franchise_id = ${LAC}
             OR EXISTS (SELECT 1 FROM transaction_parts tp
                        WHERE tp.pick_id = dp.pick_id
                          AND (tp.from_franchise_id = ${LAC} OR tp.to_franchise_id = ${LAC})))
      ORDER BY dp.draft_year DESC, dp.round, dp.overall_pick NULLS LAST, dp.pick_key
    `;

    const ids = picks.map((p) => p.pick_id);
    const hops = ids.length === 0 ? [] : await sql<HopRow[]>`
      SELECT p.pick_id, t.transaction_id::text AS transaction_id, t.slug, t.date::text AS date, t.season_id, t.kind, p.from_franchise_id, p.to_franchise_id
      FROM transaction_parts p
      JOIN transactions t ON t.transaction_id = p.transaction_id
      WHERE p.pick_id = ANY(${ids}::int[])
      ORDER BY t.date NULLS LAST, t.transaction_id, p.part_id
    `;
    const hopsByPick = new Map<number, HopRow[]>();
    for (const h of hops) {
      const list = hopsByPick.get(h.pick_id) ?? [];
      list.push(h);
      hopsByPick.set(h.pick_id, list);
    }

    const keys: Array<[number, number | null]> = [];
    for (const p of picks) {
      keys.push([p.original_franchise_id, pickSeason(p.draft_year)]);
      if (p.final_owner_franchise_id != null) keys.push([p.final_owner_franchise_id, pickSeason(p.draft_year)]);
    }
    const draftYear = new Map(picks.map((p) => [p.pick_id, p.draft_year]));
    for (const h of hops) {
      for (const f of [h.from_franchise_id, h.to_franchise_id]) {
        if (f == null) continue;
        keys.push([f, h.season_id]); // chain: names at the trade
        keys.push([f, pickSeason(draftYear.get(h.pick_id)!)]); // via: names at the draft
      }
    }
    const team = await resolveTeams(keys);

    const years = new Map<number, DraftPick[]>();
    for (const p of picks) {
      const season = pickSeason(p.draft_year);
      const chainRows = hopsByPick.get(p.pick_id) ?? [];
      const chain: PickHop[] = chainRows.map((h) => ({
        slug: h.slug,
        date: h.date,
        href: h.kind === 'trade' ? tradeHref(h.slug) : null,
        from: h.from_franchise_id == null ? null : team(h.from_franchise_id, h.season_id),
        to: h.to_franchise_id == null ? null : team(h.to_franchise_id, h.season_id),
      }));
      // Used picks record who used them; otherwise the holder rule: the latest linked part's
      // receiver, or the original franchise when nothing links it.
      const ownerId = p.final_owner_franchise_id ?? currentHolder(p.original_franchise_id, chainRows);
      const viaIds: number[] = [];
      // Owners in order: each hop's sender (an acquisition we may not have recorded) then its receiver.
      for (const h of chainRows) {
        for (const f of [h.from_franchise_id, h.to_franchise_id]) {
          if (f != null && f !== p.original_franchise_id && f !== ownerId && !viaIds.includes(f)) viaIds.push(f);
        }
      }
      const via: FranchiseTeamRef[] = viaIds.map((f) => team(f, season));
      const pick: DraftPick = {
        pick_key: p.pick_key,
        draft_year: p.draft_year,
        round: p.round,
        overall_pick: p.overall_pick,
        status: p.status,
        player: p.selected_person ? personRef(p.selected_person, p.display_name, p.player_id, p.nba_person_id) : null,
        original_team: team(p.original_franchise_id, season),
        via,
        owner: ownerId == null ? null : team(ownerId, season),
        traded_away: ownerId != null && ownerId !== LAC,
        chain,
        lottery: lotteryOf(p),
      };
      const list = years.get(p.draft_year) ?? [];
      list.push(pick);
      years.set(p.draft_year, list);
    }

    return ok({
      years: [...years.entries()].sort((a, b) => b[0] - a[0]).map(([draft_year, list]) => ({ draft_year, picks: list })),
    }, TTL);
  } catch (err) {
    return internalError('/api/franchise/draft', err);
  }
}
