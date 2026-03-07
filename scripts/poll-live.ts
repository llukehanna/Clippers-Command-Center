// scripts/poll-live.ts
// Long-running game-night polling loop — the primary live data pipeline entry point.
// Detects active Clippers games, polls NBA CDN scoreboard every 12 seconds,
// stores append-only snapshots, runs live insight detection, handles failures
// with exponential backoff, and triggers inline finalization when the game ends.

import { sql } from './lib/db.js';
import {
  fetchScoreboard,
  fetchBoxscore,
  fetchPlayByPlay,
  parseNBAClock,
  clockToSecondsRemaining,
} from './lib/nba-live-client.js';
import {
  calculateBackoff,
  findClippersGame,
  gameStatusLabel,
  LAC_TEAM_ID,
} from './lib/poll-live-logic.js';
import { generateLiveInsights } from '../src/lib/insights/live.js';
import type { ScoreboardGame, BoxscoreTeam } from '../src/lib/types/live.js';
import type {
  LiveSnapshot,
  ScoringEvent,
  RollingContext,
} from '../src/lib/insights/live.js';
import { setCheckpoint } from './lib/upserts.js';
import { finalizeGame } from './lib/finalize.js';

type Json = Parameters<typeof sql.json>[0];

const POLL_INTERVAL_MS = 12_000;
const RECENT_SCORING_LOOKBACK_SECONDS = 120; // last 2 minutes of play-by-play

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // 1. Find active Clippers game in games table
  const candidate = await findActiveClippersGameInDB();
  if (!candidate) {
    console.log('No active Clippers game found. Run npm run sync-schedule first.');
    await sql.end();
    return;
  }
  console.log(`[poll-live] Found game: ${candidate.nba_game_id}. Starting poll loop...`);

  // 2. Start poll loop
  await pollLoop(candidate);

  await sql.end();
}

// ── DB Queries ────────────────────────────────────────────────────────────────

/**
 * Query the games table for a Clippers game with status 'in_progress'
 * OR scheduled today within a 30-minute window.
 */
async function findActiveClippersGameInDB(): Promise<{
  game_id: string;
  nba_game_id: string;
  home_team_id: string;
  away_team_id: string;
} | null> {
  const [row] = await sql<
    { game_id: string; nba_game_id: string; home_team_id: string; away_team_id: string }[]
  >`
    SELECT g.game_id::text, g.nba_game_id, g.home_team_id::text, g.away_team_id::text
    FROM games g
    JOIN teams t ON (t.team_id = g.home_team_id OR t.team_id = g.away_team_id)
    WHERE t.abbreviation = 'LAC'
      AND (
        g.status = 'in_progress'
        OR (
          g.status = 'scheduled'
          AND (
            g.start_time_utc IS NULL AND g.game_date = CURRENT_DATE
            OR g.start_time_utc BETWEEN now() - INTERVAL '30 minutes' AND now() + INTERVAL '30 minutes'
          )
        )
      )
    ORDER BY g.start_time_utc ASC NULLS LAST
    LIMIT 1
  `;
  return row ?? null;
}

interface SnapshotPayload {
  is_stale: boolean;
  stale_reason: string | null;
  home_box: BoxscoreTeam | null;
  away_box: BoxscoreTeam | null;
  recent_scoring: ScoringEvent[];
}

/**
 * Plain INSERT (append-only — NO ON CONFLICT) into live_snapshots.
 * game_id is the internal bigint PK from games table.
 * Payload uses the structured SnapshotPayload shape expected by /api/live.
 */
async function insertSnapshot(
  gameDbId: string,
  game: ScoreboardGame,
  payload: SnapshotPayload
): Promise<void> {
  const clock = parseNBAClock(game.gameClock);
  const providerTs = game.gameTimeUTC ? new Date(game.gameTimeUTC) : null;
  await sql`
    INSERT INTO live_snapshots (game_id, captured_at, provider_ts, period, clock, home_score, away_score, payload)
    VALUES (
      ${gameDbId}::bigint,
      now(),
      ${providerTs},
      ${game.period},
      ${clock},
      ${game.homeTeam.score},
      ${game.awayTeam.score},
      ${sql.json(payload as unknown as Json)}
    )
  `;
}

/**
 * Update games table status, period, clock, scores on each successful poll.
 */
async function updateGamesRow(gameDbId: string, game: ScoreboardGame): Promise<void> {
  const clock = parseNBAClock(game.gameClock);
  const status =
    game.gameStatus === 2 ? 'in_progress' : game.gameStatus === 3 ? 'final' : 'scheduled';
  await sql`
    UPDATE games SET
      status = ${status},
      period = ${game.period},
      clock = ${clock},
      home_score = ${game.homeTeam.score},
      away_score = ${game.awayTeam.score},
      updated_at = now()
    WHERE game_id = ${gameDbId}::bigint
  `;
}

// ── Poll Loop ─────────────────────────────────────────────────────────────────

async function pollLoop(candidate: {
  game_id: string;
  nba_game_id: string;
  home_team_id: string;
  away_team_id: string;
}): Promise<void> {
  let snapshotCount = 0;
  let failureCount = 0;
  let delayMs = POLL_INTERVAL_MS;

  while (true) {
    try {
      // Fetch scoreboard
      const scoreboard = await fetchScoreboard();
      const game = findClippersGame(scoreboard.scoreboard.games);

      if (!game) {
        console.warn("[WARN] Clippers game not found in today's scoreboard. Game may have ended.");
        break;
      }

      // Fetch boxscore (non-fatal — degrades to null boxes if CDN unavailable)
      let homeBox: BoxscoreTeam | null = null;
      let awayBox: BoxscoreTeam | null = null;
      try {
        const boxscore = await fetchBoxscore(String(game.gameId ?? candidate.nba_game_id));
        homeBox = boxscore.game.homeTeam;
        awayBox = boxscore.game.awayTeam;
      } catch (boxErr) {
        console.warn(`[WARN] Boxscore fetch failed: ${(boxErr as Error).message}. Storing without box data.`);
      }

      // Build recent scoring (needed for both payload and insight generation)
      const recentScoring = await buildRecentScoring(candidate.nba_game_id, game);

      // Build structured payload expected by /api/live
      const payload: SnapshotPayload = {
        is_stale: false,
        stale_reason: null,
        home_box: homeBox,
        away_box: awayBox,
        recent_scoring: recentScoring,
      };

      // Insert snapshot (append-only)
      snapshotCount++;
      await insertSnapshot(candidate.game_id, game, payload);
      await updateGamesRow(candidate.game_id, game);

      // Build console label
      const lacIsHome = game.homeTeam.teamId === LAC_TEAM_ID;
      const lacScore = lacIsHome ? game.homeTeam.score : game.awayTeam.score;
      const oppScore = lacIsHome ? game.awayTeam.score : game.homeTeam.score;
      const oppTricode = lacIsHome ? game.awayTeam.teamTricode : game.homeTeam.teamTricode;
      const hasBox = homeBox !== null ? ' +box' : '';
      const label =
        game.period === 0
          ? 'PRE'
          : `${gameStatusLabel(game.gameStatus) === 'LIVE' ? `Q${game.period}` : gameStatusLabel(game.gameStatus)} ${parseNBAClock(game.gameClock)}`;
      console.log(`[${label}] LAC ${lacScore} - ${oppTricode} ${oppScore} | snapshot #${snapshotCount} stored${hasBox}`);

      // Update app_kv checkpoints
      await setCheckpoint('poll-live:failure_count', 0);

      // Reset backoff on success
      failureCount = 0;
      delayMs = POLL_INTERVAL_MS;

      // Run live insight detection for console logging
      const snap: LiveSnapshot = {
        game_id: candidate.game_id,
        period: game.period,
        clock: parseNBAClock(game.gameClock),
        home_score: game.homeTeam.score,
        away_score: game.awayTeam.score,
        home_team_id: candidate.home_team_id,
        away_team_id: candidate.away_team_id,
        recent_scoring: payload.recent_scoring,
      };
      const rollingCtx: RollingContext = await fetchRollingContext(
        candidate.home_team_id,
        candidate.away_team_id
      );
      const insights = generateLiveInsights(snap, rollingCtx);
      if (insights.length > 0) {
        const top = insights[0]!;
        console.log(`  -> INSIGHT [${top.category.toUpperCase()}]: ${top.headline}`);
      }

      // Finalization check
      if (game.gameStatus === 3) {
        console.log('[poll-live] Game reached Final status. Triggering finalization...');
        await finalizeGame(candidate.game_id, candidate.nba_game_id);
        console.log('[poll-live] Finalization complete. Exiting.');
        break;
      }
    } catch (err) {
      failureCount++;
      delayMs = calculateBackoff(failureCount, POLL_INTERVAL_MS);
      console.warn(
        `[WARN] Poll failed (${failureCount} consecutive): ${(err as Error).message}. Retrying in ${delayMs}ms...`
      );
      await setCheckpoint('poll-live:failure_count', failureCount).catch(() => {});
    }

    await sleep(delayMs);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Fetch play-by-play and extract scoring events from last RECENT_SCORING_LOOKBACK_SECONDS.
 * Play-by-play failure is non-fatal — returns [] and insight detection degrades gracefully.
 */
async function buildRecentScoring(
  nbaGameId: string,
  game: ScoreboardGame
): Promise<ScoringEvent[]> {
  try {
    const pbp = await fetchPlayByPlay(nbaGameId);
    const quarterDurationSeconds = 720; // 12 min per quarter
    const periodElapsed = (game.period - 1) * quarterDurationSeconds;
    const gameElapsedSeconds = periodElapsed + (quarterDurationSeconds - clockToSecondsRemaining(game.gameClock));
    const cutoffSeconds = gameElapsedSeconds - RECENT_SCORING_LOOKBACK_SECONDS;
    return pbp.game.actions
      .filter((a) => a.pointsTotal > 0)
      .map((a) => ({
        team_id: String(a.teamId),
        points: a.pointsTotal,
        event_time_seconds:
          periodElapsed + (quarterDurationSeconds - clockToSecondsRemaining(a.clock)),
      }))
      .filter((e) => e.team_id !== '0' && e.points > 0 && e.event_time_seconds >= cutoffSeconds);
  } catch {
    return []; // play-by-play failure is non-fatal; insight detection degrades gracefully
  }
}

/**
 * Query rolling_team_stats for both teams (window_games=10).
 * Returns null for each team if no rolling stats exist yet.
 * Aliases DB column names to match the RollingTeamRow interface.
 */
async function fetchRollingContext(
  homeTeamId: string,
  awayTeamId: string
): Promise<RollingContext> {
  const rows = await sql<
    {
      team_id: string;
      window_size: number;
      avg_points: number;
      avg_fg_pct: number;
      avg_efg_pct: number;
      avg_pace: number;
      avg_off_rating: number;
      avg_def_rating: number;
      avg_net_rating: number;
      game_count: number;
      as_of_game_date: string;
    }[]
  >`
    SELECT
      team_id::text,
      window_games          AS window_size,
      COALESCE(ROUND((off_rating * pace / 100)::numeric, 1), 0) AS avg_points,
      0                     AS avg_fg_pct,
      COALESCE(efg_pct, 0)  AS avg_efg_pct,
      COALESCE(pace, 0)     AS avg_pace,
      COALESCE(off_rating, 0) AS avg_off_rating,
      COALESCE(def_rating, 0) AS avg_def_rating,
      COALESCE(net_rating, 0) AS avg_net_rating,
      COALESCE(record_wins + record_losses, 0) AS game_count,
      as_of_game_date::text
    FROM rolling_team_stats
    WHERE team_id IN (${homeTeamId}::bigint, ${awayTeamId}::bigint)
      AND window_games = 10
    ORDER BY as_of_game_date DESC
  `;
  return {
    home_rolling_10: rows.find((r) => r.team_id === homeTeamId) ?? null,
    away_rolling_10: rows.find((r) => r.team_id === awayTeamId) ?? null,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch(console.error);
