// app/api/cron/poll-live/route.ts
// Stateless Vercel Cron route: one NBA CDN fetch + DB write per invocation.
// No while-loop. No backoff state. Returns 200 on all paths (prevents Vercel
// retry storm on CDN outage). Scheduled every 60s via vercel.json crons.

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
const MAX_FINALIZE_RETRIES = 3;
const FINALIZE_RETRY_DELAY_MS = 60_000;

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(): Promise<NextResponse> {
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

    // 3. Fetch boxscore and play-by-play in parallel (non-fatal if either fails)
    const [boxscoreResult, pbpResult] = await Promise.allSettled([
      fetchBoxscore(candidate.nba_game_id, game.gameId),
      fetchPlayByPlay(candidate.nba_game_id),
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

    // 6. UPDATE games table row
    await updateGamesRow(candidate.game_id, game);

    // 7. Finalize if game is Final (gameStatus === 3)
    if (game.gameStatus === 3) {
      console.log('[cron/poll-live] Game reached Final status. Running finalization...');
      await finalizeGame(candidate.game_id, candidate.nba_game_id);
      console.log('[cron/poll-live] Finalization complete.');
    }

    return NextResponse.json({ state: 'OK', snapshot_written: true }, { status: 200 });
  } catch (err) {
    console.error('[cron/poll-live] Unhandled error:', err);
    return NextResponse.json(
      { state: 'ERROR', message: (err as Error).message },
      { status: 200 } // 200 to prevent Vercel Cron retry storm on CDN outage
    );
  }
}

// ── DB helpers ────────────────────────────────────────────────────────────────

/**
 * Query the games table for a Clippers game with status 'in_progress'
 * OR scheduled today within a 30-minute window.
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

// ── Finalization ──────────────────────────────────────────────────────────────

/**
 * Writes final box scores to DB. Inlined from scripts/lib/finalize.ts but
 * uses src/lib/db sql (Next.js-safe) instead of scripts/lib/db sql.
 * Retries up to MAX_FINALIZE_RETRIES times to handle NBA API lag after game ends.
 */
async function finalizeGame(gameDbId: string, nbaGameId: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_FINALIZE_RETRIES; attempt++) {
    try {
      const boxscore = await fetchBoxscore(nbaGameId);
      const { homeTeam, awayTeam } = boxscore.game;

      // Guard: check if player data is ready (NBA API lag after game ends)
      const hasPlayerData =
        homeTeam.players.some((p) => p.played === '1') ||
        awayTeam.players.some((p) => p.played === '1');

      if (!hasPlayerData) {
        console.warn(
          `[cron/poll-live] finalizeGame attempt ${attempt}/${MAX_FINALIZE_RETRIES}: No player data yet — NBA API lag.`
        );
        if (attempt < MAX_FINALIZE_RETRIES) {
          await sleep(FINALIZE_RETRY_DELAY_MS);
        }
        continue;
      }

      // Resolve internal DB IDs for each team
      const homeTeamDbId = await resolveTeamDbId(homeTeam.teamId);
      const awayTeamDbId = await resolveTeamDbId(awayTeam.teamId);

      // Write team box scores
      for (const [team, teamDbId, isHome] of [
        [homeTeam, homeTeamDbId, true],
        [awayTeam, awayTeamDbId, false],
      ] as const) {
        if (!teamDbId) continue;
        await sql`
          INSERT INTO game_team_box_scores (
            game_id, team_id, is_home,
            points, rebounds_total, assists, steals, blocks,
            field_goals_made, field_goals_attempted, field_goals_pct,
            three_pointers_made, three_pointers_attempted, three_pointers_pct,
            free_throws_made, free_throws_attempted, free_throws_pct,
            rebounds_offensive, rebounds_defensive, turnovers, fouls_personal,
            raw_json
          ) VALUES (
            ${gameDbId}::bigint,
            ${teamDbId}::bigint,
            ${isHome},
            ${team.statistics.points},
            ${team.statistics.reboundsTotal},
            ${team.statistics.assists},
            ${team.statistics.steals},
            ${team.statistics.blocks},
            ${team.statistics.fieldGoalsMade},
            ${team.statistics.fieldGoalsAttempted},
            ${team.statistics.fieldGoalsPercentage},
            ${team.statistics.threePointersMade},
            ${team.statistics.threePointersAttempted},
            ${team.statistics.threePointersPercentage},
            ${team.statistics.freeThrowsMade},
            ${team.statistics.freeThrowsAttempted},
            ${team.statistics.freeThrowsPercentage},
            ${team.statistics.reboundsOffensive},
            ${team.statistics.reboundsDefensive},
            ${team.statistics.turnovers},
            ${team.statistics.foulsPersonal},
            ${sql.json(team.statistics as unknown as Json)}
          )
          ON CONFLICT (game_id, team_id) DO UPDATE SET
            points = EXCLUDED.points,
            rebounds_total = EXCLUDED.rebounds_total,
            assists = EXCLUDED.assists,
            steals = EXCLUDED.steals,
            blocks = EXCLUDED.blocks,
            field_goals_made = EXCLUDED.field_goals_made,
            field_goals_attempted = EXCLUDED.field_goals_attempted,
            field_goals_pct = EXCLUDED.field_goals_pct,
            three_pointers_made = EXCLUDED.three_pointers_made,
            three_pointers_attempted = EXCLUDED.three_pointers_attempted,
            three_pointers_pct = EXCLUDED.three_pointers_pct,
            free_throws_made = EXCLUDED.free_throws_made,
            free_throws_attempted = EXCLUDED.free_throws_attempted,
            free_throws_pct = EXCLUDED.free_throws_pct,
            rebounds_offensive = EXCLUDED.rebounds_offensive,
            rebounds_defensive = EXCLUDED.rebounds_defensive,
            turnovers = EXCLUDED.turnovers,
            fouls_personal = EXCLUDED.fouls_personal,
            raw_json = EXCLUDED.raw_json
        `;
      }
      console.log(`[cron/poll-live] Team box scores written for game ${nbaGameId}`);

      // Write player box scores
      let playerCount = 0;
      for (const [team, teamDbId] of [
        [homeTeam, homeTeamDbId],
        [awayTeam, awayTeamDbId],
      ] as const) {
        if (!teamDbId) continue;
        for (const player of team.players) {
          if (player.played !== '1') continue; // skip DNPs
          const playerDbId = await resolvePlayerDbId(player.personId);
          if (!playerDbId) continue;
          await sql`
            INSERT INTO game_player_box_scores (
              game_id, player_id, team_id, is_starter,
              minutes, points, rebounds_total, assists, steals, blocks,
              field_goals_made, field_goals_attempted,
              three_pointers_made, three_pointers_attempted,
              free_throws_made, free_throws_attempted,
              rebounds_offensive, rebounds_defensive, turnovers, fouls_personal,
              plus_minus
            ) VALUES (
              ${gameDbId}::bigint,
              ${playerDbId}::bigint,
              ${teamDbId}::bigint,
              ${player.starter === '1'},
              ${player.statistics.minutes},
              ${player.statistics.points},
              ${player.statistics.reboundsTotal},
              ${player.statistics.assists},
              ${player.statistics.steals},
              ${player.statistics.blocks},
              ${player.statistics.fieldGoalsMade},
              ${player.statistics.fieldGoalsAttempted},
              ${player.statistics.threePointersMade},
              ${player.statistics.threePointersAttempted},
              ${player.statistics.freeThrowsMade},
              ${player.statistics.freeThrowsAttempted},
              ${player.statistics.reboundsOffensive},
              ${player.statistics.reboundsDefensive},
              ${player.statistics.turnovers},
              ${player.statistics.foulsPersonal},
              ${player.statistics.plusMinusPoints}
            )
            ON CONFLICT (game_id, player_id) DO UPDATE SET
              minutes = EXCLUDED.minutes,
              points = EXCLUDED.points,
              rebounds_total = EXCLUDED.rebounds_total,
              assists = EXCLUDED.assists,
              steals = EXCLUDED.steals,
              blocks = EXCLUDED.blocks,
              field_goals_made = EXCLUDED.field_goals_made,
              field_goals_attempted = EXCLUDED.field_goals_attempted,
              three_pointers_made = EXCLUDED.three_pointers_made,
              three_pointers_attempted = EXCLUDED.three_pointers_attempted,
              free_throws_made = EXCLUDED.free_throws_made,
              free_throws_attempted = EXCLUDED.free_throws_attempted,
              rebounds_offensive = EXCLUDED.rebounds_offensive,
              rebounds_defensive = EXCLUDED.rebounds_defensive,
              turnovers = EXCLUDED.turnovers,
              fouls_personal = EXCLUDED.fouls_personal,
              plus_minus = EXCLUDED.plus_minus
          `;
          playerCount++;
        }
      }
      console.log(
        `[cron/poll-live] Player box scores written: ${playerCount} rows for game ${nbaGameId}`
      );

      // Mark game as finalized
      await sql`
        UPDATE games SET status = 'final', updated_at = now()
        WHERE game_id = ${gameDbId}::bigint
      `;
      return; // success
    } catch (err) {
      console.error(`[cron/poll-live] finalizeGame attempt ${attempt} error: ${(err as Error).message}`);
      if (attempt < MAX_FINALIZE_RETRIES) {
        await sleep(FINALIZE_RETRY_DELAY_MS);
      }
    }
  }
  console.error(
    `[cron/poll-live] finalizeGame FAILED after ${MAX_FINALIZE_RETRIES} attempts for game ${nbaGameId}. Run npm run finalize-games to retry.`
  );
}

async function resolveTeamDbId(nbaTeamId: number): Promise<string | null> {
  const [row] = await sql<{ team_id: string }[]>`
    SELECT team_id::text FROM teams WHERE nba_team_id = ${nbaTeamId} LIMIT 1
  `;
  return row?.team_id ?? null;
}

async function resolvePlayerDbId(nbaPersonId: number): Promise<string | null> {
  const [row] = await sql<{ player_id: string }[]>`
    SELECT player_id::text FROM players WHERE nba_player_id = ${nbaPersonId} LIMIT 1
  `;
  return row?.player_id ?? null;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Suppress unused import warning — LAC_TEAM_ID used for type-checking the
// scoreboard game identity (imported alongside findClippersGame).
void LAC_TEAM_ID;
