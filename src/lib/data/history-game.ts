// src/lib/data/history-game.ts — moved from app/api/history/games/[game_id]/route.ts; the route and server pages both call loadHistoryGame().
// src/app/api/history/games/[game_id]/route.ts
// GET /api/history/games/{game_id} — Game detail with box score and insights.
// Box score available:false for pre-Phase-7 games (no game_player_box_scores rows).
// Insights queried from `insights` table (NOT `generated_insights`).

import { json, type ApiResult } from './result';
import { sql, LAC_NBA_TEAM_ID } from '@/src/lib/db';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { formatClock } from '@/src/lib/format';

// Box score stat columns as defined by API_SPEC.md
const BOX_SCORE_COLUMNS = ['MIN', 'PTS', 'REB', 'AST', 'STL', 'BLK', 'TO', 'FG', '3PT', 'FT', '+/-'];

interface GameDetailRow {
  game_id: string;
  game_date: string;
  season_id: number;
  home_team_id: string;
  away_team_id: string;
  status: string;
  home_score: number | null;
  away_score: number | null;
  home_abbr: string;
  away_abbr: string;
  home_name: string;
  away_name: string;
  home_is_lac: boolean;
  away_is_lac: boolean;
}

interface PlayerBoxRow {
  player_id: string;
  nba_player_id: number | null;
  nba_person_id: number | null;
  display_name: string;
  team_id: string;
  minutes: string | null;
  points: number | null;
  rebounds: number | null;
  assists: number | null;
  steals: number | null;
  blocks: number | null;
  turnovers: number | null;
  plus_minus: number | null;
  fg_made: number | null;
  fg_attempted: number | null;
  fg3_made: number | null;
  fg3_attempted: number | null;
  ft_made: number | null;
  ft_attempted: number | null;
}

interface InsightRow {
  insight_id: string;
  scope: string;
  category: string;
  headline: string;
  detail: string;
  importance: number;
  proof_result: unknown;
}

function formatFraction(made: number | null, att: number | null): string | null {
  return made == null || att == null ? null : `${made}-${att}`;
}

/** Seconds from "PT34M12.00S" / "34:12"; null when unparseable. */
function minutesSeconds(m: string | null): number | null {
  if (m == null) return null;
  const iso = m.match(/^PT(?:(\d+)M)?(?:([\d.]+)S)?$/);
  if (iso) return parseInt(iso[1] ?? '0', 10) * 60 + parseFloat(iso[2] ?? '0');
  const clock = m.match(/^(\d+):(\d+)/);
  if (clock) return parseInt(clock[1], 10) * 60 + parseInt(clock[2], 10);
  return null;
}

/** Played = minutes above 0, or minutes unknown and points recorded (old eras). */
function didPlay(p: PlayerBoxRow): boolean {
  const secs = minutesSeconds(p.minutes);
  return secs != null ? secs > 0 : p.points != null;
}

/**
 * Team totals over the players who played. A total is null when any of them has
 * that stat untracked (old eras), so the UI shows a dash instead of a false 0.
 */
function buildTeamTotals(all: PlayerBoxRow[]): Record<string, unknown> {
  const players = all.filter(didPlay);
  const sum = (get: (p: PlayerBoxRow) => number | null): number | null => {
    let t = 0;
    for (const p of players) {
      const v = get(p);
      if (v == null) return null;
      t += v;
    }
    return t;
  };
  const frac = (made: (p: PlayerBoxRow) => number | null, att: (p: PlayerBoxRow) => number | null) => {
    const m = sum(made);
    const a = sum(att);
    return m == null || a == null ? null : `${m}-${a}`;
  };

  return {
    PTS: sum((p) => p.points),
    REB: sum((p) => p.rebounds),
    AST: sum((p) => p.assists),
    STL: sum((p) => p.steals),
    BLK: sum((p) => p.blocks),
    TO: sum((p) => p.turnovers),
    FG: frac((p) => p.fg_made, (p) => p.fg_attempted),
    '3PT': frac((p) => p.fg3_made, (p) => p.fg3_attempted),
    FT: frac((p) => p.ft_made, (p) => p.ft_attempted),
  };
}

function mapPlayerRow(p: PlayerBoxRow) {
  return {
    id: p.player_id,          // Required by BoxScoreRow interface (used as React key)
    player_id: p.player_id,
    nba_player_id: p.nba_player_id ?? null,
    nba_person_id: p.nba_person_id ?? null,  // official NBA personId — use for headshots
    name: p.display_name,
    MIN: p.minutes ? formatClock(p.minutes) : null, // NBA box scores store "PT34M12.00S"
    PTS: p.points ?? null,
    REB: p.rebounds ?? null,
    AST: p.assists ?? null,
    STL: p.steals ?? null,
    BLK: p.blocks ?? null,
    TO: p.turnovers ?? null,
    FG: formatFraction(p.fg_made, p.fg_attempted),
    '3PT': formatFraction(p.fg3_made, p.fg3_attempted),
    FT: formatFraction(p.ft_made, p.ft_attempted),
    '+/-': p.plus_minus ?? null,
  };
}

type PeriodScore = { period: number; score: number };

function asPeriods(value: unknown): PeriodScore[] {
  return Array.isArray(value)
    ? value.filter(
        (p): p is PeriodScore =>
          p !== null && typeof p === 'object' && typeof p.period === 'number' && typeof p.score === 'number'
      )
    : [];
}

/** Pair home/away period scores into [{ period, home, away }]. */
export function buildLineScore(home: unknown, away: unknown): { period: number; home: number; away: number }[] {
  const awayByPeriod = new Map(asPeriods(away).map((p) => [p.period, p.score]));
  return asPeriods(home)
    .map((p) => ({ period: p.period, home: p.score, away: awayByPeriod.get(p.period) ?? 0 }))
    .sort((a, b) => a.period - b.period);
}

export async function loadHistoryGame(gameIdParam: string): Promise<ApiResult> {
  try {

    // Validate game_id is a valid bigint-like value
    const gameIdNum = parseInt(gameIdParam, 10);
    if (isNaN(gameIdNum) || String(gameIdNum) !== gameIdParam) {
      return json(
        buildError('BAD_REQUEST', 'game_id must be a valid integer'),
        { status: 400 }
      );
    }

    // Every query below keys on the game id alone, so they all run at once.
    const [[game], playerRows, periodRows, insightRows] = await Promise.all([
    // Fetch game with team abbreviations
    sql<GameDetailRow[]>`
      SELECT
        g.game_id::text       AS game_id,
        g.game_date::text     AS game_date,
        g.season_id,
        g.home_team_id::text  AS home_team_id,
        g.away_team_id::text  AS away_team_id,
        g.status,
        g.home_score,
        g.away_score,
        COALESCE(he.abbreviation, ht.abbreviation) AS home_abbr,
        COALESCE(ae.abbreviation, at.abbreviation) AS away_abbr,
        COALESCE(he.name, ht.name) AS home_name,
        COALESCE(ae.name, at.name) AS away_name,
        (ht.nba_team_id = ${LAC_NBA_TEAM_ID}) AS home_is_lac,
        (at.nba_team_id = ${LAC_NBA_TEAM_ID}) AS away_is_lac
      FROM games g
      JOIN teams ht ON g.home_team_id = ht.team_id
      JOIN teams at ON g.away_team_id = at.team_id
      LEFT JOIN team_era_names he ON he.team_id = ht.team_id
       AND g.season_id >= he.first_season_id
       AND (he.last_season_id IS NULL OR g.season_id <= he.last_season_id)
      LEFT JOIN team_era_names ae ON ae.team_id = at.team_id
       AND g.season_id >= ae.first_season_id
       AND (ae.last_season_id IS NULL OR g.season_id <= ae.last_season_id)
      WHERE g.game_id = ${gameIdParam}::bigint
      LIMIT 1
    `,
    sql<PlayerBoxRow[]>`
        SELECT
          p.player_id::text  AS player_id,
          p.nba_player_id,
          p.nba_person_id,
          p.display_name,
          pbs.team_id::text  AS team_id,
          pbs.minutes,
          pbs.points,
          pbs.rebounds,
          pbs.assists,
          pbs.steals,
          pbs.blocks,
          pbs.turnovers,
          pbs.plus_minus,
          pbs.fg_made,
          pbs.fg_attempted,
          pbs.fg3_made,
          pbs.fg3_attempted,
          pbs.ft_made,
          pbs.ft_attempted
        FROM game_player_box_scores pbs
        JOIN players p ON pbs.player_id = p.player_id
        WHERE pbs.game_id = ${gameIdParam}::bigint
        ORDER BY pbs.team_id, pbs.points DESC NULLS LAST
      `,
    sql<{ is_home: boolean; periods: unknown }[]>`
      -- Rows written before the raw_payload fix hold the JSON as a string scalar.
      SELECT is_home,
             (CASE WHEN jsonb_typeof(raw_payload) = 'string' THEN (raw_payload #>> '{}')::jsonb
                   ELSE raw_payload END) -> 'periods' AS periods
      FROM game_team_box_scores
      WHERE game_id = ${gameIdParam}::bigint
    `,
    sql<InsightRow[]>`
      SELECT
        insight_id::text  AS insight_id,
        scope,
        category,
        headline,
        detail,
        importance,
        proof_result
      FROM insights
      WHERE game_id = ${gameIdParam}::bigint
        AND is_active = true
      ORDER BY importance DESC
    `,
    ]);

    if (!game) {
      return json(
        buildError('NOT_FOUND', `Game ${gameIdParam} not found`),
        { status: 404 }
      );
    }

    // Box score available when the game has any player rows.
    const available = playerRows.length > 0;

    let boxScore: {
      columns: string[];
      teams: Array<{
        team_abbr: string;
        is_lac: boolean;
        players: ReturnType<typeof mapPlayerRow>[];
        totals: Record<string, unknown>;
      }>;
      available: boolean;
    };

    if (available) {
      // Fetch all player box score rows for this game
      // playerRows: fetched with the game above.

      // Split players by team
      const homePlayers = playerRows.filter((p) => p.team_id === game.home_team_id);
      const awayPlayers = playerRows.filter((p) => p.team_id === game.away_team_id);

      boxScore = {
        columns: BOX_SCORE_COLUMNS,
        teams: [
          {
            team_abbr: game.home_abbr,
            is_lac: game.home_is_lac,
            players: homePlayers.map(mapPlayerRow),
            totals: buildTeamTotals(homePlayers),
          },
          {
            team_abbr: game.away_abbr,
            is_lac: game.away_is_lac,
            players: awayPlayers.map(mapPlayerRow),
            totals: buildTeamTotals(awayPlayers),
          },
        ],
        available: true,
      };
    } else {
      // Pre-Phase-7 game: no box score data available
      boxScore = {
        columns: BOX_SCORE_COLUMNS,
        teams: [
          { team_abbr: game.home_abbr, is_lac: game.home_is_lac, players: [], totals: {} },
          { team_abbr: game.away_abbr, is_lac: game.away_is_lac, players: [], totals: {} },
        ],
        available: false,
      };
    }

    // Line score from the team box scores' raw_payload (stored at finalization;
    // older games are backfilled nightly by scripts/backfill-periods.ts).
    // periodRows: fetched with the game above.
    const periods = buildLineScore(
      periodRows.find((r) => r.is_home)?.periods,
      periodRows.find((r) => !r.is_home)?.periods
    );

    // Query insights from `insights` table (NOT `generated_insights`)
    // insightRows: fetched with the game above.

    const insights = insightRows.map((r) => ({
      insight_id: r.insight_id,
      headline: r.headline,
      detail: r.detail,
      importance: r.importance,
      proof: {
        summary: r.category,
        result: r.proof_result,
      },
    }));

    // A finished game with its box score never changes → cache for a day.
    // Anything else (scheduled, in progress, awaiting finalization) → 60s, so
    // a page opened before or during a game doesn't stay stale for 24h.
    const settled = String(game.status).toLowerCase() === 'final' && available;
    const ttlSeconds = settled ? 86400 : 60;

    return json(
      {
        meta: buildMeta('mixed', ttlSeconds),
        game: {
          game_id: game.game_id,
          game_date: game.game_date,
          season_id: game.season_id,
          home_team: { team_id: game.home_team_id, abbreviation: game.home_abbr, name: game.home_name, is_lac: game.home_is_lac },
          away_team: { team_id: game.away_team_id, abbreviation: game.away_abbr, name: game.away_name, is_lac: game.away_is_lac },
          status: game.status,
          home_score: game.home_score,
          away_score: game.away_score,
          // [{ period, home, away }]; [] when the line score isn't stored yet
          periods,
        },
        box_score: boxScore,
        insights,
      },
      {
        headers: { 'Cache-Control': `public, max-age=${ttlSeconds}` },
      }
    );
  } catch (err) {
    console.error('[GET /api/history/games/[game_id]]', err);
    return json(
      buildError('INTERNAL_ERROR', 'Unexpected server error'),
      { status: 500 }
    );
  }
}
