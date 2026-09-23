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
// Incremental by default: only games with team box scores but no advanced
// rows are computed (finalizeGame deletes a game's advanced rows whenever it
// rewrites the box score), and rolling windows are rebuilt only for the
// (team, season) / (player, season) pairs those games touch. --all recomputes
// everything.
//
// Run via: npm run compute-stats [-- --all]
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

  const advRows: Record<string, string | number | null>[] = [];
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

    advRows.push({
      game_id: gameId, player_id: p.player_id, team_id: p.team_id,
      usage_rate: usageRate, ts_pct: tsPct, efg_pct: efgPct,
      ast_rate: astRate, reb_rate: rebRate, tov_rate: tovRate,
    });
  }

  if (advRows.length > 0) {
    await sql`
      INSERT INTO advanced_player_game_stats ${sql(
        advRows,
        'game_id', 'player_id', 'team_id',
        'usage_rate', 'ts_pct', 'efg_pct', 'ast_rate', 'reb_rate', 'tov_rate'
      )}
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
  const all = process.argv.slice(2).includes('--all');
  console.log('========================================');
  console.log('Clippers Command Center — Advanced Stats Engine');
  console.log(`Compute: advanced team/player stats + rolling windows (${all ? 'all games' : 'incremental'})`);
  console.log('========================================\n');

  // Games to compute: every game with box scores (--all), or only those whose
  // advanced rows are missing. Ordered by date for readable progress.
  const games = await sql<{ game_id: string }[]>`
    SELECT g.game_id::text AS game_id
    FROM games g
    WHERE EXISTS (SELECT 1 FROM game_team_box_scores b WHERE b.game_id = g.game_id)
      ${all ? sql`` : sql`AND NOT EXISTS (SELECT 1 FROM advanced_team_game_stats a WHERE a.game_id = g.game_id)`}
    ORDER BY g.game_date, g.game_id
  `;
  const gameIds = games.map((g) => g.game_id);

  console.log(`[1/4] Computing team + player advanced stats for ${gameIds.length} game(s)...`);
  for (let i = 0; i < gameIds.length; i++) {
    await computeGameStats(gameIds[i]);
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${gameIds.length}`);
  }
  console.log(`  Done.`);

  if (gameIds.length === 0 && !all) {
    console.log('\nNothing new to compute.');
    await printSummary();
    await sql.end();
    return;
  }

  // Step 3: Team rolling windows — (team_id, season_id) pairs touched by these games
  const teamPairs = await sql<{ team_id: string; season_id: number }[]>`
    SELECT DISTINCT atgs.team_id::text AS team_id, g.season_id
    FROM advanced_team_game_stats atgs
    JOIN games g ON g.game_id = atgs.game_id
    WHERE g.season_id IS NOT NULL
      ${all ? sql`` : sql`AND g.game_id = ANY(${gameIds}::bigint[])`}
    ORDER BY 1, 2
  `;

  console.log(`\n[3/4] Computing team rolling windows for ${teamPairs.length} team-season pair(s)...`);
  for (const { team_id, season_id } of teamPairs) {
    await computeTeamRollingWindows(team_id, season_id);
  }
  console.log(`  Done.`);

  // Step 4: Player rolling windows — (player_id, season_id) pairs touched by these games
  const playerPairs = await sql<{ player_id: string; team_id: string; season_id: number }[]>`
    SELECT DISTINCT ON (apgs.player_id, g.season_id)
           apgs.player_id::text AS player_id, apgs.team_id::text AS team_id, g.season_id
    FROM advanced_player_game_stats apgs
    JOIN games g ON g.game_id = apgs.game_id
    WHERE g.season_id IS NOT NULL
      ${all ? sql`` : sql`AND g.game_id = ANY(${gameIds}::bigint[])`}
    ORDER BY apgs.player_id, g.season_id
  `;

  console.log(`\n[4/4] Computing player rolling windows for ${playerPairs.length} player-season pair(s)...`);
  for (let i = 0; i < playerPairs.length; i++) {
    const { player_id, team_id, season_id } = playerPairs[i];
    await computePlayerRollingWindows(player_id, team_id, season_id);
    if ((i + 1) % 200 === 0) console.log(`  ${i + 1}/${playerPairs.length}`);
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
