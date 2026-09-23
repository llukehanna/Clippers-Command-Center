// app/api/cron/poll-live/route.ts
// Stateless live-poll route: one NBA CDN fetch + DB write per invocation.
// Triggered every 5 minutes by GitHub Actions (.github/workflows/poll-live.yml)
// with `Authorization: Bearer $CRON_SECRET`. No while-loop, no backoff state,
// no in-request sleeps.
//
// When the scoreboard reports the game Final, this route only marks the games
// row 'final'. Box scores are written by the nightly post-game pipeline
// (`npm run finalize-games`, which picks up final games with no box scores).

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sql } from '@/src/lib/db';
import {
  fetchScoreboard,
  fetchBoxscore,
  fetchPlayByPlay,
  parseNBAClock,
  clockToSecondsRemaining,
} from '../../../../scripts/lib/nba-live-client';
import { findClippersGame, LAC_TEAM_ID } from '../../../../scripts/lib/poll-live-logic';
import type { ScoreboardGame, BoxscoreTeam } from '@/src/lib/types/live';
import type { ScoringEvent } from '@/src/lib/insights/live';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SnapshotPayload {
  is_stale: boolean;
  stale_reason: string | null;
  home_box: BoxscoreTeam | null;
  away_box: BoxscoreTeam | null;
  recent_scoring: ScoringEvent[];
}

type Json = Parameters<typeof sql.json>[0];

// ── Constants ─────────────────────────────────────────────────────────────────

const RECENT_SCORING_LOOKBACK_SECONDS = 120; // last 2 minutes of play-by-play

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Constant-time comparison of the Authorization header against the secret. */
function isAuthorized(authHeader: string | null, cronSecret: string): boolean {
  if (!authHeader) return false;
  const provided = Buffer.from(authHeader);
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // Fail closed: without a configured secret nobody may trigger DB writes.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/poll-live] CRON_SECRET is not configured — refusing request');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (!isAuthorized(request.headers.get('authorization'), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // 1. Query games table for active/imminent Clippers game
    const candidate = await findActiveClippersGameInDB();
    if (!candidate) {
      return NextResponse.json({ state: 'NO_ACTIVE_GAME' }, { status: 200 });
    }

    // 2. Fetch scoreboard from NBA CDN
    const scoreboard = await fetchScoreboard();
    const game = findClippersGame(scoreboard.scoreboard.games);

    if (!game) {
      return NextResponse.json({ state: 'NO_ACTIVE_GAME' }, { status: 200 });
    }

    // 3. Fetch boxscore and play-by-play in parallel (non-fatal if either fails).
    //    The CDN is keyed by the 10-char NBA game id (e.g. "0022500123") from the
    //    scoreboard — games.nba_game_id is a BIGINT that may be a BDL id or an
    //    NBA id with its leading zeros stripped, so it must not be used here.
    const nbaCdnGameId = game.gameId;
    const [boxscoreResult, pbpResult] = await Promise.allSettled([
      fetchBoxscore(nbaCdnGameId, nbaCdnGameId),
      fetchPlayByPlay(nbaCdnGameId),
    ]);

    let homeBox: BoxscoreTeam | null = null;
    let awayBox: BoxscoreTeam | null = null;
    if (boxscoreResult.status === 'fulfilled') {
      homeBox = boxscoreResult.value.game.homeTeam;
      awayBox = boxscoreResult.value.game.awayTeam;
    } else {
      console.warn(
        `[cron/poll-live] Boxscore fetch failed: ${(boxscoreResult.reason as Error).message}`
      );
    }

    const recentScoring: ScoringEvent[] =
      pbpResult.status === 'fulfilled'
        ? extractRecentScoring(pbpResult.value, game)
        : [];

    // 4. Build SnapshotPayload
    const payload: SnapshotPayload = {
      is_stale: false,
      stale_reason: null,
      home_box: homeBox,
      away_box: awayBox,
      recent_scoring: recentScoring,
    };

    // 5. INSERT into live_snapshots (append-only)
    await insertSnapshot(candidate.game_id, game, payload);

    // 6. UPDATE games table row (status/period/clock/scores from the scoreboard).
    //    gameStatus 3 (Final) marks the row 'final'; the nightly finalize-games
    //    job then writes box scores for final games that have none.
    await updateGamesRow(candidate.game_id, game);
    if (game.gameStatus === 3) {
      console.log(
        `[cron/poll-live] Game ${nbaCdnGameId} is Final — marked final; box scores deferred to nightly finalize-games.`
      );
    }

    return NextResponse.json({ state: 'OK', snapshot_written: true }, { status: 200 });
  } catch (err) {
    // Log details server-side only; return a generic non-2xx so failures are visible.
    console.error('[cron/poll-live] Unhandled error:', err);
    return NextResponse.json({ state: 'ERROR', message: 'Poll cycle failed' }, { status: 500 });
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Query the games table for a Clippers game with status 'in_progress'
 * (dated today or yesterday, ET) OR scheduled today within a 30-minute window.
 * Inlined from scripts/poll-live.ts findActiveClippersGameInDB().
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
        -- in_progress rows older than yesterday (ET) are stale rows that were
        -- never marked final; don't let them hijack today's poll.
        (
          g.status = 'in_progress'
          AND g.game_date >= (now() AT TIME ZONE 'America/New_York')::date - 1
        )
        OR (
          g.status = 'scheduled'
          AND (
            -- game_date is the US Eastern calendar date
            g.start_time_utc IS NULL AND g.game_date = (now() AT TIME ZONE 'America/New_York')::date
            OR g.start_time_utc BETWEEN now() - INTERVAL '30 minutes' AND now() + INTERVAL '30 minutes'
          )
        )
      )
    ORDER BY g.start_time_utc ASC NULLS LAST
    LIMIT 1
  `;
  return row ?? null;
}

/**
 * Plain INSERT (append-only — no ON CONFLICT) into live_snapshots.
 * Inlined from scripts/poll-live.ts insertSnapshot().
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
 * UPDATE games table status, period, clock, scores.
 * Inlined from scripts/poll-live.ts updateGamesRow().
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

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Extract recent scoring events from an already-fetched PBP response.
 * Inlined from scripts/poll-live.ts extractRecentScoring().
 * Pure/sync — no DB calls.
 */
function extractRecentScoring(
  pbp: Awaited<ReturnType<typeof fetchPlayByPlay>>,
  game: ScoreboardGame
): ScoringEvent[] {
  const quarterDurationSeconds = 720;
  const periodElapsed = (game.period - 1) * quarterDurationSeconds;
  const gameElapsedSeconds =
    periodElapsed + (quarterDurationSeconds - clockToSecondsRemaining(game.gameClock));
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
}

// Suppress unused import warning — LAC_TEAM_ID used for type-checking the
// scoreboard game identity (imported alongside findClippersGame).
void LAC_TEAM_ID;
