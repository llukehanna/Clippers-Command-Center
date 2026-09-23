// scripts/lib/finalize.ts
// Shared finalization logic: writes post-game box scores (team + player) from
// NBA live JSON to game_team_box_scores and game_player_box_scores.
// Used by both poll-live.ts (inline, auto-triggered on Final) and
// finalize-games.ts (catch-up script for missed games).
//
// ID mapping (teams/players tables are keyed by balldontlie ids, NOT NBA ids):
//   - Teams:   teams.abbreviation = boxscore teamTricode, cross-checked against
//              the games row's home/away team ids.
//   - Players: players.nba_person_id = boxscore personId; else a unique
//              name match (nba_person_id is then backfilled); else a new
//              players row (nba_player_id NULL). Requires the columns from
//              docs/migrations/2026-09-audit.sql.
//
// Failure semantics: finalizeGame THROWS if it cannot write a complete box
// score. All writes happen in one transaction, and the game is only marked
// 'final' when at least one player row was written — so a failed game has no
// box score rows and is picked up again by finalize-games.

import { sql } from './db.js';
import { fetchBoxscore } from './nba-live-client.js';
import {
  upsertTeamBoxScore,
  upsertPlayerBoxScore,
  upsertStintForPlayer,
  type Db,
} from './upserts.js';
import { toNbaGameId10 } from './schedule-utils.js';
import {
  pickUniqueNameMatch,
  splitPersonName,
  type PlayerNameCandidate,
} from './player-match.js';
import type {
  BoxscorePlayer,
  BoxscoreTeam,
  NBABoxscoreResponse,
} from '../../src/lib/types/live.js';

const MAX_FINALIZE_RETRIES = 3;
const RETRY_DELAY_MS = 60_000;
const LAC_TRICODE = 'LAC';

export interface FinalizeOptions {
  /** Root postgres client to use (not a transaction handle). Defaults to scripts/lib/db. */
  db?: Db;
  /** Fetch attempts while the NBA API lags after the buzzer. Default 3. */
  maxRetries?: number;
  /** Delay between fetch attempts. Default 60s. */
  retryDelayMs?: number;
}

/**
 * Writes final box scores (team + player) from NBA live JSON to the database
 * and marks the game final.
 *
 * @param gameDbId  internal games.game_id
 * @param nbaGameId official NBA game id, either 10-char ("0022501199") or as
 *                  stored in games.nba_game_id (22501199). Balldontlie ids are
 *                  rejected — they cannot be used against cdn.nba.com.
 *
 * Retries the fetch up to maxRetries times if the game is not final yet or
 * player rows are absent (NBA API lag after game ends).
 *
 * Team totals are taken from NBA-provided homeTeam.statistics / awayTeam.statistics
 * directly — never aggregated from player rows.
 *
 * Players with played === '0' (DNPs) get no box score row, but LAC players
 * listed in the box score (active or not) get a player_team_stints row for the
 * season — this is what keeps the Clippers roster current.
 *
 * Throws on failure. Running this on an already-finalized game is safe
 * (ON CONFLICT DO UPDATE).
 */
export async function finalizeGame(
  gameDbId: string,
  nbaGameId: string,
  opts: FinalizeOptions = {}
): Promise<void> {
  const db = opts.db ?? sql;
  const maxRetries = opts.maxRetries ?? MAX_FINALIZE_RETRIES;
  const retryDelayMs = opts.retryDelayMs ?? RETRY_DELAY_MS;

  const [game] = await db<{
    season_id: number | null;
    game_date: string;
    home_team_id: string;
    away_team_id: string;
  }[]>`
    SELECT season_id, game_date::text AS game_date,
           home_team_id::text AS home_team_id, away_team_id::text AS away_team_id
    FROM games WHERE game_id = ${gameDbId}::bigint
  `;
  if (!game) throw new Error(`[finalize] game_id ${gameDbId} not found in games table`);

  const gid = toNbaGameId10(nbaGameId, game.season_id);
  if (!gid) {
    throw new Error(
      `[finalize] game_id ${gameDbId}: nba_game_id ${nbaGameId} is not an official NBA game id ` +
        `(likely a balldontlie id). Run scripts/backfill-schedule-nba.ts to attach the NBA id.`
    );
  }

  const boxscore = await fetchFinalBoxscore(gid, maxRetries, retryDelayMs);
  const { homeTeam, awayTeam } = boxscore.game;

  const playerCount = await db.begin(async (txRaw) => {
    // Same cast as upsertBoxScoresForGame: TransactionSql loses call signatures via Omit<>.
    const tx = txRaw as unknown as Db;

    const homeTeamDbId = await resolveTeamDbId(tx, homeTeam, game.home_team_id, 'home', gid);
    const awayTeamDbId = await resolveTeamDbId(tx, awayTeam, game.away_team_id, 'away', gid);

    // Write team box scores (use NBA-provided team aggregates directly)
    await upsertTeamBoxScore(gameDbId, homeTeamDbId, true, homeTeam.statistics, JSON.stringify(homeTeam.statistics), tx);
    await upsertTeamBoxScore(gameDbId, awayTeamDbId, false, awayTeam.statistics, JSON.stringify(awayTeam.statistics), tx);

    const resolver = new PlayerResolver(tx);
    let written = 0;
    for (const [team, teamDbId] of [
      [homeTeam, homeTeamDbId],
      [awayTeam, awayTeamDbId],
    ] as const) {
      const isLac = team.teamTricode === LAC_TRICODE;
      for (const player of team.players) {
        const played = player.played === '1';
        // Non-LAC DNPs need nothing; skip resolving (avoids creating player rows).
        if (!played && !isLac) continue;

        const playerDbId = await resolver.resolve(player);
        if (!playerDbId) continue;

        if (isLac && game.season_id !== null) {
          await upsertStintForPlayer(
            playerDbId,
            teamDbId,
            game.season_id,
            { startDate: game.game_date, jerseyNumber: player.jerseyNum },
            tx
          );
        }

        if (!played) continue; // no box score row for DNPs
        await upsertPlayerBoxScore(gameDbId, playerDbId, teamDbId, player.starter === '1', player, tx);
        written++;
      }
    }

    if (written === 0) {
      // Rolls back the team rows too, so finalize-games retries this game.
      throw new Error(`[finalize] 0 player box score rows resolved for game ${gid} — not marking final`);
    }

    await tx`
      UPDATE games SET
        status     = 'final',
        home_score = ${homeTeam.score},
        away_score = ${awayTeam.score},
        updated_at = now()
      WHERE game_id = ${gameDbId}::bigint
    `;
    return written;
  });

  console.log(`[finalize] Game ${gid}: team + ${playerCount} player box score rows written; marked final`);
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Fetch the box score, retrying while the game isn't final or player rows are missing. */
async function fetchFinalBoxscore(
  gid: string,
  maxRetries: number,
  retryDelayMs: number
): Promise<NBABoxscoreResponse> {
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const boxscore = await fetchBoxscore(gid);
      const { gameStatus, homeTeam, awayTeam } = boxscore.game;
      const hasPlayerData =
        homeTeam.players.some(p => p.played === '1') ||
        awayTeam.players.some(p => p.played === '1');

      if (gameStatus !== 3) {
        lastReason = `game not final yet (gameStatus=${gameStatus})`;
      } else if (!hasPlayerData) {
        lastReason = 'no player data yet (NBA API lag)';
      } else {
        return boxscore;
      }
    } catch (err) {
      lastReason = (err as Error).message;
    }
    console.warn(`[finalize] ${gid} attempt ${attempt}/${maxRetries}: ${lastReason}`);
    if (attempt < maxRetries) await sleep(retryDelayMs);
  }
  throw new Error(`[finalize] FAILED after ${maxRetries} attempts for game ${gid}: ${lastReason}`);
}

/**
 * Internal team id for a box score team, by tricode. The games row is the
 * source of truth for which teams played: a tricode that resolves to a
 * different team means the id mapping is wrong, so we refuse to write. If the
 * tricode can't be resolved at all (e.g. a stats.nba.com fallback payload
 * without team info), fall back to the games row.
 */
async function resolveTeamDbId(
  tx: Db,
  team: BoxscoreTeam,
  expectedTeamDbId: string,
  side: 'home' | 'away',
  gid: string
): Promise<string> {
  const [row] = await tx<{ team_id: string }[]>`
    SELECT team_id::text FROM teams WHERE abbreviation = ${team.teamTricode} LIMIT 1
  `;
  if (!row) {
    console.warn(
      `[finalize] ${gid}: ${side} tricode "${team.teamTricode}" not in teams — using games.${side}_team_id`
    );
    return expectedTeamDbId;
  }
  if (row.team_id !== expectedTeamDbId) {
    throw new Error(
      `[finalize] ${gid}: ${side} team ${team.teamTricode} (team_id ${row.team_id}) does not match ` +
        `games.${side}_team_id ${expectedTeamDbId} — refusing to write box scores`
    );
  }
  return row.team_id;
}

/**
 * Maps NBA personIds to internal players.player_id:
 *   1. players.nba_person_id = personId
 *   2. unique name match among rows without nba_person_id → backfill nba_person_id
 *   3. insert a new players row (nba_player_id NULL, nba_person_id set)
 */
class PlayerResolver {
  private candidates: PlayerNameCandidate[] | null = null;

  constructor(private readonly tx: Db) {}

  async resolve(player: BoxscorePlayer): Promise<string | null> {
    const personId = Number(player.personId);
    if (!Number.isSafeInteger(personId) || personId <= 0) {
      console.warn(`[finalize] Skipping player "${player.name}": invalid personId ${player.personId}`);
      return null;
    }

    const [byId] = await this.tx<{ player_id: string }[]>`
      SELECT player_id::text FROM players WHERE nba_person_id = ${personId}
    `;
    if (byId) return byId.player_id;

    // Loaded lazily, once per game: only needed the first time a personId is unseen.
    this.candidates ??= await this.tx<PlayerNameCandidate[]>`
      SELECT player_id::text, display_name, first_name, last_name, is_active
      FROM players
      WHERE nba_person_id IS NULL
    `;
    const match = pickUniqueNameMatch(player.name, this.candidates);
    if (match) {
      await this.tx`
        UPDATE players SET nba_person_id = ${personId}, is_active = true, updated_at = now()
        WHERE player_id = ${match.player_id}::bigint AND nba_person_id IS NULL
      `;
      this.candidates = this.candidates.filter(c => c.player_id !== match.player_id);
      return match.player_id;
    }

    // Unknown to the balldontlie-seeded table (rookie, two-way, name mismatch,
    // or ambiguous name) — create a row keyed by NBA personId.
    const raw = player as BoxscorePlayer & { firstName?: string; familyName?: string };
    const split = splitPersonName(player.name);
    const firstName = raw.firstName?.trim() || split.firstName;
    const lastName = raw.familyName?.trim() || split.lastName;
    const displayName = player.name.trim() || `${firstName} ${lastName}`.trim();
    const [inserted] = await this.tx<{ player_id: string }[]>`
      INSERT INTO players (nba_player_id, nba_person_id, first_name, last_name, display_name, is_active)
      VALUES (NULL, ${personId}, ${firstName}, ${lastName}, ${displayName}, true)
      ON CONFLICT (nba_person_id) DO UPDATE SET updated_at = now()
      RETURNING player_id::text
    `;
    console.log(`[finalize] New player row for ${displayName} (NBA personId ${personId})`);
    return inserted.player_id;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
