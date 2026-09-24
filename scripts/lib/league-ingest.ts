// scripts/lib/league-ingest.ts
// Writes one final NBA box score (any two teams) to the database: the games
// row (created or matched — see upsertGameRow) and team/player box scores
// (finalizeGame). Used by scripts/sync-league-games.ts.
import { sql } from './db.js';
import { upsertGameRow } from './upserts.js';
import { finalizeGame } from './finalize.js';
import { easternDateOf, isNbaFormatGameId, isPlayoffNbaGameId } from './schedule-utils.js';
import type { NBABoxscoreResponse } from '../../src/lib/types/live.js';

const teamIdCache = new Map<string, string | null>();

async function teamIdByTricode(tricode: string): Promise<string | null> {
  if (!teamIdCache.has(tricode)) {
    const [row] = await sql<{ team_id: string }[]>`
      SELECT team_id::text FROM teams WHERE abbreviation = ${tricode} LIMIT 1
    `;
    teamIdCache.set(tricode, row?.team_id ?? null);
  }
  return teamIdCache.get(tricode)!;
}

/** Upserts the games row for a final box score and writes its box scores. Returns games.game_id. */
export async function ingestBoxscore(seasonId: number, box: NBABoxscoreResponse): Promise<string> {
  const g = box.game;
  if (g.gameStatus !== 3) throw new Error(`game ${g.gameId} is not final (gameStatus=${g.gameStatus})`);
  const [homeTeamId, awayTeamId] = await Promise.all([
    teamIdByTricode(g.homeTeam.teamTricode),
    teamIdByTricode(g.awayTeam.teamTricode),
  ]);
  if (!homeTeamId || !awayTeamId) {
    throw new Error(`team not in DB (${g.awayTeam.teamTricode} @ ${g.homeTeam.teamTricode})`);
  }
  const gameDate = easternDateOf(g.gameTimeUTC);
  if (!gameDate) throw new Error(`bad gameTimeUTC ${g.gameTimeUTC}`);

  await upsertGameRow({
    nbaGameId: g.gameId,
    seasonId,
    gameDate,
    status: 'final',
    startTimeUtc: g.gameTimeUTC,
    homeTeamId,
    awayTeamId,
    homeScore: g.homeTeam.score,
    awayScore: g.awayTeam.score,
    period: null,
    clock: null,
    isPlayoffs: isPlayoffNbaGameId(g.gameId),
  });

  // Matched by NBA id, or by (date, home, away) when a row predates the NBA id.
  const [row] = await sql<{ game_id: string }[]>`
    SELECT game_id::text FROM games
    WHERE nba_game_id = ${g.gameId}
       OR (game_date = ${gameDate}::date AND home_team_id = ${homeTeamId}::bigint AND away_team_id = ${awayTeamId}::bigint)
    ORDER BY (nba_game_id = ${g.gameId}) DESC
    LIMIT 1
  `;
  if (!row) throw new Error('games row missing after upsert');
  await finalizeGame(row.game_id, g.gameId, { boxscore: box });
  return row.game_id;
}

// ── Duplicate rows ──────────────────────────────────────────────────────────

export interface LikelyDuplicate {
  stale_id: string;
  stale_date: string;
  stale_nba_game_id: string;
  real_id: string;
  real_date: string;
  matchup: string;
}

/**
 * Final games WITHOUT box scores next to the same matchup WITH box scores
 * (±1 day) in a season: an older provider row the ingest did not match (e.g.
 * its date was a day off), so the real game now has two rows. Scheduled games
 * are ignored so two-game series don't count.
 */
export async function findLikelyDuplicates(seasonId: number): Promise<LikelyDuplicate[]> {
  return sql<LikelyDuplicate[]>`
    SELECT s.game_id::text AS stale_id, s.game_date::text AS stale_date,
           s.nba_game_id::text AS stale_nba_game_id,
           r.game_id::text AS real_id, r.game_date::text AS real_date,
           a.abbreviation || ' @ ' || h.abbreviation AS matchup
    FROM games s
    JOIN games r ON r.home_team_id = s.home_team_id AND r.away_team_id = s.away_team_id
                AND r.game_id <> s.game_id AND abs(r.game_date - s.game_date) <= 1
    JOIN teams h ON h.team_id = s.home_team_id
    JOIN teams a ON a.team_id = s.away_team_id
    WHERE s.season_id = ${seasonId} AND r.season_id = ${seasonId}
      AND s.status = 'final'
      AND NOT EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = s.game_id)
      AND EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = r.game_id)
    ORDER BY s.game_date
  `;
}

/**
 * Deletes a stale duplicate found by findLikelyDuplicates, only when it is
 * safe: the row still has no box scores, its id is not an official NBA id for
 * the season (it came from an older provider), and no other table references
 * it. Returns null when deleted, else the reason it was kept.
 */
export async function removeStaleDuplicate(d: LikelyDuplicate, seasonId: number): Promise<string | null> {
  if (isNbaFormatGameId(d.stale_nba_game_id, seasonId)) return 'has an official NBA id';
  return sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof sql;
    const [boxes] = await tx<{ n: number }[]>`
      SELECT (SELECT COUNT(*) FROM game_team_box_scores WHERE game_id = ${d.stale_id}::bigint)
           + (SELECT COUNT(*) FROM game_player_box_scores WHERE game_id = ${d.stale_id}::bigint) AS n
    `;
    if (Number(boxes.n) > 0) return 'has box scores';

    const refs = await tx<{ tbl: string; col: string }[]>`
      SELECT cl.relname AS tbl, att.attname AS col
      FROM pg_constraint c
      JOIN pg_class cl ON cl.oid = c.conrelid
      JOIN pg_attribute att ON att.attrelid = c.conrelid AND att.attnum = ANY (c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'games'::regclass
    `;
    for (const { tbl, col } of refs) {
      const [row] = await tx.unsafe<{ n: string }[]>(
        `SELECT COUNT(*) AS n FROM "${tbl}" WHERE "${col}" = $1::bigint`, [d.stale_id]
      );
      if (Number(row.n) > 0) return `referenced by ${tbl}.${col}`;
    }

    await tx`DELETE FROM games WHERE game_id = ${d.stale_id}::bigint`;
    return null;
  });
}
