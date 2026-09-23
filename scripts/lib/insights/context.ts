// scripts/lib/insights/context.ts
// Shared state for one insight-generation run, loaded once and passed to every
// category generator, plus the proof runner.
//
// Stats season: the season the batch insights talk about. It is the latest
// season in which the Clippers have at least MIN_SEASON_GAMES box-score games,
// so in the offseason (and the first couple of weeks of a new season) insights
// describe the last full season ("in 2025-26") instead of a near-empty one.
import { sql } from '../db.js';
import { currentSeasonId, seasonLabel } from '../schedule-utils.js';
import { paramsRecord } from './proof-utils.js';

/** Clippers games needed before a season becomes the stats season. */
export const MIN_SEASON_GAMES = 10;

/**
 * SQL predicate (for alias `g`) selecting regular-season games only: excludes
 * playoffs and the play-in (NBA ids 005YY…, stored as 50,000,000–59,999,999).
 */
export const REGULAR_SEASON = `(NOT g.is_playoffs AND g.nba_game_id NOT BETWEEN 50000000 AND 59999999)`;

/**
 * SQL subquery selecting the season's Clippers players: players whose most
 * recent game of the season was for the Clippers. A player traded away
 * mid-season is excluded; one acquired mid-season is included. `season` and
 * `team` are the proof query's placeholders (e.g. '$1', '$2').
 */
export function clippersSeasonPlayers(season: string, team: string): string {
  return `(
  SELECT last_game.player_id FROM (
    SELECT DISTINCT ON (cp.player_id) cp.player_id, cp.team_id
    FROM game_player_box_scores cp
    JOIN games cg ON cg.game_id = cp.game_id
    WHERE cg.season_id = ${season}::int
    ORDER BY cp.player_id, cg.game_date DESC, cg.game_id DESC
  ) last_game
  WHERE last_game.team_id = ${team}::bigint
)`;
}

export interface TeamInfo {
  teamId: string;
  abbreviation: string;
  name: string;         // "Clippers"
  fullName: string;     // "LA Clippers" / "Golden State Warriors"
  conference: string | null;
}

export interface InsightSeason {
  id: number;
  label: string;        // "2025-26"
  /** True when the stats season is the season in progress by date. */
  isCurrent: boolean;
  /** "this season" or "in 2025-26" — for the end of a sentence. */
  phrase: string;
  /** Date of the last Clippers box-score game in the season (YYYY-MM-DD). */
  lastGameDate: string;
}

export interface InsightContext {
  lac: TeamInfo;
  season: InsightSeason;
  teams: Map<string, TeamInfo>;
  /** Minimum games for a player to be ranked league-wide (half the season so far). */
  minPlayerGames: number;
}

/** Loads the run context, or null when there is nothing to generate from. */
export async function loadInsightContext(now: Date = new Date()): Promise<InsightContext | null> {
  const teamRows = await sql<{
    team_id: string; abbreviation: string; name: string; city: string | null; conference: string | null;
  }[]>`
    SELECT team_id::text, abbreviation, name, city, conference FROM teams
  `;
  const teams = new Map<string, TeamInfo>();
  let lac: TeamInfo | undefined;
  for (const t of teamRows) {
    const info: TeamInfo = {
      teamId: t.team_id,
      abbreviation: t.abbreviation,
      name: t.name,
      fullName: t.city ? `${t.city} ${t.name}` : t.name,
      conference: t.conference,
    };
    teams.set(t.team_id, info);
    if (t.abbreviation === 'LAC') lac = info;
  }
  if (!lac) return null;

  const seasons = await sql<{ season_id: number; games: number; last_date: string }[]>`
    SELECT g.season_id, COUNT(*)::int AS games, MAX(g.game_date)::text AS last_date
    FROM games g
    WHERE g.season_id IS NOT NULL
      AND ${lac.teamId}::bigint IN (g.home_team_id, g.away_team_id)
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
    GROUP BY g.season_id
    ORDER BY g.season_id DESC
  `;
  if (seasons.length === 0) return null;
  const chosen = seasons.find((s) => s.games >= MIN_SEASON_GAMES) ?? seasons[0];

  const isCurrent = chosen.season_id === currentSeasonId(now);
  const label = seasonLabel(chosen.season_id);

  // Most regular-season games any team has in the stats season → the bar for
  // "qualified" players is half of that (NBA leaderboards use a similar rule).
  const [maxGames] = await sql<{ n: number | null }[]>`
    SELECT MAX(n)::int AS n FROM (
      SELECT t.team_id, COUNT(*) AS n
      FROM games g
      CROSS JOIN LATERAL (VALUES (g.home_team_id), (g.away_team_id)) AS t(team_id)
      WHERE g.season_id = ${chosen.season_id}
        AND ${sql.unsafe(REGULAR_SEASON)}
        AND EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = g.game_id)
      GROUP BY t.team_id
    ) x
  `;

  return {
    lac,
    teams,
    season: {
      id: chosen.season_id,
      label,
      isCurrent,
      phrase: isCurrent ? 'this season' : `in ${label}`,
      lastGameDate: chosen.last_date,
    },
    minPlayerGames: Math.max(5, Math.ceil((maxGames?.n ?? 0) / 2)),
  };
}

/**
 * Runs a proof query and returns its rows — the stored proof_sql is exactly
 * the query whose result backs the claim. Parameters are positional ($1…);
 * cast them in the SQL text (e.g. $1::int) since they are sent untyped.
 */
export async function runProof<T extends Record<string, unknown>>(
  proofSql: string,
  params: readonly (string | number | boolean | null)[]
): Promise<{ rows: T[]; proof_params: Record<string, unknown> }> {
  const rows = (await sql.unsafe(proofSql, params as (string | number | boolean | null)[])) as unknown as T[];
  // Plain objects: drop postgres.js row metadata before storing as JSON.
  return { rows: rows.map((r) => ({ ...r })), proof_params: paramsRecord(params) };
}
