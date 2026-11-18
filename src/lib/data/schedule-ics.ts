// src/lib/data/schedule-ics.ts
// Clippers games for the calendar export: one game, or the season feed
// (every remaining game plus the last 30 days of results). Broadcasts come
// from ESPN when it answers; the calendar works without them.

import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildIcs, gameIcsEvent, type IcsGame } from '@/src/lib/ics';
import { fetchEspnJson } from '@/src/lib/espn/fetch';
import { espnScheduleUrl, findScheduledGame, parseEspnSchedule, type EspnScheduledGame } from '@/src/lib/espn/schedule';

export type IcsGameRow = IcsGame & { season_id: number };

export async function loadIcsGames(opts: { gameId?: string }): Promise<IcsGameRow[]> {
  return sql<IcsGameRow[]>`
    SELECT g.game_id::text AS game_id, g.game_date::text AS game_date, g.season_id,
           to_char(g.start_time_utc AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS start_time_utc,
           g.status, g.arena,
           (g.home_team_id = lac.team_id) AS lac_home,
           CASE WHEN g.home_team_id = lac.team_id THEN at.abbreviation ELSE ht.abbreviation END AS opponent_abbr,
           CASE WHEN g.home_team_id = lac.team_id THEN g.home_score ELSE g.away_score END AS lac_score,
           CASE WHEN g.home_team_id = lac.team_id THEN g.away_score ELSE g.home_score END AS opp_score
    FROM all_games g
    JOIN teams lac ON lac.nba_team_id = ${LAC_NBA_TEAM_ID}
    JOIN teams ht ON ht.team_id = g.home_team_id
    JOIN teams at ON at.team_id = g.away_team_id
    WHERE (g.home_team_id = lac.team_id OR g.away_team_id = lac.team_id)
      AND ${opts.gameId
        ? sql`g.game_id = ${opts.gameId}::bigint`
        : sql`NOT g.is_preseason AND g.game_date >= (now() AT TIME ZONE 'America/New_York')::date - 30`}
    ORDER BY g.game_date, g.game_id
  `;
}

async function withBroadcasts(games: IcsGameRow[]): Promise<IcsGame[]> {
  const seasons = [...new Set(games.map((g) => g.season_id))];
  const schedules = new Map<number, EspnScheduledGame[]>();
  await Promise.all(seasons.map(async (s) => schedules.set(s, parseEspnSchedule(await fetchEspnJson(espnScheduleUrl(s + 1))))));
  return games.map((g) => ({
    ...g,
    broadcasts: findScheduledGame(schedules.get(g.season_id) ?? [], g.game_date, g.opponent_abbr)?.broadcasts.map((b) => b.name) ?? [],
  }));
}

export async function icsResponse(games: IcsGameRow[], opts: { calName: string; filename?: string }): Promise<Response> {
  const body = buildIcs((await withBroadcasts(games)).map(gameIcsEvent), opts.calName);
  const headers: Record<string, string> = {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Cache-Control': 'public, max-age=3600',
  };
  if (opts.filename) headers['Content-Disposition'] = `attachment; filename="${opts.filename}"`;
  return new Response(body, { status: 200, headers });
}
