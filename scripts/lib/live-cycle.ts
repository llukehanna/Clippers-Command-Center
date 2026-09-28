// scripts/lib/live-cycle.ts
// One live poll for one Clippers games row: scoreboard → match by NBA game id →
// box score + play-by-play → append a live_snapshots row → update the games row.
// Shared by the game-night runner (scripts/game-night.ts, every 12s) and the
// on-demand /api/cron/poll-live route. The caller passes its own postgres client.

import type { Sql } from 'postgres';
import {
  fetchScoreboard,
  fetchBoxscore,
  fetchPlayByPlay,
  parseNBAClock,
} from './nba-live-client';
import {
  extractRecentScoring,
  lineScore,
  matchScoreboardGame,
  summarizeOtherGames,
  type OtherGame,
  type RecentScoringEvent,
} from './poll-live-logic';
import type { ScoreboardGame, BoxscoreTeam } from '../../src/lib/types/live';

export const RECENT_SCORING_LOOKBACK_SECONDS = 120;

/** Payload stored in live_snapshots.payload and read by /api/live. */
export interface SnapshotPayload {
  is_stale: boolean;
  stale_reason: string | null;
  home_box: BoxscoreTeam | null;
  away_box: BoxscoreTeam | null;
  recent_scoring: RecentScoringEvent[];
  // Added with the game-night runner (older snapshots lack these):
  nba_game_id?: string;
  status?: 'scheduled' | 'in_progress' | 'final';
  status_text?: string;
  periods?: { period: number; home: number; away: number }[];
  other_games?: OtherGame[];
}

export interface LiveCandidate {
  game_id: string;
  nba_game_id: string;
  home_team_id: string;
  away_team_id: string;
  start_time_utc: Date | null;
}

export type CycleResult =
  | { state: 'NOT_ON_SCOREBOARD' }
  | { state: 'OK'; game: ScoreboardGame; payload: SnapshotPayload };

export function scoreboardStatus(gameStatus: number): 'scheduled' | 'in_progress' | 'final' {
  return gameStatus === 3 ? 'final' : gameStatus === 2 ? 'in_progress' : 'scheduled';
}

/**
 * Clippers games that may be live now: not final, tipping within the next
 * `leadMinutes`, or tipped within the last 4 hours (overtime + delays).
 * Rows with no start time fall back to today's US Eastern date.
 */
export async function findLiveCandidates(sql: Sql, leadMinutes = 30): Promise<LiveCandidate[]> {
  return sql<LiveCandidate[]>`
    SELECT g.game_id::text, g.nba_game_id::text, g.home_team_id::text, g.away_team_id::text,
           g.start_time_utc
    FROM games g
    JOIN teams lac ON lac.abbreviation = 'LAC'
      AND lac.team_id IN (g.home_team_id, g.away_team_id)
    WHERE g.status <> 'final'
      AND (
        g.start_time_utc BETWEEN now() - INTERVAL '4 hours'
                             AND now() + make_interval(mins => ${leadMinutes})
        OR (g.start_time_utc IS NULL
            AND g.game_date = (now() AT TIME ZONE 'America/New_York')::date)
      )
    ORDER BY g.start_time_utc ASC NULLS LAST
  `;
}

/** Poll once for `candidate` and persist the result. Throws on scoreboard/DB failure. */
export async function runLiveCycle(sql: Sql, candidate: LiveCandidate): Promise<CycleResult> {
  const scoreboard = await fetchScoreboard();
  const games = scoreboard.scoreboard.games;
  const game = matchScoreboardGame(games, candidate.nba_game_id);
  if (!game) return { state: 'NOT_ON_SCOREBOARD' };

  // Pre-tip there's no box score or play-by-play yet.
  let homeBox: BoxscoreTeam | null = null;
  let awayBox: BoxscoreTeam | null = null;
  let recent: RecentScoringEvent[] = [];
  if (game.gameStatus >= 2) {
    const [box, pbp] = await Promise.allSettled([
      fetchBoxscore(game.gameId, game.gameId),
      fetchPlayByPlay(game.gameId),
    ]);
    if (box.status === 'fulfilled') {
      homeBox = box.value.game.homeTeam;
      awayBox = box.value.game.awayTeam;
    } else {
      console.warn(`[live] Box score fetch failed: ${(box.reason as Error).message}`);
    }
    if (pbp.status === 'fulfilled') {
      recent = extractRecentScoring(
        pbp.value.game.actions,
        { period: game.period, clock: game.gameClock },
        {
          homeTeamId: game.homeTeam.teamId,
          awayTeamId: game.awayTeam.teamId,
          homeTricode: game.homeTeam.teamTricode,
          awayTricode: game.awayTeam.teamTricode,
        },
        RECENT_SCORING_LOOKBACK_SECONDS
      );
    } else {
      console.warn(`[live] Play-by-play fetch failed: ${(pbp.reason as Error).message}`);
    }
  }

  const status = scoreboardStatus(game.gameStatus);
  const payload: SnapshotPayload = {
    is_stale: false,
    stale_reason: null,
    home_box: homeBox,
    away_box: awayBox,
    recent_scoring: recent,
    nba_game_id: game.gameId,
    status,
    status_text: game.gameStatusText,
    periods: lineScore(game),
    other_games: summarizeOtherGames(games, game.gameId),
  };

  const clock = parseNBAClock(game.gameClock);
  const providerTs = game.gameTimeUTC ? new Date(game.gameTimeUTC) : null;
  await sql`
    INSERT INTO live_snapshots (game_id, captured_at, provider_ts, period, clock, home_score, away_score, payload)
    VALUES (${candidate.game_id}::bigint, now(), ${providerTs}, ${game.period}, ${clock},
            ${game.homeTeam.score}, ${game.awayTeam.score},
            ${sql.json(payload as unknown as Parameters<typeof sql.json>[0])})
  `;
  // A game can't go back from final on a stale scoreboard read.
  await sql`
    UPDATE games SET
      status = ${status},
      period = ${game.period},
      clock = ${clock},
      home_score = ${game.homeTeam.score},
      away_score = ${game.awayTeam.score},
      updated_at = now()
    WHERE game_id = ${candidate.game_id}::bigint AND status <> 'final'
  `;
  await sql`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES ('live:last_poll_at', ${sql.json(new Date().toISOString())}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return { state: 'OK', game, payload };
}
