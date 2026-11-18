// src/lib/data/franchise-teams.ts
// Era team names for (franchise, season) pairs, resolved in one query (R1):
//   1. that season's team_seasons row for the franchise;
//   2. else team_era_names covering the season, via the franchise's team_seasons.team_id;
//   3. else the franchise's latest team_seasons row;
//   4. else the static current tricode and name.
// Payloads carry the result so the UI never resolves team names itself.

import { sql } from '@/src/lib/db';
import { staticTeam } from '@/src/lib/franchise/franchise-ids';
import type { TeamLookup } from '@/src/lib/franchise/trade-tree';
import type { FranchiseTeamRef } from '@/src/lib/ui/types';

/** Stand-in season for "no season" (future picks): after every team_seasons row, inside the current era. */
const LATEST = 9999;

export interface TeamRow {
  franchise_id: number;
  season_id: number;
  ts_abbr: string | null; ts_name: string | null; ts_city: string | null;
  era_abbr: string | null; era_name: string | null; era_city: string | null;
  last_abbr: string | null; last_name: string | null; last_city: string | null;
}

const key = (f: number, s: number) => `${f}|${s}`;

/** One resolution row → a team, field by field: season row, then era row, then latest row, then static name. */
export function teamFromRow(r: TeamRow): FranchiseTeamRef {
  const fallback = staticTeam(r.franchise_id);
  return {
    franchise_id: r.franchise_id,
    abbreviation: r.ts_abbr ?? r.era_abbr ?? r.last_abbr ?? fallback.abbreviation,
    name: r.ts_name ?? r.era_name ?? r.last_name ?? fallback.name,
    city: r.ts_city ?? r.era_city ?? r.last_city ?? fallback.city,
    is_clippers: fallback.is_clippers,
  };
}

export async function resolveTeams(pairs: Array<[number, number | null]>): Promise<TeamLookup> {
  const unique = new Map<string, [number, number]>();
  for (const [f, s] of pairs) unique.set(key(f, s ?? LATEST), [f, s ?? LATEST]);

  const resolved = new Map<string, FranchiseTeamRef>();
  if (unique.size > 0) {
    const fids = [...unique.values()].map(([f]) => f);
    const sids = [...unique.values()].map(([, s]) => s);
    const rows = await sql<TeamRow[]>`
      SELECT q.f AS franchise_id, q.s AS season_id,
             ts.abbreviation AS ts_abbr, ts.name AS ts_name, ts.city AS ts_city,
             e.abbreviation AS era_abbr, e.name AS era_name, e.city AS era_city,
             l.abbreviation AS last_abbr, l.name AS last_name, l.city AS last_city
      FROM unnest(${fids}::int[], ${sids}::int[]) AS q(f, s)
      LEFT JOIN team_seasons ts ON ts.nba_franchise_id = q.f AND ts.season_id = q.s
      LEFT JOIN LATERAL (
        SELECT team_id FROM team_seasons
        WHERE nba_franchise_id = q.f AND team_id IS NOT NULL
        ORDER BY season_id DESC LIMIT 1
      ) tid ON true
      LEFT JOIN team_era_names e ON e.team_id = tid.team_id
       AND q.s >= e.first_season_id AND (e.last_season_id IS NULL OR q.s <= e.last_season_id)
      LEFT JOIN LATERAL (
        SELECT abbreviation, name, city FROM team_seasons
        WHERE nba_franchise_id = q.f ORDER BY season_id DESC LIMIT 1
      ) l ON true
    `;
    for (const r of rows) resolved.set(key(r.franchise_id, r.season_id), teamFromRow(r));
  }
  return (f, s) => resolved.get(key(f, s ?? LATEST)) ?? staticTeam(f);
}
