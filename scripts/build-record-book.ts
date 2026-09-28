// scripts/build-record-book.ts
// Rebuilds the record book from scratch (it is small):
//   rb_game_highs — top single-game values per scope (see lib/record-book/highs.ts)
//   rb_streaks    — every qualifying streak of relevant players and the Clippers
//   app_kv 'insights.records_start' — first season of complete records
//   app_kv 'insights.pbp_records_start' — first season of complete play-by-play
//     records (quarters, runs, clutch); deleted when no season qualifies
// Relevant players: a regular-season Clippers game in the last RELEVANT_SEASONS
// seasons that have Clippers box scores. Regular season only.
//
// Run via: npm run build-record-book
import { sql } from './lib/db.js';
import { seasonLabel } from './lib/schedule-utils.js';
import { REGULAR_SEASON } from './lib/sql-fragments.js';
import { buildHighsSql, highsParams, HIGH_SPECS, RELEVANT_PLAYERS } from './lib/record-book/highs.js';
import {
  computeStreaks, PLAYER_STREAK_DEFS, TEAM_STREAK_DEFS, type PlayerStreakGame, type TeamStreakGame,
} from './lib/record-book/streaks.js';
import {
  resolvePbpRecordsStart, resolveRecordsStart, type PbpCoverage, type SeasonCoverage,
} from './lib/record-book/records-start.js';

const RELEVANT_SEASONS = 3;
const log = (msg: string) => console.log(`[record-book] ${msg}`);

async function main() {
  const [lac] = await sql<{ team_id: string }[]>`SELECT team_id::text FROM teams WHERE abbreviation = 'LAC' ORDER BY team_id LIMIT 1`;
  if (!lac) throw new Error('LAC team not found');
  const [latest] = await sql<{ season_id: number | null }[]>`
    SELECT MAX(g.season_id)::int AS season_id FROM games g
    WHERE EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id AND pb.team_id = ${lac.team_id}::bigint)`;
  if (latest?.season_id == null) {
    log('No Clippers box scores — nothing to build.');
    await sql.end();
    return;
  }
  const relevantFrom = latest.season_id - (RELEVANT_SEASONS - 1);

  const playerGames = (await sql.unsafe(`
    SELECT pb.player_id::text AS "entityId", pb.team_id::text AS "teamId", pb.game_id::text AS "gameId",
           g.game_date::text AS "gameDate",
           COALESCE(pb.points, 0)::int AS pts, COALESCE(pb.rebounds, 0)::int AS reb, COALESCE(pb.assists, 0)::int AS ast,
           COALESCE(pb.steals, 0)::int AS stl, COALESCE(pb.blocks, 0)::int AS blk, COALESCE(pb.fg3_made, 0)::int AS fg3m,
           COALESCE(pb.fg_made, 0)::int AS fgm, COALESCE(pb.fg_attempted, 0)::int AS fga
    FROM game_player_box_scores pb
    JOIN games g ON g.game_id = pb.game_id
    WHERE ${REGULAR_SEASON} AND pb.player_id IN ${RELEVANT_PLAYERS}
    ORDER BY pb.player_id, g.game_date, g.game_id`, [lac.team_id, relevantFrom])) as unknown as PlayerStreakGame[];

  const teamGames = (await sql.unsafe(`
    SELECT $1::text AS "entityId", $1::text AS "teamId", g.game_id::text AS "gameId", g.game_date::text AS "gameDate",
           ((g.home_team_id = $1::bigint) = (g.home_score > g.away_score)) AS won
    FROM games g
    WHERE $1::bigint IN (g.home_team_id, g.away_team_id) AND g.status = 'final'
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND ${REGULAR_SEASON}
    ORDER BY g.game_date, g.game_id`, [lac.team_id])) as unknown as TeamStreakGame[];

  const streakRows = [
    ...computeStreaks(playerGames, PLAYER_STREAK_DEFS).map((s) => ({ ...s, entityType: 'player' })),
    ...computeStreaks(teamGames, TEAM_STREAK_DEFS).map((s) => ({ ...s, entityType: 'team' })),
  ].map((s) => ({
    entity_type: s.entityType, entity_id: s.entityId, streak_key: s.streakKey, length: s.length,
    start_date: s.startDate, end_date: s.endDate, start_game_id: s.startGameId, end_game_id: s.endGameId,
    is_active: s.isActive, team_id: s.teamId,
  }));

  let start: number | null = null;
  let pbpStart: number | null = null;
  await sql.begin(async (txRaw) => {
    const tx = txRaw as unknown as typeof sql;
    await tx`DELETE FROM rb_game_highs`;
    for (const s of HIGH_SPECS) await tx.unsafe(buildHighsSql(s), highsParams(s, lac.team_id, relevantFrom));
    await tx`DELETE FROM rb_streaks`;
    for (let i = 0; i < streakRows.length; i += 1000) await tx`INSERT INTO rb_streaks ${tx(streakRows.slice(i, i + 1000))}`;

    const coverage = await tx<SeasonCoverage[]>`
      SELECT g.season_id::int AS season_id, COUNT(*)::int AS games_with_box
      FROM games g
      WHERE g.status = 'final' AND g.season_id IS NOT NULL AND ${tx.unsafe(REGULAR_SEASON)}
        AND EXISTS (SELECT 1 FROM game_player_box_scores pb WHERE pb.game_id = g.game_id)
      GROUP BY g.season_id`;
    const [kv] = await tx<{ value: number }[]>`SELECT value::int AS value FROM app_kv WHERE key = 'history:backfilled_through'`;
    start = resolveRecordsStart(coverage, kv?.value ?? null);
    if (start !== null) {
      await tx`
        INSERT INTO app_kv (key, value, updated_at)
        VALUES ('insights.records_start', ${tx.json({ season_id: start, label: seasonLabel(start) })}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }

    // Play-by-play coverage: Clippers regular-season finals per season, and how many have a game_flow row.
    const pbpCoverage = await tx<PbpCoverage[]>`
      SELECT g.season_id::int AS season_id, COUNT(*)::int AS games,
             COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM game_flow f WHERE f.game_id = g.game_id))::int AS with_flow
      FROM games g
      WHERE ${lac.team_id}::bigint IN (g.home_team_id, g.away_team_id)
        AND g.status = 'final' AND g.season_id IS NOT NULL AND ${tx.unsafe(REGULAR_SEASON)}
      GROUP BY g.season_id`;
    pbpStart = resolvePbpRecordsStart(pbpCoverage);
    if (pbpStart !== null) {
      await tx`
        INSERT INTO app_kv (key, value, updated_at)
        VALUES ('insights.pbp_records_start', ${tx.json({ season_id: pbpStart, label: seasonLabel(pbpStart) })}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    } else {
      await tx`DELETE FROM app_kv WHERE key = 'insights.pbp_records_start'`;
    }
  });

  const [counts] = await sql<{ highs: number }[]>`SELECT COUNT(*)::int AS highs FROM rb_game_highs`;
  log(`${counts.highs} game highs, ${streakRows.length} streaks; records start ${start === null ? 'unknown' : seasonLabel(start)}; pbp records start ${pbpStart === null ? 'unknown' : seasonLabel(pbpStart)}`);
  await sql.end();
}

main().catch(async (err) => {
  console.error('[record-book] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
