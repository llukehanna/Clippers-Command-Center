// scripts/lib/history/write.ts
// Database writers for the Kaggle history import (scripts/import-kaggle-history.ts).
// Every writer takes the client or transaction handle to write through.
//
// Safety rules:
//   - Writes and lookups use all_games, not the games view, so preseason rows
//     are seen (and never reused for a regular-season game). Which existing
//     row a game maps to is decided in match-games.ts (id, then ±1 day).
//   - A game that already has player box scores is not touched at all.
//   - Box score inserts never overwrite an existing row (ON CONFLICT DO NOTHING).
import type postgres from 'postgres';
import type { KaggleGame, KagglePlayerGame, KagglePerson } from './kaggle.js';
import type { DbPlayer, MatchResult } from './match-players.js';
import type { PlayerSeasonRow, TeamSeasonRow, LeagueAverageRow } from './season-totals.js';
import { played } from './season-totals.js';
import { teamBoxFromRows, TEAM_BOX_COLUMNS, GAP_FILL_SEASON } from './import-plan.js';
import { classifyGames, type ClassifiedGame } from './match-games.js';
import { TEAM_ERAS } from './team-eras.js';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { REGULAR_SEASON } from '../sql-fragments.js';
import type { SeasonCoverage } from '../record-book/records-start.js';

export type Db = postgres.Sql;

const BATCH = 1000;
const chunks = <T>(xs: T[], n = BATCH): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

// ── Reference data ───────────────────────────────────────────────────────────

/**
 * R12: NBA franchise id -> teams.team_id via the current tricode, using only
 * the 30 current franchise rows (nba_team_id 1-30). The teams table also holds
 * defunct 1940s-50s teams, one of them abbreviated 'WAS'.
 */
export async function loadTeamIdByFranchise(db: Db): Promise<Map<number, string>> {
  const rows = await db<{ team_id: string; abbreviation: string }[]>`
    SELECT team_id::text, abbreviation FROM teams WHERE nba_team_id BETWEEN 1 AND 30`;
  const byAbbr = new Map<string, string[]>();
  for (const r of rows) byAbbr.set(r.abbreviation, [...(byAbbr.get(r.abbreviation) ?? []), r.team_id]);
  const out = new Map<number, string>();
  for (const [tricode, franchiseId] of Object.entries(NBA_TEAM_IDS)) {
    const ids = byAbbr.get(tricode) ?? [];
    if (ids.length > 1) throw new Error(`teams has ${ids.length} current rows abbreviated ${tricode}`);
    if (ids.length === 1) out.set(franchiseId, ids[0]);
  }
  return out;
}

export async function loadDbPlayers(db: Db): Promise<DbPlayer[]> {
  return db<DbPlayer[]>`
    SELECT player_id::text, nba_person_id, display_name, birthdate::text AS birthdate FROM players`;
}

/** players.player_id by nba_person_id, for every player that has one. */
export async function loadPlayerIdByPerson(db: Db): Promise<Map<number, string>> {
  const rows = await db<{ player_id: string; nba_person_id: number }[]>`
    SELECT player_id::text, nba_person_id FROM players WHERE nba_person_id IS NOT NULL`;
  return new Map(rows.map((r) => [r.nba_person_id, r.player_id]));
}

export async function databaseBytes(db: Db): Promise<number> {
  const [r] = await db<{ bytes: string }[]>`SELECT pg_database_size(current_database())::text AS bytes`;
  return Number(r.bytes);
}

// ── Players, seasons, era names ──────────────────────────────────────────────

/** Creates toCreate as inactive players and fills nba_person_id on name matches. */
export async function writePlayers(tx: Db, match: MatchResult): Promise<{ created: number; backfilled: number }> {
  let created = 0;
  const rows = match.toCreate.map((p: KagglePerson) => ({
    first_name: p.firstName, last_name: p.lastName,
    display_name: `${p.firstName} ${p.lastName}`.trim(),
    nba_person_id: p.personId, birthdate: p.birthdate, is_active: false,
  }));
  for (const batch of chunks(rows)) {
    const res = await tx`INSERT INTO players ${tx(batch)} ON CONFLICT (nba_person_id) DO NOTHING RETURNING player_id`;
    created += res.length;
  }
  let backfilled = 0;
  for (const b of match.backfillNbaId) {
    const res = await tx`
      UPDATE players SET nba_person_id = ${b.nba_person_id}, updated_at = now()
      WHERE player_id = ${b.player_id}::bigint AND nba_person_id IS NULL`;
    backfilled += res.count;
  }
  return { created, backfilled };
}

export async function upsertSeasonRows(tx: Db, seasonIds: number[]): Promise<void> {
  const rows = [...new Set(seasonIds)].map((id) => ({ season_id: id, label: `${id}-${String(id + 1).slice(-2)}` }));
  for (const batch of chunks(rows)) await tx`INSERT INTO seasons ${tx(batch)} ON CONFLICT (season_id) DO NOTHING`;
}

/** Upserts team_era_names from TEAM_ERAS; returns the tricodes with no current teams row. */
export async function upsertEraNames(tx: Db, teamIdByFranchise: Map<number, string>): Promise<string[]> {
  const missing = new Set<string>();
  const rows = [];
  for (const era of TEAM_ERAS) {
    const teamId = teamIdByFranchise.get(NBA_TEAM_IDS[era.franchiseTricode]);
    if (!teamId) { missing.add(era.franchiseTricode); continue; }
    rows.push({
      team_id: teamId, first_season_id: era.firstSeason, last_season_id: era.lastSeason,
      abbreviation: era.abbreviation, city: era.city, name: era.name,
    });
  }
  if (rows.length) {
    await tx`
      INSERT INTO team_era_names ${tx(rows)}
      ON CONFLICT (team_id, first_season_id) DO UPDATE SET
        last_season_id = EXCLUDED.last_season_id, abbreviation = EXCLUDED.abbreviation,
        city = EXCLUDED.city, name = EXCLUDED.name`;
  }
  return [...missing].sort();
}

// ── Per-game rows ────────────────────────────────────────────────────────────

export type AmbiguousGameMatch = {
  nbaGameId: number; gameDate: string;
  candidates: Array<{ game_id: string; nba_game_id: string; game_date: string }>;
};

export type SeasonWriteResult = {
  inserted: number;      // new all_games rows
  updated: number;       // existing rows (same nba_game_id) without box scores, now loaded
  reused: number;        // same-date row under another id, no box scores: now carries the NBA id
  nearReused: number;    // as reused, but the row's date was a day off (date corrected)
  skipped: number;       // untouched: already had player box scores, preseason clash, duplicate or ambiguous
  nearSkipped: number;   // of skipped: a single row a day off that already had box scores
  ambiguousMatches: AmbiguousGameMatch[]; // of skipped: two or more candidate rows within ±1 day
  playerRows: number;
  teamRows: number;
  unmappedPlayerRows: number; // played rows whose person has no player_id (ambiguous): not written
};

export function ambiguousMatchOf(c: ClassifiedGame): AmbiguousGameMatch | null {
  const d = c.decision;
  if (d.action !== 'skip' || d.reason !== 'ambiguous') return null;
  return {
    nbaGameId: c.game.nbaGameId, gameDate: c.game.gameDate,
    candidates: d.candidates.map((r) => ({ game_id: r.game_id, nba_game_id: r.nba_game_id, game_date: r.game_date })),
  };
}

export async function writeSeasonGames(
  tx: Db,
  games: KaggleGame[],
  playerRows: KagglePlayerGame[],
  ids: { teamIdByFranchise: Map<number, string>; playerIdByPerson: Map<number, string> },
): Promise<SeasonWriteResult> {
  const res: SeasonWriteResult = {
    inserted: 0, updated: 0, reused: 0, nearReused: 0, skipped: 0, nearSkipped: 0, ambiguousMatches: [],
    playerRows: 0, teamRows: 0, unmappedPlayerRows: 0,
  };
  const live = games.find((g) => g.seasonId > GAP_FILL_SEASON);
  if (live) throw new Error(`Game ${live.nbaGameId} is from ${live.seasonId}: seasons after ${GAP_FILL_SEASON} belong to the live pipeline`);
  if (games.length === 0) return res;

  const classified = await classifyGames(tx, games, ids.teamIdByFranchise);
  const gameIdByNba = new Map<number, string>();
  const toInsert: ClassifiedGame[] = [];
  const toUpdate: Array<{ game: KaggleGame; gameId: string; gameDate: string }> = [];
  for (const c of classified) {
    const d = c.decision;
    const g = c.game;
    if (d.action === 'insert') { toInsert.push(c); continue; }
    if (d.action === 'skip') {
      res.skipped++;
      if (d.reason === 'has_box' && d.near) res.nearSkipped++;
      const amb = ambiguousMatchOf(c);
      if (amb) res.ambiguousMatches.push(amb);
      if (d.reason === 'preseason') console.warn(`[import] Game ${g.nbaGameId} matches preseason row ${d.row?.nba_game_id}; skipped`);
      continue;
    }
    if (d.action === 'update') res.updated++;
    else if (d.near) res.nearReused++;
    else res.reused++;
    // An id match keeps its date; a reused row takes the Kaggle date (fixes a day-off row).
    toUpdate.push({ game: g, gameId: d.row.game_id, gameDate: d.action === 'update' ? d.row.game_date : g.gameDate });
    gameIdByNba.set(g.nbaGameId, d.row.game_id);
  }

  for (const batch of chunks(toUpdate)) {
    await tx`
      UPDATE all_games a SET
        nba_game_id = v.nid, game_date = v.gd, season_id = v.sid, status = 'final',
        home_score = v.hs, away_score = v.aws, is_playoffs = v.po, updated_at = now()
      FROM unnest(${batch.map((u) => u.gameId)}::bigint[], ${batch.map((u) => String(u.game.nbaGameId))}::bigint[],
                  ${batch.map((u) => String(u.game.seasonId))}::smallint[], ${batch.map((u) => String(u.game.homeScore))}::smallint[],
                  ${batch.map((u) => String(u.game.awayScore))}::smallint[], ${batch.map((u) => String(u.game.isPlayoffs))}::boolean[],
                  ${batch.map((u) => u.gameDate)}::date[])
           AS v(gid, nid, sid, hs, aws, po, gd)
      WHERE a.game_id = v.gid AND NOT a.is_preseason`;
  }

  for (const batch of chunks(toInsert)) {
    const rows = batch.map(({ game: g, homeTeamId, awayTeamId }) => ({
      nba_game_id: g.nbaGameId, season_id: g.seasonId, game_date: g.gameDate, status: 'final',
      home_team_id: homeTeamId, away_team_id: awayTeamId,
      home_score: g.homeScore, away_score: g.awayScore, is_playoffs: g.isPlayoffs,
    }));
    const inserted = await tx<{ game_id: string; nba_game_id: string }[]>`
      INSERT INTO all_games ${tx(rows)} ON CONFLICT DO NOTHING RETURNING game_id::text, nba_game_id::text`;
    for (const r of inserted) gameIdByNba.set(Number(r.nba_game_id), r.game_id);
    res.inserted += inserted.length;
    res.skipped += batch.length - inserted.length;
  }

  // Box scores for every game loaded above.
  const rowsByGame = new Map<number, KagglePlayerGame[]>();
  for (const r of playerRows) {
    if (!gameIdByNba.has(r.nbaGameId)) continue;
    const a = rowsByGame.get(r.nbaGameId);
    if (a) a.push(r); else rowsByGame.set(r.nbaGameId, [r]);
  }
  type Cell = string | number | boolean | null | { source: string };
  const teamRows: Array<Record<string, Cell>> = [];
  const playerBoxRows: Array<Record<string, Cell>> = [];
  for (const { game: g, homeTeamId, awayTeamId, decision } of classified) {
    if (decision.action === 'skip') continue;
    const gameId = gameIdByNba.get(g.nbaGameId);
    if (!gameId) continue;
    const rows = rowsByGame.get(g.nbaGameId) ?? [];
    for (const isHome of [true, false]) {
      const team = isHome ? homeTeamId : awayTeamId;
      const side = rows.filter((r) => r.isHome === isHome);
      const box = teamBoxFromRows(side);
      if (box) teamRows.push({ game_id: gameId, team_id: team, is_home: isHome, ...box, raw_payload: { source: 'kaggle' } });
      const seen = new Set<string>();
      for (const r of side) {
        if (!played(r)) continue;
        const playerId = ids.playerIdByPerson.get(r.personId);
        if (!playerId) { res.unmappedPlayerRows++; continue; }
        if (seen.has(playerId)) continue;
        seen.add(playerId);
        playerBoxRows.push({
          game_id: gameId, team_id: team, player_id: playerId, starter: r.starter, minutes: r.minutes,
          points: r.points, rebounds: r.rebounds, assists: r.assists, steals: r.steals, blocks: r.blocks,
          turnovers: r.turnovers, fouls: r.fouls, plus_minus: r.plusMinus,
          fg_made: r.fgMade, fg_attempted: r.fgAttempted, fg3_made: r.fg3Made, fg3_attempted: r.fg3Attempted,
          ft_made: r.ftMade, ft_attempted: r.ftAttempted, offensive_reb: r.offReb, defensive_reb: r.defReb,
        });
      }
    }
  }
  const teamCols = ['game_id', 'team_id', 'is_home', ...TEAM_BOX_COLUMNS, 'raw_payload'];
  for (const batch of chunks(teamRows)) {
    const r = await tx`INSERT INTO game_team_box_scores ${tx(batch, teamCols)} ON CONFLICT (game_id, team_id) DO NOTHING`;
    res.teamRows += r.count;
  }
  for (const batch of chunks(playerBoxRows)) {
    const r = await tx`INSERT INTO game_player_box_scores ${tx(batch)} ON CONFLICT (game_id, player_id) DO NOTHING`;
    res.playerRows += r.count;
  }
  return res;
}

// ── Season tables ────────────────────────────────────────────────────────────

const snake = (k: string) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
function snakeRow(row: object, extra: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) out[snake(k)] = v ?? null;
  return { ...out, ...extra };
}

/** Full replace of team_seasons, player_seasons and league_season_averages for the given seasons. */
export async function replaceSeasonTables(
  tx: Db,
  seasonIds: number[],
  data: { teamSeasons: TeamSeasonRow[]; playerSeasons: PlayerSeasonRow[]; leagueAverages: LeagueAverageRow[] },
  ids: { teamIdByFranchise: Map<number, string>; playerIdByPerson: Map<number, string> },
): Promise<{ teamSeasons: number; playerSeasons: number; leagueAverages: number }> {
  const seasons = [...new Set(seasonIds)];
  const inRange = <T extends { seasonId: number }>(rows: T[]) => rows.filter((r) => seasons.includes(r.seasonId));
  // Array params go as text: postgres.js does not serialize number/boolean arrays reliably.
  const seasonParam = seasons.map(String);
  await tx`DELETE FROM team_seasons WHERE season_id = ANY(${seasonParam}::smallint[])`;
  await tx`DELETE FROM player_seasons WHERE season_id = ANY(${seasonParam}::smallint[])`;
  await tx`DELETE FROM league_season_averages WHERE season_id = ANY(${seasonParam}::smallint[])`;

  const teamRows = inRange(data.teamSeasons).map((t) =>
    snakeRow(t, { team_id: ids.teamIdByFranchise.get(t.nbaFranchiseId) ?? null }));
  const playerRows = inRange(data.playerSeasons).map((p) =>
    snakeRow(p, { player_id: ids.playerIdByPerson.get(p.nbaPersonId) ?? null }));
  const avgRows = inRange(data.leagueAverages).map((a) => snakeRow(a, { games: Math.round(a.games) }));

  for (const batch of chunks(teamRows)) await tx`INSERT INTO team_seasons ${tx(batch)}`;
  for (const batch of chunks(playerRows)) await tx`INSERT INTO player_seasons ${tx(batch)}`;
  for (const batch of chunks(avgRows)) await tx`INSERT INTO league_season_averages ${tx(batch)}`;
  return { teamSeasons: teamRows.length, playerSeasons: playerRows.length, leagueAverages: avgRows.length };
}

// ── Records start ────────────────────────────────────────────────────────────

/** Final regular-season games with player box scores, per season (the shape resolveRecordsStart takes). */
export async function loadCoverage(db: Db): Promise<SeasonCoverage[]> {
  return db<SeasonCoverage[]>`
    SELECT g.season_id::int AS season_id, COUNT(*)::int AS games_with_box
    FROM games g
    WHERE g.status = 'final' AND g.season_id IS NOT NULL AND ${db.unsafe(REGULAR_SEASON)}
      AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
    GROUP BY g.season_id`;
}

export async function setBackfilledThrough(db: Db, season: number): Promise<void> {
  await db`
    INSERT INTO app_kv (key, value, updated_at) VALUES ('history:backfilled_through', ${db.json(season)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
}
