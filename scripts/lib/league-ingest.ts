// scripts/lib/league-ingest.ts
// Writes one final NBA box score (any two teams) to the database: the games
// row (created or matched — see upsertGameRow) and team/player box scores
// (finalizeGame). Used by scripts/sync-league-games.ts.
import { sql } from './db.js';
import { upsertGameRow } from './upserts.js';
import { finalizeGame } from './finalize.js';
import { easternDateOf, isPlayoffNbaGameId } from './schedule-utils.js';
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
