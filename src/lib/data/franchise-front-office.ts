// src/lib/data/franchise-front-office.ts
// GET /api/franchise/front-office — head coaches season by season (ordinal orders
// mid-season changes) and executive terms. Unknown records stay null (render —).

import { type ApiResult } from './result';
import { sql } from '@/src/lib/db';
import { formatSeasonLabel } from '@/src/lib/home-utils';
import type { CoachSeason, ExecutiveTerm } from '@/src/lib/ui/types';
import { internalError, ok, personRef } from './franchise-common';

const TTL = 86400;

interface CoachRow {
  season_id: number;
  ordinal: number;
  person_key: string;
  display_name: string | null;
  player_id: string | null;
  games: number | null;
  wins: number | null;
  losses: number | null;
  playoff_wins: number | null;
  playoff_losses: number | null;
}

interface ExecRow {
  person_key: string;
  display_name: string | null;
  player_id: string | null;
  title: string | null;
  start_date: string | null;
  end_date: string | null;
}

export async function loadFranchiseFrontOffice(): Promise<ApiResult> {
  try {
    const [coaches, execs] = await Promise.all([
      sql<CoachRow[]>`
        SELECT cs.season_id, cs.ordinal, cs.person_key, x.display_name, x.player_id::text AS player_id,
               cs.games, cs.wins, cs.losses, cs.playoff_wins, cs.playoff_losses
        FROM coach_seasons cs
        LEFT JOIN person_xref x ON x.person_key = cs.person_key
        ORDER BY cs.season_id DESC, cs.ordinal
      `,
      sql<ExecRow[]>`
        SELECT e.person_key, x.display_name, x.player_id::text AS player_id, e.title,
               e.start_date::text AS start_date, e.end_date::text AS end_date
        FROM executive_terms e
        LEFT JOIN person_xref x ON x.person_key = e.person_key
        ORDER BY e.start_date DESC NULLS LAST, e.term_id DESC
      `,
    ]);

    const coach_seasons: CoachSeason[] = coaches.map((c) => ({
      season_id: c.season_id,
      season_label: formatSeasonLabel(c.season_id),
      ordinal: c.ordinal,
      coach: personRef(c.person_key, c.display_name, c.player_id),
      games: c.games,
      wins: c.wins,
      losses: c.losses,
      playoff_wins: c.playoff_wins,
      playoff_losses: c.playoff_losses,
    }));
    const executives: ExecutiveTerm[] = execs.map((e) => ({
      person: personRef(e.person_key, e.display_name, e.player_id),
      title: e.title,
      start_date: e.start_date,
      end_date: e.end_date,
    }));

    return ok({ coach_seasons, executives }, TTL);
  } catch (err) {
    return internalError('/api/franchise/front-office', err);
  }
}
