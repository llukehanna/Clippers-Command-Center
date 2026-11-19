// scripts/lib/insights/engine/context.ts
// Everything one engine run needs, loaded once and bounded by asOf (spec §2.1):
// the stats season (latest with >= MIN_SEASON_GAMES Clippers box scores, so
// the first weeks of a season still describe the last one), the roster, the
// records starts, league coverage and the stored prior state.
import { MINUTES_SECONDS_SQL } from '../../../../src/lib/minutes';
import { sql } from '../../db.js';
import { DEFAULT_POSTGAME_DAYS } from './dates.js';
import { currentSeasonId, seasonLabel } from '../../schedule-utils.js';
import { REGULAR_SEASON } from '../../sql-fragments.js';
import { assessLeagueCoverage, type TeamGames } from './coverage.js';
import { applyRosterSnapshot, parseRosterSnapshot, rosterGuardReason, snapshotProblem, type RosterSnapshot } from './roster.js';
import { parseRecordsStart } from './records.js';
import { rosterSubquery } from './sql.js';
import { loadPrior } from './store.js';
import type { EngineContext, PriorState, RosterPlayer, TeamInfo } from './types.js';

export const MIN_SEASON_GAMES = 10;
export { DEFAULT_POSTGAME_DAYS };

export interface LoadOptions { asOf: string; gameId?: string | null; withPrior: boolean; postgameDays?: number }

/** app_kv 'roster:LAC' (scripts/sync-roster.ts), parsed. */
async function loadRosterSnapshot(): Promise<RosterSnapshot | null> {
  const [kv] = await sql<{ value: unknown }[]>`SELECT value FROM app_kv WHERE key = 'roster:LAC'`;
  return parseRosterSnapshot(kv?.value);
}

export async function loadEngineContext(opts: LoadOptions): Promise<EngineContext | null> {
  const { asOf } = opts;
  const teamRows = await sql<{ team_id: string; abbreviation: string; name: string; city: string | null; conference: string | null }[]>`
    SELECT team_id::text, abbreviation, name, city, conference FROM teams`;
  const teams = new Map<string, TeamInfo>();
  let lac: TeamInfo | undefined;
  for (const t of teamRows) {
    const info: TeamInfo = {
      teamId: t.team_id, abbreviation: t.abbreviation, name: t.name,
      fullName: t.city ? `${t.city} ${t.name}` : t.name, conference: t.conference,
    };
    teams.set(t.team_id, info);
    if (t.abbreviation === 'LAC') lac = info;
  }
  if (!lac) return null;

  const seasons = await sql<{ season_id: number; games: number; last_date: string }[]>`
    SELECT g.season_id, COUNT(*)::int AS games, MAX(g.game_date)::text AS last_date
    FROM games g
    WHERE g.season_id IS NOT NULL AND g.game_date <= ${asOf}::date
      AND ${lac.teamId}::bigint IN (g.home_team_id, g.away_team_id)
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
    GROUP BY g.season_id
    ORDER BY g.season_id DESC`;
  if (seasons.length === 0) return null;
  const chosen = seasons.find((s) => s.games >= MIN_SEASON_GAMES) ?? seasons[0];
  const isCurrent = chosen.season_id === currentSeasonId(new Date(`${asOf}T12:00:00Z`));
  const label = seasonLabel(chosen.season_id);

  const [maxGames] = await sql<{ n: number | null }[]>`
    SELECT MAX(n)::int AS n FROM (
      SELECT t.team_id, COUNT(*) AS n
      FROM games g
      CROSS JOIN LATERAL (VALUES (g.home_team_id), (g.away_team_id)) AS t(team_id)
      WHERE g.season_id = ${chosen.season_id} AND g.game_date <= ${asOf}::date
        AND ${sql.unsafe(REGULAR_SEASON)}
        AND EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = g.game_id)
      GROUP BY t.team_id
    ) x`;

  const kv = await sql<{ key: string; value: unknown }[]>`
    SELECT key, value FROM app_kv WHERE key IN ('insights.records_start', 'insights.pbp_records_start')`;
  const kvValue = (key: string) => kv.find((r) => r.key === key)?.value ?? null;

  const rosterRows = (await sql.unsafe(`
    SELECT pb.player_id::text AS player_id, p.display_name AS name, COUNT(*)::int AS games,
           ROUND((AVG(${MINUTES_SECONDS_SQL}) / 60)::numeric, 1)::float8 AS mpg
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    JOIN players p ON p.player_id = pb.player_id
    WHERE g.season_id = $1::int AND g.game_date <= $3::date AND pb.team_id = $2::bigint
      AND pb.player_id IN ${rosterSubquery('$1', '$2', '$3')}
    GROUP BY pb.player_id, p.display_name`,
  [chosen.season_id, lac.teamId, asOf])) as unknown as { player_id: string; name: string; games: number; mpg: number }[];
  const boxRoster = new Map<string, RosterPlayer>(
    rosterRows.map((r) => [r.player_id, { playerId: r.player_id, name: r.name, games: r.games, mpg: r.mpg }]));

  const coverage = (await sql.unsafe(`
    SELECT t.team_id::text AS team_id, COUNT(*)::int AS games, MAX(g.game_date)::text AS last_date
    FROM games g
    CROSS JOIN LATERAL (VALUES (g.home_team_id), (g.away_team_id)) AS t(team_id)
    WHERE g.season_id = $1::int AND g.status = 'final' AND g.game_date <= $2::date AND ${REGULAR_SEASON}
      AND EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = g.game_id AND b.team_id = t.team_id)
    GROUP BY t.team_id`,
  [chosen.season_id, asOf])) as unknown as TeamGames[];

  const [latest] = (await sql.unsafe(`
    SELECT MAX(g.game_date)::text AS d
    FROM games g
    WHERE g.season_id = $1::int AND g.status = 'final' AND g.game_date <= $2::date AND ${REGULAR_SEASON}
      AND $3::bigint NOT IN (g.home_team_id, g.away_team_id)
      AND EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = g.game_id)`,
  [chosen.season_id, asOf, lac.teamId])) as unknown as { d: string | null }[];

  const league = assessLeagueCoverage(coverage, lac.teamId, latest?.d ?? null);
  // The box-score roster can include departed players when league box scores are incomplete (a traded player still
  // looks like a Clipper) or while the stats season lags the current one (last season's roster): intersect with the synced roster.
  let roster = boxRoster;
  const guardReason = rosterGuardReason(league.complete, chosen.season_id, asOf);
  if (guardReason) {
    const snapshot = await loadRosterSnapshot();
    const problem = snapshotProblem(snapshot, asOf, boxRoster);
    if (problem) {
      console.log(`::warning title=Roster snapshot unusable::roster:LAC snapshot ${problem}; the box-score roster is used unguarded while ${guardReason}`);
    }
    roster = applyRosterSnapshot(boxRoster, snapshot, asOf);
  }

  const prior: Map<string, PriorState> = opts.withPrior ? await loadPrior() : new Map();

  return {
    asOf,
    lac,
    teams,
    season: { id: chosen.season_id, label, isCurrent, phrase: isCurrent ? 'this season' : `in ${label}`, lastGameDate: chosen.last_date },
    minPlayerGames: Math.max(5, Math.ceil((maxGames?.n ?? 0) / 2)),
    recordsStart: parseRecordsStart(kvValue('insights.records_start')),
    pbpRecordsStart: parseRecordsStart(kvValue('insights.pbp_records_start')),
    roster,
    league,
    gameId: opts.gameId ?? null,
    postgameDays: opts.postgameDays ?? DEFAULT_POSTGAME_DAYS,
    prior,
  };
}
