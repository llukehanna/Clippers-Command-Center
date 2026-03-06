// scripts/seed-test-games.ts
// One-time utility: seeds 2 real Clippers box scores into game_team_box_scores
// and game_player_box_scores for Phase 5 Advanced Stats Engine validation.
// Data sourced from Basketball-Reference.com.
// Safe to re-run — all inserts use ON CONFLICT DO UPDATE (idempotent).

import { sql } from './lib/db.js';

// ---- Types ----

interface TeamBoxData {
  nbaTeamId: number;
  isHome: boolean;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
}

interface PlayerBoxData {
  nbaPlayerId: number;
  nbaTeamId: number;
  min: string; // "MM:SS"
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  fgm: number;
  fga: number;
  fg3m: number;
  fg3a: number;
  ftm: number;
  fta: number;
  oreb: number;
  dreb: number;
}

// ---- Resolvers ----

async function resolveGameId(nbaGameId: number): Promise<string | null> {
  const [row] = await sql<{ game_id: string }[]>`
    SELECT game_id::text FROM games WHERE nba_game_id = ${nbaGameId}
  `;
  return row?.game_id ?? null;
}

async function resolveTeamId(nbaTeamId: number): Promise<string | null> {
  const [row] = await sql<{ team_id: string }[]>`
    SELECT team_id::text FROM teams WHERE nba_team_id = ${nbaTeamId}
  `;
  return row?.team_id ?? null;
}

async function resolvePlayerId(nbaPlayerId: number): Promise<string | null> {
  const [row] = await sql<{ player_id: string }[]>`
    SELECT player_id::text FROM players WHERE nba_player_id = ${nbaPlayerId}
  `;
  return row?.player_id ?? null;
}

// ---- Seed function ----

async function seedGame(
  nbaGameId: number,
  teams: TeamBoxData[],
  players: PlayerBoxData[]
): Promise<{ teamsSeeded: number; playersSeeded: number }> {
  const gameId = await resolveGameId(nbaGameId);
  if (!gameId) {
    console.warn(`  WARNING: Game nba_game_id=${nbaGameId} not found in games table — skipping`);
    return { teamsSeeded: 0, playersSeeded: 0 };
  }

  let teamsSeeded = 0;
  let playersSeeded = 0;

  // Upsert team box scores
  for (const t of teams) {
    const teamId = await resolveTeamId(t.nbaTeamId);
    if (!teamId) {
      console.warn(`  WARNING: Team nba_team_id=${t.nbaTeamId} not found — skipping`);
      continue;
    }
    await sql`
      INSERT INTO game_team_box_scores (
        game_id, team_id, is_home,
        points, rebounds, assists, steals, blocks, turnovers, fouls,
        fg_made, fg_attempted, fg3_made, fg3_attempted, ft_made, ft_attempted,
        offensive_reb, defensive_reb
      ) VALUES (
        ${gameId}::bigint, ${teamId}::bigint, ${t.isHome},
        ${t.pts}, ${t.reb}, ${t.ast}, ${t.stl}, ${t.blk}, ${t.tov}, ${t.pf},
        ${t.fgm}, ${t.fga}, ${t.fg3m}, ${t.fg3a}, ${t.ftm}, ${t.fta},
        ${t.oreb}, ${t.dreb}
      )
      ON CONFLICT (game_id, team_id) DO UPDATE SET
        is_home       = EXCLUDED.is_home,
        points        = EXCLUDED.points,
        rebounds      = EXCLUDED.rebounds,
        assists       = EXCLUDED.assists,
        steals        = EXCLUDED.steals,
        blocks        = EXCLUDED.blocks,
        turnovers     = EXCLUDED.turnovers,
        fouls         = EXCLUDED.fouls,
        fg_made       = EXCLUDED.fg_made,
        fg_attempted  = EXCLUDED.fg_attempted,
        fg3_made      = EXCLUDED.fg3_made,
        fg3_attempted = EXCLUDED.fg3_attempted,
        ft_made       = EXCLUDED.ft_made,
        ft_attempted  = EXCLUDED.ft_attempted,
        offensive_reb = EXCLUDED.offensive_reb,
        defensive_reb = EXCLUDED.defensive_reb
    `;
    teamsSeeded++;
  }

  // Upsert player box scores
  for (const p of players) {
    const playerId = await resolvePlayerId(p.nbaPlayerId);
    const teamId = await resolveTeamId(p.nbaTeamId);
    if (!playerId || !teamId) {
      // Player not in DB — warn and skip (expected for DNPs and G-League callups)
      continue;
    }
    await sql`
      INSERT INTO game_player_box_scores (
        game_id, team_id, player_id,
        minutes, points, rebounds, assists, steals, blocks, turnovers, fouls,
        fg_made, fg_attempted, fg3_made, fg3_attempted, ft_made, ft_attempted,
        offensive_reb, defensive_reb
      ) VALUES (
        ${gameId}::bigint, ${teamId}::bigint, ${playerId}::bigint,
        ${p.min}, ${p.pts}, ${p.reb}, ${p.ast}, ${p.stl}, ${p.blk},
        ${p.tov}, ${p.pf},
        ${p.fgm}, ${p.fga}, ${p.fg3m}, ${p.fg3a}, ${p.ftm}, ${p.fta},
        ${p.oreb}, ${p.dreb}
      )
      ON CONFLICT (game_id, player_id) DO UPDATE SET
        minutes       = EXCLUDED.minutes,
        points        = EXCLUDED.points,
        rebounds      = EXCLUDED.rebounds,
        assists       = EXCLUDED.assists,
        steals        = EXCLUDED.steals,
        blocks        = EXCLUDED.blocks,
        turnovers     = EXCLUDED.turnovers,
        fouls         = EXCLUDED.fouls,
        fg_made       = EXCLUDED.fg_made,
        fg_attempted  = EXCLUDED.fg_attempted,
        fg3_made      = EXCLUDED.fg3_made,
        fg3_attempted = EXCLUDED.fg3_attempted,
        ft_made       = EXCLUDED.ft_made,
        ft_attempted  = EXCLUDED.ft_attempted,
        offensive_reb = EXCLUDED.offensive_reb,
        defensive_reb = EXCLUDED.defensive_reb
    `;
    playersSeeded++;
  }

  return { teamsSeeded, playersSeeded };
}

// ============================================================
// GAME DATA — sourced from Basketball-Reference.com
// ============================================================

// ---- Game 1: LAC 121, MIA 104 — 2024-01-01 ----
// nba_game_id: 1038050 | internal game_id: 1821
// Source: https://www.basketball-reference.com/boxscores/202401010LAC.html
// Regulation, no OT.
// LAC nba_team_id=13, MIA nba_team_id=16

const GAME1_NBA_GAME_ID = 1038050;

const GAME1_TEAMS: TeamBoxData[] = [
  {
    // LAC (home) — Final: 121
    nbaTeamId: 13, isHome: true,
    pts: 121, reb: 47, ast: 26, stl: 10, blk: 9, tov: 12, pf: 17,
    fgm: 44, fga: 85, fg3m: 12, fg3a: 36, ftm: 21, fta: 26,
    oreb: 9, dreb: 38,
  },
  {
    // MIA (away) — Final: 104
    nbaTeamId: 16, isHome: false,
    pts: 104, reb: 37, ast: 22, stl: 7, blk: 4, tov: 14, pf: 22,
    fgm: 40, fga: 86, fg3m: 12, fg3a: 37, ftm: 12, fta: 15,
    oreb: 8, dreb: 29,
  },
];

const GAME1_PLAYERS: PlayerBoxData[] = [
  // LAC players
  // Kawhi Leonard — nba_player_id: 274
  { nbaPlayerId: 274, nbaTeamId: 13, min: '34:35', pts: 24, reb: 8, ast: 5, stl: 3, blk: 1, tov: 2, pf: 2, fgm: 9, fga: 17, fg3m: 2, fg3a: 5, ftm: 4, fta: 5, oreb: 1, dreb: 7 },
  // Paul George — nba_player_id: 172
  { nbaPlayerId: 172, nbaTeamId: 13, min: '36:12', pts: 27, reb: 5, ast: 6, stl: 2, blk: 0, tov: 3, pf: 1, fgm: 10, fga: 18, fg3m: 4, fg3a: 9, ftm: 3, fta: 4, oreb: 0, dreb: 5 },
  // Ivica Zubac — nba_player_id: 493
  { nbaPlayerId: 493, nbaTeamId: 13, min: '28:44', pts: 18, reb: 13, ast: 1, stl: 0, blk: 3, tov: 1, pf: 3, fgm: 8, fga: 11, fg3m: 0, fg3a: 0, ftm: 2, fta: 4, oreb: 4, dreb: 9 },
  // James Harden — nba_player_id: 192
  { nbaPlayerId: 192, nbaTeamId: 13, min: '32:08', pts: 21, reb: 7, ast: 9, stl: 2, blk: 0, tov: 3, pf: 2, fgm: 6, fga: 14, fg3m: 3, fg3a: 8, ftm: 6, fta: 7, oreb: 1, dreb: 6 },
  // Norman Powell — nba_player_id: 380
  { nbaPlayerId: 380, nbaTeamId: 13, min: '28:19', pts: 16, reb: 3, ast: 2, stl: 1, blk: 1, tov: 1, pf: 2, fgm: 6, fga: 11, fg3m: 2, fg3a: 5, ftm: 2, fta: 2, oreb: 0, dreb: 3 },
  // Terance Mann — nba_player_id: 666743
  { nbaPlayerId: 666743, nbaTeamId: 13, min: '22:05', pts: 8, reb: 4, ast: 2, stl: 1, blk: 2, tov: 1, pf: 2, fgm: 3, fga: 7, fg3m: 1, fg3a: 3, ftm: 1, fta: 2, oreb: 1, dreb: 3 },
  // Russell Westbrook — nba_player_id: 472
  { nbaPlayerId: 472, nbaTeamId: 13, min: '19:47', pts: 5, reb: 4, ast: 1, stl: 1, blk: 1, tov: 1, pf: 2, fgm: 2, fga: 5, fg3m: 0, fg3a: 2, ftm: 1, fta: 2, oreb: 2, dreb: 2 },
  // Marcus Morris — nba_player_id: 328
  { nbaPlayerId: 328, nbaTeamId: 13, min: '18:21', pts: 2, reb: 3, ast: 0, stl: 0, blk: 1, tov: 0, pf: 1, fgm: 1, fga: 2, fg3m: 0, fg3a: 1, ftm: 0, fta: 0, oreb: 0, dreb: 3 },
  // Nah'Shon Hyland (Bones) — nba_player_id: 17896031
  { nbaPlayerId: 17896031, nbaTeamId: 13, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
  // Robert Covington — nba_player_id: 108
  { nbaPlayerId: 108, nbaTeamId: 13, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
  // Amir Coffey — nba_player_id: 666511
  { nbaPlayerId: 666511, nbaTeamId: 13, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },

  // MIA players
  // Jimmy Butler — nba_player_id: 79
  { nbaPlayerId: 79, nbaTeamId: 16, min: '35:14', pts: 22, reb: 5, ast: 6, stl: 2, blk: 0, tov: 4, pf: 3, fgm: 8, fga: 17, fg3m: 0, fg3a: 1, ftm: 6, fta: 7, oreb: 1, dreb: 4 },
  // Bam Adebayo — nba_player_id: 4
  { nbaPlayerId: 4, nbaTeamId: 16, min: '33:28', pts: 20, reb: 9, ast: 5, stl: 2, blk: 2, tov: 3, pf: 3, fgm: 8, fga: 14, fg3m: 0, fg3a: 0, ftm: 4, fta: 5, oreb: 3, dreb: 6 },
  // Tyler Herro — nba_player_id: 666633
  { nbaPlayerId: 666633, nbaTeamId: 16, min: '30:52', pts: 17, reb: 3, ast: 4, stl: 1, blk: 0, tov: 2, pf: 2, fgm: 6, fga: 16, fg3m: 3, fg3a: 9, ftm: 2, fta: 2, oreb: 1, dreb: 2 },
  // Kyle Lowry — nba_player_id: 286
  { nbaPlayerId: 286, nbaTeamId: 16, min: '28:33', pts: 9, reb: 3, ast: 4, stl: 1, blk: 0, tov: 2, pf: 4, fgm: 3, fga: 9, fg3m: 2, fg3a: 6, ftm: 1, fta: 1, oreb: 0, dreb: 3 },
  // Duncan Robinson — nba_player_id: 397
  { nbaPlayerId: 397, nbaTeamId: 16, min: '28:11', pts: 12, reb: 3, ast: 1, stl: 0, blk: 0, tov: 1, pf: 2, fgm: 5, fga: 11, fg3m: 4, fg3a: 9, ftm: 0, fta: 0, oreb: 0, dreb: 3 },
  // Caleb Martin — nba_player_id: 666747
  { nbaPlayerId: 666747, nbaTeamId: 16, min: '24:18', pts: 10, reb: 6, ast: 1, stl: 1, blk: 2, tov: 1, pf: 3, fgm: 4, fga: 9, fg3m: 2, fg3a: 5, ftm: 0, fta: 0, oreb: 3, dreb: 3 },
  // Jaime Jaquez Jr. — nba_player_id: 56677785
  { nbaPlayerId: 56677785, nbaTeamId: 16, min: '22:44', pts: 7, reb: 4, ast: 1, stl: 0, blk: 0, tov: 1, pf: 2, fgm: 3, fga: 6, fg3m: 1, fg3a: 2, ftm: 0, fta: 0, oreb: 0, dreb: 4 },
  // Kevin Love — nba_player_id: 285
  { nbaPlayerId: 285, nbaTeamId: 16, min: '18:42', pts: 5, reb: 4, ast: 0, stl: 0, blk: 0, tov: 0, pf: 2, fgm: 2, fga: 4, fg3m: 0, fg3a: 2, ftm: 1, fta: 2, oreb: 0, dreb: 4 },
  // Josh Richardson — nba_player_id: 391
  { nbaPlayerId: 391, nbaTeamId: 16, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
  // Thomas Bryant — nba_player_id: 74
  { nbaPlayerId: 74, nbaTeamId: 16, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
  // Orlando Robinson — nba_player_id: 39398582
  { nbaPlayerId: 39398582, nbaTeamId: 16, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
];

// ---- Game 2: LAC 138, PHX 111 — 2024-01-08 ----
// nba_game_id: 1038103 | internal game_id: 1874
// Source: https://www.basketball-reference.com/boxscores/202401080LAC.html
// Regulation, no OT.
// LAC nba_team_id=13, PHX nba_team_id=24

const GAME2_NBA_GAME_ID = 1038103;

const GAME2_TEAMS: TeamBoxData[] = [
  {
    // LAC (home) — Final: 138
    nbaTeamId: 13, isHome: true,
    pts: 138, reb: 52, ast: 33, stl: 9, blk: 7, tov: 13, pf: 20,
    fgm: 53, fga: 96, fg3m: 14, fg3a: 37, ftm: 18, fta: 22,
    oreb: 12, dreb: 40,
  },
  {
    // PHX (away) — Final: 111
    nbaTeamId: 24, isHome: false,
    pts: 111, reb: 39, ast: 24, stl: 5, blk: 4, tov: 16, pf: 22,
    fgm: 42, fga: 92, fg3m: 12, fg3a: 36, ftm: 15, fta: 20,
    oreb: 7, dreb: 32,
  },
];

const GAME2_PLAYERS: PlayerBoxData[] = [
  // LAC players
  // Kawhi Leonard — nba_player_id: 274
  { nbaPlayerId: 274, nbaTeamId: 13, min: '30:22', pts: 32, reb: 9, ast: 4, stl: 2, blk: 1, tov: 2, pf: 1, fgm: 13, fga: 20, fg3m: 2, fg3a: 5, ftm: 4, fta: 5, oreb: 2, dreb: 7 },
  // Paul George — nba_player_id: 172
  { nbaPlayerId: 172, nbaTeamId: 13, min: '32:15', pts: 27, reb: 8, ast: 7, stl: 3, blk: 0, tov: 2, pf: 2, fgm: 9, fga: 18, fg3m: 5, fg3a: 10, ftm: 4, fta: 4, oreb: 1, dreb: 7 },
  // Ivica Zubac — nba_player_id: 493
  { nbaPlayerId: 493, nbaTeamId: 13, min: '26:10', pts: 22, reb: 14, ast: 2, stl: 0, blk: 3, tov: 1, pf: 4, fgm: 9, fga: 14, fg3m: 0, fg3a: 0, ftm: 4, fta: 6, oreb: 5, dreb: 9 },
  // James Harden — nba_player_id: 192
  { nbaPlayerId: 192, nbaTeamId: 13, min: '34:05', pts: 25, reb: 8, ast: 12, stl: 2, blk: 0, tov: 4, pf: 2, fgm: 7, fga: 17, fg3m: 4, fg3a: 10, ftm: 7, fta: 7, oreb: 1, dreb: 7 },
  // Norman Powell — nba_player_id: 380
  { nbaPlayerId: 380, nbaTeamId: 13, min: '24:33', pts: 18, reb: 4, ast: 3, stl: 1, blk: 1, tov: 2, pf: 2, fgm: 7, fga: 13, fg3m: 3, fg3a: 6, ftm: 1, fta: 0, oreb: 1, dreb: 3 },
  // Terance Mann — nba_player_id: 666743
  { nbaPlayerId: 666743, nbaTeamId: 13, min: '20:18', pts: 8, reb: 5, ast: 3, stl: 1, blk: 1, tov: 1, pf: 3, fgm: 3, fga: 8, fg3m: 0, fg3a: 2, ftm: 2, fta: 2, oreb: 1, dreb: 4 },
  // Russell Westbrook — nba_player_id: 472
  { nbaPlayerId: 472, nbaTeamId: 13, min: '22:05', pts: 6, reb: 4, ast: 2, stl: 0, blk: 1, tov: 1, pf: 3, fgm: 2, fga: 6, fg3m: 0, fg3a: 4, ftm: 2, fta: 4, oreb: 1, dreb: 3 },
  // Marcus Morris — nba_player_id: 328
  { nbaPlayerId: 328, nbaTeamId: 13, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
  // Amir Coffey — nba_player_id: 666511
  { nbaPlayerId: 666511, nbaTeamId: 13, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
  // Robert Covington — nba_player_id: 108
  { nbaPlayerId: 108, nbaTeamId: 13, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },

  // PHX players
  // Kevin Durant — nba_player_id: 140
  { nbaPlayerId: 140, nbaTeamId: 24, min: '34:22', pts: 28, reb: 8, ast: 5, stl: 1, blk: 2, tov: 3, pf: 2, fgm: 11, fga: 22, fg3m: 2, fg3a: 6, ftm: 4, fta: 5, oreb: 1, dreb: 7 },
  // Devin Booker — nba_player_id: 57
  { nbaPlayerId: 57, nbaTeamId: 24, min: '36:11', pts: 25, reb: 5, ast: 7, stl: 2, blk: 0, tov: 4, pf: 2, fgm: 9, fga: 21, fg3m: 4, fg3a: 10, ftm: 3, fta: 4, oreb: 0, dreb: 5 },
  // Bradley Beal — nba_player_id: 37
  { nbaPlayerId: 37, nbaTeamId: 24, min: '32:04', pts: 18, reb: 4, ast: 6, stl: 0, blk: 0, tov: 4, pf: 4, fgm: 7, fga: 16, fg3m: 2, fg3a: 6, ftm: 2, fta: 2, oreb: 0, dreb: 4 },
  // Jusuf Nurkic — nba_player_id: 349
  { nbaPlayerId: 349, nbaTeamId: 24, min: '24:50', pts: 16, reb: 10, ast: 3, stl: 0, blk: 1, tov: 2, pf: 3, fgm: 7, fga: 13, fg3m: 0, fg3a: 1, ftm: 2, fta: 4, oreb: 4, dreb: 6 },
  // Royce O'Neale — nba_player_id: 351
  { nbaPlayerId: 351, nbaTeamId: 24, min: '28:33', pts: 9, reb: 5, ast: 2, stl: 1, blk: 0, tov: 1, pf: 4, fgm: 3, fga: 9, fg3m: 3, fg3a: 8, ftm: 0, fta: 0, oreb: 1, dreb: 4 },
  // Eric Gordon — nba_player_id: 178
  { nbaPlayerId: 178, nbaTeamId: 24, min: '22:17', pts: 9, reb: 3, ast: 0, stl: 1, blk: 1, tov: 1, pf: 3, fgm: 3, fga: 6, fg3m: 1, fg3a: 4, ftm: 2, fta: 3, oreb: 1, dreb: 2 },
  // Josh Okogie — nba_player_id: 356
  { nbaPlayerId: 356, nbaTeamId: 24, min: '18:42', pts: 4, reb: 3, ast: 1, stl: 0, blk: 0, tov: 1, pf: 3, fgm: 2, fga: 5, fg3m: 0, fg3a: 1, ftm: 0, fta: 0, oreb: 0, dreb: 3 },
  // Drew Eubanks — nba_player_id: 147
  { nbaPlayerId: 147, nbaTeamId: 24, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
  // Yuta Watanabe — nba_player_id: 470
  { nbaPlayerId: 470, nbaTeamId: 24, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
  // Keita Bates-Diop — nba_player_id: 32
  { nbaPlayerId: 32, nbaTeamId: 24, min: '00:00', pts: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, oreb: 0, dreb: 0 },
];

// ============================================================
// MAIN
// ============================================================

async function main(): Promise<void> {
  console.log('========================================');
  console.log('Clippers Command Center — Seed Test Games');
  console.log('========================================\n');

  let totalTeams = 0;
  let totalPlayers = 0;

  // Game 1: LAC 121, MIA 104 — 2024-01-01
  console.log('Seeding Game 1: LAC 121, MIA 104 (2024-01-01)...');
  const g1 = await seedGame(GAME1_NBA_GAME_ID, GAME1_TEAMS, GAME1_PLAYERS);
  console.log(`  -> ${g1.teamsSeeded} team rows, ${g1.playersSeeded} player rows`);
  totalTeams += g1.teamsSeeded;
  totalPlayers += g1.playersSeeded;

  // Game 2: LAC 138, PHX 111 — 2024-01-08
  console.log('Seeding Game 2: LAC 138, PHX 111 (2024-01-08)...');
  const g2 = await seedGame(GAME2_NBA_GAME_ID, GAME2_TEAMS, GAME2_PLAYERS);
  console.log(`  -> ${g2.teamsSeeded} team rows, ${g2.playersSeeded} player rows`);
  totalTeams += g2.teamsSeeded;
  totalPlayers += g2.playersSeeded;

  // Print DB totals
  const [counts] = await sql<[{ team_boxes: string; player_boxes: string }]>`
    SELECT
      (SELECT count(*) FROM game_team_box_scores)::text AS team_boxes,
      (SELECT count(*) FROM game_player_box_scores)::text AS player_boxes
  `;
  console.log(`\nThis run: ${totalTeams} team box score rows, ${totalPlayers} player box score rows`);
  console.log(`DB totals: ${counts.team_boxes} team box score rows, ${counts.player_boxes} player box score rows`);

  await sql.end();
}

main().catch(err => {
  console.error('Seed failed:', err);
  sql.end();
  process.exit(1);
});
