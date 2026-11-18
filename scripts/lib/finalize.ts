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
//              Docs/migrations/2026-09-audit.sql.
//
// Sources: the NBA box score (cdn.nba.com, then stats.nba.com) is official.
// When it isn't available (the NBA refuses GitHub Actions for hours after the
// buzzer), each attempt falls back to ESPN's game summary, and the last
// attempt to the box score in the game's final live_state doc (what the live
// page showed at the buzzer). Both are provisional: their team rows carry
// raw_payload.source ('espn' or 'live'), minutes from ESPN are whole numbers,
// and players we can't match to an NBA personId are left out. The nightly
// league sync (sync-league-games) re-ingests provisional games from the NBA,
// which replaces every row.
//
// Failure semantics: finalizeGame THROWS if it cannot write a complete box
// score. All writes happen in one transaction, and the game is only marked
// 'final' when at least one player row was written — so a failed game has no
// box score rows and is picked up again by finalize-games.

import type { Sql } from 'postgres';
import { sql } from './db.js';
import { fetchBoxscore } from './nba-live-client.js';
import { espnFeeds } from './live-deps.js';
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
import type { LiveStateDoc } from '../../src/lib/types/live-state.js';
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
  /**
   * An already-fetched final box score (league ingest fetches in bulk). Must
   * be final (gameStatus 3) with player rows; no fetch or retry happens.
   */
  boxscore?: NBABoxscoreResponse;
  /** The official NBA box score fetch. Default: nba-live-client fetchBoxscore. */
  fetchNba?: (gid: string) => Promise<NBABoxscoreResponse>;
  /**
   * ESPN's box score, tried on every attempt the NBA one isn't ready. Default:
   * the game's ESPN summary. null turns the fallback off.
   */
  fetchEspn?: (() => Promise<NBABoxscoreResponse>) | null;
  /**
   * The last resort, on the final attempt: the box score in the game's final
   * live_state doc (null when there is none). Default: read from live_state.
   * null turns it off.
   */
  fetchLive?: (() => Promise<NBABoxscoreResponse | null>) | null;
}

/** raw_payload.source values that mark a provisional box score (see the header). */
export const PROVISIONAL_SOURCES = ['espn', 'live'] as const;
export type ProvisionalSource = (typeof PROVISIONAL_SOURCES)[number];

/**
 * Where a provisional box score came from, or null for the NBA's own: ESPN's
 * summary (espn-live-client toBoxResponse) or the final live doc (liveDocBoxscore).
 */
export function provisionalSource(box: NBABoxscoreResponse): ProvisionalSource | null {
  const r = box.meta?.request;
  return r === 'espn' || r === 'live' ? r : null;
}

/**
 * The final live doc's box score, or null unless the doc is final, has both
 * teams' box scores, and they agree with its final score.
 */
export function liveDocBoxscore(doc: LiveStateDoc | null | undefined, gid: string): NBABoxscoreResponse | null {
  if (!doc || doc.status !== 'final' || !doc.home_box || !doc.away_box) return null;
  if (doc.home_box.score !== doc.home_score || doc.away_box.score !== doc.away_score) return null;
  return {
    meta: { version: 1, code: 200, request: 'live', time: doc.fetched_at },
    game: {
      gameId: gid,
      gameStatus: 3,
      gameStatusText: doc.status_text || 'Final',
      period: doc.period,
      gameClock: '',
      gameTimeUTC: '',
      regulationPeriods: 4,
      homeTeam: doc.home_box,
      awayTeam: doc.away_box,
    },
  };
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
 * Players with played === '0' (DNPs) get no box score row. Every player who
 * played gets a player_team_stints row for the season, and so does every LAC
 * player listed (active or not) — this keeps rosters current, the Clippers'
 * including inactive players.
 *
 * Derived advanced stats for the game are deleted in the same transaction so
 * compute-stats (incremental: games without advanced rows) recomputes them.
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

  const boxscore =
    opts.boxscore ??
    (await fetchFinalBoxscore(
      gid,
      maxRetries,
      retryDelayMs,
      opts.fetchNba ?? fetchBoxscore,
      opts.fetchEspn === undefined ? defaultEspnFetch(db, gameDbId, gid) : opts.fetchEspn,
      opts.fetchLive === undefined ? defaultLiveFetch(db, gameDbId, gid) : opts.fetchLive
    ));
  const source = provisionalSource(boxscore);
  const provisional = source !== null;
  if (boxscore.game.gameStatus !== 3) {
    throw new Error(`[finalize] ${gid}: box score is not final (gameStatus=${boxscore.game.gameStatus})`);
  }
  const { homeTeam, awayTeam } = boxscore.game;

  const playerCount = await db.begin(async (txRaw) => {
    // Cast needed because TransactionSql loses call signatures via Omit<>.
    const tx = txRaw as unknown as Db;

    const [existing] = await tx<{ rows: number; provisional: boolean | null }[]>`
      SELECT COUNT(*)::int AS rows,
             bool_or(raw_payload->>'source' = ANY(${[...PROVISIONAL_SOURCES]}::text[])) AS provisional
      FROM game_team_box_scores WHERE game_id = ${gameDbId}::bigint
    `;
    if (provisional && existing.rows > 0 && !existing.provisional) {
      console.log(`[finalize] ${gid}: already has the official NBA box score; not replacing it (${source})`);
      return null;
    }
    // A provisional box score is replaced whole: its player rows may include
    // players the new box score resolves differently or leaves out.
    if (existing.provisional) {
      await tx`DELETE FROM game_player_box_scores WHERE game_id = ${gameDbId}::bigint`;
    }

    const homeTeamDbId = await resolveTeamDbId(tx, homeTeam, game.home_team_id, 'home', gid);
    const awayTeamDbId = await resolveTeamDbId(tx, awayTeam, game.away_team_id, 'away', gid);

    // Write team box scores (use NBA-provided team aggregates directly)
    // raw_payload keeps the team statistics plus the per-period line score
    // (read by /api/history/games/[id] as game.periods).
    // source marks a provisional box score (see the header).
    const teamPayload = (t: typeof homeTeam) =>
      JSON.stringify({ ...t.statistics, periods: t.periods ?? [], ...(source ? { source } : {}) });
    await upsertTeamBoxScore(gameDbId, homeTeamDbId, true, homeTeam.statistics, teamPayload(homeTeam), tx);
    await upsertTeamBoxScore(gameDbId, awayTeamDbId, false, awayTeam.statistics, teamPayload(awayTeam), tx);

    const resolver = new PlayerResolver(tx, provisional);
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

        if (game.season_id !== null) {
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

    // Box score (re)written → derived rows are stale; compute-stats rebuilds them.
    await tx`DELETE FROM advanced_team_game_stats WHERE game_id = ${gameDbId}::bigint`;
    await tx`DELETE FROM advanced_player_game_stats WHERE game_id = ${gameDbId}::bigint`;

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

  if (playerCount === null) return;
  console.log(
    `[finalize] Game ${gid}: team + ${playerCount} player box score rows written` +
      `${source ? ` from ${source === 'espn' ? 'ESPN' : 'the final live doc'} (provisional until the nightly NBA sync)` : ''}; marked final`
  );
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/** Why a fetched box score can't be written yet, or null when it can. */
function notReadyReason(box: NBABoxscoreResponse): string | null {
  const { gameStatus, homeTeam, awayTeam } = box.game;
  if (gameStatus !== 3) return `game not final yet (gameStatus=${gameStatus})`;
  const played = homeTeam.players.some(p => p.played === '1') || awayTeam.players.some(p => p.played === '1');
  return played ? null : 'no player data yet';
}

async function tryFetch(fetch: () => Promise<NBABoxscoreResponse>): Promise<NBABoxscoreResponse | string> {
  try {
    const box = await fetch();
    return notReadyReason(box) ?? box;
  } catch (err) {
    return (err as Error).message;
  }
}

/** The game's ESPN summary as a box score; the ESPN event is looked up once. */
function defaultEspnFetch(db: Db, gameDbId: string, gid: string): () => Promise<NBABoxscoreResponse> {
  const feeds = espnFeeds(db as unknown as Sql, gameDbId, gid);
  return async () => {
    const r = await feeds.fetchBox(gid);
    if (r.status !== 200) throw new Error(`ESPN box score HTTP ${r.status}`);
    return r.body;
  };
}

/** The box score in the game's final live_state doc, or null. */
function defaultLiveFetch(db: Db, gameDbId: string, gid: string): () => Promise<NBABoxscoreResponse | null> {
  return async () => {
    const [row] = await db<{ state: LiveStateDoc }[]>`
      SELECT state FROM live_state WHERE game_id = ${gameDbId}::bigint
    `;
    return liveDocBoxscore(row?.state, gid);
  };
}

/**
 * Fetch the box score, retrying while it isn't final or has no player rows.
 * Each attempt asks the NBA first, then ESPN; the last attempt then takes the
 * final live doc's box score.
 */
async function fetchFinalBoxscore(
  gid: string,
  maxRetries: number,
  retryDelayMs: number,
  fetchNba: (gid: string) => Promise<NBABoxscoreResponse>,
  fetchEspn: (() => Promise<NBABoxscoreResponse>) | null,
  fetchLive: (() => Promise<NBABoxscoreResponse | null>) | null
): Promise<NBABoxscoreResponse> {
  let lastReason = 'unknown';
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const nba = await tryFetch(() => fetchNba(gid));
    if (typeof nba !== 'string') return nba;
    lastReason = `NBA: ${nba}`;
    if (fetchEspn) {
      const espn = await tryFetch(fetchEspn);
      if (typeof espn !== 'string') {
        console.log(`[finalize] ${gid}: NBA box score unavailable (${nba}); using ESPN's`);
        return espn;
      }
      lastReason += `; ESPN: ${espn}`;
    }
    if (fetchLive && attempt === maxRetries) {
      const live = await tryFetch(async () => {
        const box = await fetchLive();
        if (!box) throw new Error('no final live doc with both box scores');
        return box;
      });
      if (typeof live !== 'string') {
        console.log(`[finalize] ${gid}: ${lastReason}; using the final live doc's box score`);
        return live;
      }
      lastReason += `; live doc: ${live}`;
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
    SELECT team_id::text FROM teams WHERE abbreviation = ${team.teamTricode} ORDER BY team_id LIMIT 1
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

  /** provisional: an ESPN box score, whose unmatched players carry -espnId. */
  constructor(private readonly tx: Db, private readonly provisional = false) {}

  async resolve(player: BoxscorePlayer): Promise<string | null> {
    const personId = Number(player.personId);
    if (this.provisional && Number.isSafeInteger(personId) && personId < 0) return this.resolveByNameOnly(player);
    if (!Number.isSafeInteger(personId) || personId <= 0) {
      console.warn(`[finalize] Skipping player "${player.name}": invalid personId ${player.personId}`);
      return null;
    }

    const [byId] = await this.tx<{ player_id: string }[]>`
      SELECT player_id::text FROM players WHERE nba_person_id = ${personId}
    `;
    if (byId) return byId.player_id;

    // Loaded lazily, once per game: only needed the first time a personId is unseen.
    this.candidates ??= await this.loadUnclaimed();
    const match = pickUniqueNameMatch(player.name, this.candidates);
    if (match) {
      this.candidates = this.candidates.filter(c => c.player_id !== match.player_id);
      // Only claim the row if it is still unclaimed; otherwise it belongs to
      // another NBA person and this player gets their own row below.
      const claimed = await this.tx<{ player_id: string }[]>`
        UPDATE players SET nba_person_id = ${personId}, is_active = true, updated_at = now()
        WHERE player_id = ${match.player_id}::bigint AND nba_person_id IS NULL
        RETURNING player_id::text
      `;
      if (claimed.length > 0) return match.player_id;
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

  /**
   * An ESPN player with no NBA personId: a unique name match, without
   * claiming the row (there's no NBA id to record). No match → skipped; the
   * NBA re-ingest adds them.
   */
  private async resolveByNameOnly(player: BoxscorePlayer): Promise<string | null> {
    this.candidates ??= await this.loadUnclaimed();
    const match = pickUniqueNameMatch(player.name, this.candidates);
    if (match) {
      this.candidates = this.candidates.filter(c => c.player_id !== match.player_id);
      return match.player_id;
    }
    console.warn(`[finalize] Skipping ESPN player "${player.name}": no NBA personId and no unique name match`);
    return null;
  }

  private loadUnclaimed(): Promise<PlayerNameCandidate[]> {
    return this.tx<PlayerNameCandidate[]>`
      SELECT player_id::text, display_name, first_name, last_name, is_active
      FROM players
      WHERE nba_person_id IS NULL
    `;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
