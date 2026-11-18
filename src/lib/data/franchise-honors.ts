// src/lib/data/franchise-honors.ts
// GET /api/franchise/honors — retired numbers first, then awards by season.
// honor = 'retired_number' is a Clippers retirement (they have retired none);
// 'retired_number_league' is a number the whole league retired; 'hall_of_fame'
// rows have no season (detail = induction year).

import { type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { formatSeasonLabel } from '@/src/lib/home-utils';
import type { HonorRow, HonorsPayload } from '@/src/lib/ui/types';
import { internalError, ok, personRef } from './franchise-common';

const TTL = 86400;

/** Display names for the pipeline's honor codes (scripts/lib/franchise/wiki-team.ts). */
export const HONOR_LABELS: Record<string, string> = {
  mvp: 'MVP',
  all_star_mvp: 'All-Star Game MVP',
  all_star: 'All-Star',
  roy: 'Rookie of the Year',
  dpoy: 'Defensive Player of the Year',
  smoy: 'Sixth Man of the Year',
  mip: 'Most Improved Player',
  coy: 'Coach of the Year',
  eoy: 'Executive of the Year',
  clutch: 'Clutch Player of the Year',
  all_nba_1: 'All-NBA First Team',
  all_nba_2: 'All-NBA Second Team',
  all_nba_3: 'All-NBA Third Team',
  all_defense_1: 'All-Defensive First Team',
  all_defense_2: 'All-Defensive Second Team',
  all_rookie_1: 'All-Rookie First Team',
  all_rookie_2: 'All-Rookie Second Team',
  retired_number: 'Retired number',
  retired_number_league: 'Retired league-wide',
  hall_of_fame: 'Hall of Fame',
};

export function honorLabel(code: string): string {
  if (HONOR_LABELS[code]) return HONOR_LABELS[code];
  const words = code.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

interface Row {
  season_id: number | null;
  person_key: string;
  display_name: string | null;
  player_id: string | null;
  nba_person_id: number | string | null;
  honor: string;
  detail: string | null;
}

export async function loadFranchiseHonors(): Promise<ApiResult> {
  try {
    const rows = await sql<Row[]>`
      SELECT h.season_id, h.person_key, x.display_name, x.player_id::text AS player_id, COALESCE(x.nba_person_id, pl.nba_person_id) AS nba_person_id, h.honor, h.detail
      FROM honors h
      LEFT JOIN person_xref x ON x.person_key = h.person_key
      LEFT JOIN players pl ON pl.player_id = x.player_id
      ORDER BY h.season_id DESC NULLS FIRST, h.honor, x.display_name, h.honor_id
    `;

    const body: Omit<HonorsPayload, 'meta'> = {
      retired_number: [], retired_number_league: [], hall_of_fame: [], awards_by_season: [], other: [],
    };
    const seasons = new Map<number, HonorRow[]>();
    for (const r of rows) {
      const row: HonorRow = {
        season_id: r.season_id,
        honor: r.honor,
        label: honorLabel(r.honor),
        detail: r.detail,
        person: personRef(r.person_key, r.display_name, r.player_id, r.nba_person_id),
      };
      if (r.honor === 'retired_number') body.retired_number.push(row);
      else if (r.honor === 'retired_number_league') body.retired_number_league.push(row);
      else if (r.honor === 'hall_of_fame') body.hall_of_fame.push(row);
      else if (r.season_id != null) {
        const list = seasons.get(r.season_id) ?? [];
        list.push(row);
        seasons.set(r.season_id, list);
      } else body.other.push(row);
    }
    body.hall_of_fame.sort((a, b) => (a.detail ?? '').localeCompare(b.detail ?? ''));
    body.awards_by_season = [...seasons.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([season_id, honors]) => ({ season_id, season_label: formatSeasonLabel(season_id), honors }));

    return ok(body, TTL);
  } catch (err) {
    return internalError('/api/franchise/honors', err);
  }
}
