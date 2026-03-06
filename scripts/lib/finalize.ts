// scripts/lib/finalize.ts
// Shared finalization logic: writes post-game box scores (team + player) from
// NBA live JSON to game_team_box_scores and game_player_box_scores.
// Used by both poll-live.ts (inline, auto-triggered on Final) and
// finalize-games.ts (catch-up script for missed games).

import { sql } from './db.js';
import { fetchBoxscore } from './nba-live-client.js';
import { upsertTeamBoxScore, upsertPlayerBoxScore } from './upserts.js';

const MAX_FINALIZE_RETRIES = 3;
const RETRY_DELAY_MS = 60_000;

/**
 * Writes final box scores (team + player) from NBA live JSON to the database.
 * Retries up to MAX_FINALIZE_RETRIES times with RETRY_DELAY_MS delay if
 * player box score rows are absent (NBA API lag after game ends).
 *
 * Team totals are taken from NBA-provided homeTeam.statistics / awayTeam.statistics
 * directly — never aggregated from player rows.
 *
 * Players with played === '0' (DNPs) are skipped — not written to DB.
 *
 * Running this on an already-finalized game is safe (ON CONFLICT DO UPDATE).
 */
export async function finalizeGame(gameDbId: string, nbaGameId: string): Promise<void> {
  for (let attempt = 1; attempt <= MAX_FINALIZE_RETRIES; attempt++) {
    try {
      const boxscore = await fetchBoxscore(nbaGameId);
      const { homeTeam, awayTeam } = boxscore.game;

      // Guard: check if player data is ready (NBA API lag after game ends)
      const hasPlayerData =
        homeTeam.players.some(p => p.played === '1') ||
        awayTeam.players.some(p => p.played === '1');

      if (!hasPlayerData) {
        console.warn(
          `[finalize] Attempt ${attempt}/${MAX_FINALIZE_RETRIES}: No player data yet — NBA API lag. Retrying in ${RETRY_DELAY_MS / 1000}s...`
        );
        if (attempt < MAX_FINALIZE_RETRIES) {
          await sleep(RETRY_DELAY_MS);
        }
        continue;
      }

      // Resolve internal DB IDs for each team
      const homeTeamDbId = await resolveTeamDbId(homeTeam.teamId);
      const awayTeamDbId = await resolveTeamDbId(awayTeam.teamId);

      // Write team box scores (use NBA-provided team aggregates directly)
      if (homeTeamDbId) {
        await upsertTeamBoxScore(
          gameDbId,
          homeTeamDbId,
          true,
          homeTeam.statistics,
          JSON.stringify(homeTeam.statistics)
        );
      }
      if (awayTeamDbId) {
        await upsertTeamBoxScore(
          gameDbId,
          awayTeamDbId,
          false,
          awayTeam.statistics,
          JSON.stringify(awayTeam.statistics)
        );
      }
      console.log(`[finalize] Team box scores written for game ${nbaGameId}`);

      // Write player box scores for both teams
      let playerCount = 0;
      for (const team of [homeTeam, awayTeam]) {
        const teamDbId = team.teamId === homeTeam.teamId ? homeTeamDbId : awayTeamDbId;
        if (!teamDbId) continue;

        for (const player of team.players) {
          if (player.played !== '1') continue; // skip DNPs (played === '0')
          const playerDbId = await resolvePlayerDbId(player.personId);
          if (!playerDbId) continue;
          await upsertPlayerBoxScore(
            gameDbId,
            playerDbId,
            teamDbId,
            player.starter === '1',
            player
          );
          playerCount++;
        }
      }
      console.log(`[finalize] Player box scores written: ${playerCount} rows for game ${nbaGameId}`);

      // Mark game as finalized in games table
      await sql`
        UPDATE games SET status = 'final', updated_at = now()
        WHERE game_id = ${gameDbId}::bigint
      `;
      return; // success

    } catch (err) {
      console.error(`[finalize] Attempt ${attempt} error: ${(err as Error).message}`);
      if (attempt < MAX_FINALIZE_RETRIES) {
        await sleep(RETRY_DELAY_MS);
      }
    }
  }
  console.error(
    `[finalize] FAILED after ${MAX_FINALIZE_RETRIES} attempts for game ${nbaGameId}. Run npm run finalize-games to retry.`
  );
}

// ── Internal helpers ───────────────────────────────────────────────────────────

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

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
