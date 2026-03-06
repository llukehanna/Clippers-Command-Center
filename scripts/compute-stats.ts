// scripts/compute-stats.ts
// Advanced Stats Engine orchestrator.
//
// Computes advanced stats for all seeded games in dependency order:
//   Step 1: Team advanced stats (reads game_team_box_scores)
//   Step 2: Player advanced stats (reads game_team_box_scores + game_player_box_scores)
//   Step 3: Team rolling windows (reads advanced_team_game_stats from Step 1)
//   Step 4: Player rolling windows (reads advanced_player_game_stats from Step 2)
//
// All four derived tables are populated idempotently (ON CONFLICT DO UPDATE).
//
// Run via: npm run compute-stats
import { sql } from './lib/db.js';
import {
  computeTeamPossessions,
  computePace,
  computeOffRating,
  computeEfgPct,
  computeTsPct,
  computeTovPct,
  computeRebPct,
  computeUsageRate,
  computeAstRate,
  computeRebRate,
  parseMinutes,
} from './lib/advanced-stats.js';
import {
  computeTeamRollingWindows,
  computePlayerRollingWindows,
} from './lib/rolling-windows.js';

// ---- Types ----

interface TeamBoxRow {
  team_id: string;
  is_home: boolean;
  points: number;
  fg_made: number;
  fg_attempted: number;
  fg3_made: number;
  fg3_attempted: number;
  ft_made: number;
  ft_attempted: number;
  offensive_reb: number;
  defensive_reb: number;
  turnovers: number;
  assists: number;
  rebounds: number;
}

interface PlayerBoxRow {
  player_id: string;
  team_id: string;
  minutes: string | null;
  points: number;
  rebounds: number;
  assists: number;
  turnovers: number;
  fg_made: number;
  fg_attempted: number;
  fg3_made: number;
  fg3_attempted: number;
  ft_made: number;
  ft_attempted: number;
  offensive_reb: number;
  defensive_reb: number;
}

// ---- Step 1 & 2: Per-game advanced stats ----

async function computeGameStats(gameId: string): Promise<void> {
  // Fetch both team box scores for this game
  const boxes = await sql<TeamBoxRow[]>`
    SELECT
      b.team_id::text,
      b.is_home,
      b.points, b.fg_made, b.fg_attempted,
      b.fg3_made, b.fg3_attempted,
      b.ft_made, b.ft_attempted,
      b.offensive_reb, b.defensive_reb,
      b.turnovers, b.assists, b.rebounds
    FROM game_team_box_scores b
    WHERE b.game_id = ${gameId}::bigint
  `;

  if (boxes.length !== 2) {
    console.warn(`  Skipping game ${gameId}: expected 2 team boxes, got ${boxes.length}`);
    return;
  }

  const [teamA, teamB] = boxes;

  // Compute possessions for each team
  const possA = computeTeamPossessions({
    fg_attempted: teamA.fg_attempted,
    ft_attempted: teamA.ft_attempted,
    offensive_reb: teamA.offensive_reb,
    turnovers: teamA.turnovers,
  });
  const possB = computeTeamPossessions({
    fg_attempted: teamB.fg_attempted,
    ft_attempted: teamB.ft_attempted,
    offensive_reb: teamB.offensive_reb,
    turnovers: teamB.turnovers,
  });

  const pace = computePace(possA, possB);

  // Upsert advanced stats for each team
  const teams: Array<[TeamBoxRow, TeamBoxRow, number, number]> = [
    [teamA, teamB, possA, possB],
    [teamB, teamA, possB, possA],
  ];

  for (const [team, opp, poss, oppPoss] of teams) {
    const offRating = computeOffRating(team.points, poss);
    const defRating = computeOffRating(opp.points, oppPoss);
    const netRating = offRating - defRating;
    const efgPct = computeEfgPct(team.fg_made, team.fg3_made, team.fg_attempted);
    const tsPct = computeTsPct(team.points, team.fg_attempted, team.ft_attempted);
    const tovPct = computeTovPct(team.turnovers, team.fg_attempted, team.ft_attempted);
    const rebPct = computeRebPct(
      team.offensive_reb,
      team.defensive_reb,
      opp.offensive_reb,
      opp.defensive_reb
    );

    await sql`
      INSERT INTO advanced_team_game_stats (
        game_id, team_id,
        possessions, pace, off_rating, def_rating, net_rating,
        efg_pct, ts_pct, tov_pct, reb_pct
      ) VALUES (
        ${gameId}::bigint, ${team.team_id}::bigint,
        ${poss}, ${pace}, ${offRating}, ${defRating}, ${netRating},
        ${efgPct}, ${tsPct}, ${tovPct}, ${rebPct}
      )
      ON CONFLICT (game_id, team_id) DO UPDATE SET
        possessions = EXCLUDED.possessions,
        pace        = EXCLUDED.pace,
        off_rating  = EXCLUDED.off_rating,
        def_rating  = EXCLUDED.def_rating,
        net_rating  = EXCLUDED.net_rating,
        efg_pct     = EXCLUDED.efg_pct,
        ts_pct      = EXCLUDED.ts_pct,
        tov_pct     = EXCLUDED.tov_pct,
        reb_pct     = EXCLUDED.reb_pct
    `;
  }

  // Step 2: Player advanced stats
  const playerRows = await sql<PlayerBoxRow[]>`
    SELECT
      p.player_id::text, p.team_id::text,
      p.minutes, p.points, p.rebounds, p.assists, p.turnovers,
      p.fg_made, p.fg_attempted, p.fg3_made, p.fg3_attempted,
      p.ft_made, p.ft_attempted,
      p.offensive_reb, p.defensive_reb
    FROM game_player_box_scores p
    WHERE p.game_id = ${gameId}::bigint
  `;

  // Build maps: team_id -> team box row
  const teamBoxMap = new Map(boxes.map(b => [b.team_id, b]));
  // Map team_id -> opponent team box row
  const oppBoxMap = new Map(
    boxes.map(b => [b.team_id, boxes.find(x => x.team_id !== b.team_id)!])
  );

  // Regulation team minutes: 5 players × 48 minutes = 240
  const TEAM_MINUTES = 240;

  for (const p of playerRows) {
    const teamBox = teamBoxMap.get(p.team_id);
    const oppBox = oppBoxMap.get(p.team_id);
    if (!teamBox) continue;

    const minutesDec = parseMinutes(p.minutes);
    const usageRate = computeUsageRate(
      {
        fg_attempted: p.fg_attempted,
        ft_attempted: p.ft_attempted,
        turnovers: p.turnovers,
        minutesDecimal: minutesDec,
      },
      {
        fg_attempted: teamBox.fg_attempted,
        ft_attempted: teamBox.ft_attempted,
        turnovers: teamBox.turnovers,
        minutesDecimal: TEAM_MINUTES,
      }
    );
    const efgPct = computeEfgPct(p.fg_made, p.fg3_made, p.fg_attempted);
    const tsPct = computeTsPct(p.points, p.fg_attempted, p.ft_attempted);
    const tovRate = computeTovPct(p.turnovers, p.fg_attempted, p.ft_attempted);
    const astRate = computeAstRate(
      { assists: p.assists, fg_made: p.fg_made, minutesDecimal: minutesDec },
      { fg_made: teamBox.fg_made, minutesDecimal: TEAM_MINUTES }
    );
    const rebRate = computeRebRate(
      { rebounds: p.rebounds, minutesDecimal: minutesDec },
      { rebounds: teamBox.rebounds, minutesDecimal: TEAM_MINUTES },
      oppBox ? oppBox.rebounds : 0
    );

    await sql`
      INSERT INTO advanced_player_game_stats (
        game_id, player_id, team_id,
        usage_rate, ts_pct, efg_pct, ast_rate, reb_rate, tov_rate
      ) VALUES (
        ${gameId}::bigint, ${p.player_id}::bigint, ${p.team_id}::bigint,
        ${usageRate}, ${tsPct}, ${efgPct}, ${astRate}, ${rebRate}, ${tovRate}
      )
      ON CONFLICT (game_id, player_id) DO UPDATE SET
        team_id    = EXCLUDED.team_id,
        usage_rate = EXCLUDED.usage_rate,
        ts_pct     = EXCLUDED.ts_pct,
        efg_pct    = EXCLUDED.efg_pct,
        ast_rate   = EXCLUDED.ast_rate,
        reb_rate   = EXCLUDED.reb_rate,
        tov_rate   = EXCLUDED.tov_rate
    `;
  }
}

// ---- Summary ----

async function printSummary(): Promise<void> {
  const [counts] = await sql<[{
    adv_team: bigint;
    adv_player: bigint;
    rolling_team: bigint;
    rolling_player: bigint;
  }]>`
    SELECT
      (SELECT count(*) FROM advanced_team_game_stats)   AS adv_team,
      (SELECT count(*) FROM advanced_player_game_stats)  AS adv_player,
      (SELECT count(*) FROM rolling_team_stats)           AS rolling_team,
      (SELECT count(*) FROM rolling_player_stats)         AS rolling_player
  `;
  console.log('\n========================================');
  console.log('Compute-stats complete.');
  console.log(`Advanced team stats:   ${counts.adv_team} rows`);
  console.log(`Advanced player stats: ${counts.adv_player} rows`);
  console.log(`Rolling team windows:  ${counts.rolling_team} rows`);
  console.log(`Rolling player windows:${counts.rolling_player} rows`);
  console.log('========================================\n');
}

// ---- Main ----

async function main(): Promise<void> {
  console.log('========================================');
  console.log('Clippers Command Center — Advanced Stats Engine');
  console.log('Compute: advanced team/player stats + rolling windows');
  console.log('========================================\n');

  // Fetch all games with box score data (ordered by date for rolling windows correctness)
  const gamesWithBoxScores = await sql<{ game_id: string; season_id: number }[]>`
    SELECT game_id, season_id
    FROM (
      SELECT DISTINCT g.game_id::text AS game_id, g.season_id
      FROM games g
      WHERE EXISTS (
        SELECT 1 FROM game_team_box_scores b
        WHERE b.game_id = g.game_id
      )
    ) sub
    ORDER BY game_id ASC
  `;

  console.log(`[1/4] Computing team advanced stats for ${gamesWithBoxScores.length} game(s)...`);
  for (const { game_id } of gamesWithBoxScores) {
    await computeGameStats(game_id);
  }
  console.log(`  Done.`);

  // Step 3: Team rolling windows — distinct (team_id, season_id) pairs
  const teamPairs = await sql<{ team_id: string; season_id: number }[]>`
    SELECT team_id, season_id
    FROM (
      SELECT DISTINCT atgs.team_id::text AS team_id, g.season_id
      FROM advanced_team_game_stats atgs
      JOIN games g ON g.game_id = atgs.game_id
    ) sub
    ORDER BY team_id, season_id
  `;

  console.log(`\n[3/4] Computing team rolling windows for ${teamPairs.length} team-season pair(s)...`);
  for (const { team_id, season_id } of teamPairs) {
    await computeTeamRollingWindows(team_id, season_id);
  }
  console.log(`  Done.`);

  // Step 4: Player rolling windows — distinct (player_id, team_id, season_id) triples
  const playerTriples = await sql<{ player_id: string; team_id: string; season_id: number }[]>`
    SELECT player_id, team_id, season_id
    FROM (
      SELECT DISTINCT apgs.player_id::text AS player_id, apgs.team_id::text AS team_id, g.season_id
      FROM advanced_player_game_stats apgs
      JOIN games g ON g.game_id = apgs.game_id
    ) sub
    ORDER BY player_id, season_id
  `;

  console.log(`\n[4/4] Computing player rolling windows for ${playerTriples.length} player-season pair(s)...`);
  for (const { player_id, team_id, season_id } of playerTriples) {
    await computePlayerRollingWindows(player_id, team_id, season_id);
  }
  console.log(`  Done.`);

  await printSummary();
  await sql.end();
}

main().catch(err => {
  console.error('compute-stats failed:', err);
  sql.end();
  process.exit(1);
});
