// scripts/lib/upserts.ts
import { sql } from './db.js';
import type { BDLTeam, BDLPlayer, BDLGame, BDLStat } from '../types/bdl.js';
import type { BoxscorePlayer, TeamStatistics } from '../../src/lib/types/live.js';

// --- Helpers ---

// Normalize external API values: undefined → null, everything else preserved.
// The postgres driver rejects undefined; external APIs often omit fields entirely
// rather than including them as null.
const nn = <T>(v: T | null | undefined): T | null => v ?? null;

function parseHeightIn(height: string | null | undefined): number | null {
  if (!height) return null;
  const [feet, inches] = height.split('-').map(Number);
  if (isNaN(feet) || isNaN(inches)) return null;
  return feet * 12 + inches;
}

// --- Seasons ---
export async function upsertSeasons(seasonIds: number[]): Promise<void> {
  for (const id of seasonIds) {
    const label = `${id}-${String(id + 1).slice(-2)}`;
    await sql`
      INSERT INTO seasons (season_id, label)
      VALUES (${id}, ${label})
      ON CONFLICT (season_id) DO UPDATE SET
        label = EXCLUDED.label
    `;
  }
}

// --- Teams ---
export async function upsertTeams(teams: BDLTeam[]): Promise<void> {
  for (const t of teams) {
    await sql`
      INSERT INTO teams (nba_team_id, abbreviation, name, city, conference, division)
      VALUES (${t.id}, ${nn(t.abbreviation)}, ${nn(t.name)}, ${nn(t.city)}, ${nn(t.conference)}, ${nn(t.division)})
      ON CONFLICT (nba_team_id) DO UPDATE SET
        abbreviation = EXCLUDED.abbreviation,
        name         = EXCLUDED.name,
        city         = EXCLUDED.city,
        conference   = EXCLUDED.conference,
        division     = EXCLUDED.division,
        updated_at   = now()
    `;
  }
}

// --- Players ---
export async function upsertPlayers(players: BDLPlayer[]): Promise<void> {
  for (const p of players) {
    const firstName = nn(p.first_name) ?? '';
    const lastName = nn(p.last_name) ?? '';
    const displayName = `${firstName} ${lastName}`.trim();
    await sql`
      INSERT INTO players (
        nba_player_id, first_name, last_name, display_name,
        position, height_in, weight_lb, birthdate, is_active
      )
      VALUES (
        ${p.id}, ${firstName}, ${lastName}, ${displayName},
        ${nn(p.position) || null}, ${parseHeightIn(p.height)},
        ${p.weight_pounds != null ? parseInt(p.weight_pounds) : null},
        ${p.birthdate != null ? new Date(p.birthdate) : null},
        ${nn(p.is_active) ?? false}
      )
      ON CONFLICT (nba_player_id) DO UPDATE SET
        first_name   = EXCLUDED.first_name,
        last_name    = EXCLUDED.last_name,
        display_name = EXCLUDED.display_name,
        position     = EXCLUDED.position,
        height_in    = EXCLUDED.height_in,
        weight_lb    = EXCLUDED.weight_lb,
        is_active    = EXCLUDED.is_active,
        updated_at   = now()
    `;
  }
}

// --- Player Team Stints ---
// No UNIQUE constraint — use INSERT WHERE NOT EXISTS pattern to avoid duplicates.
export async function upsertStints(
  nbaPlayerId: number,
  nbaTeamId: number,
  seasonId: number
): Promise<void> {
  // Get internal IDs
  const [player] = await sql<{ player_id: string }[]>`
    SELECT player_id::text FROM players WHERE nba_player_id = ${nbaPlayerId}
  `;
  const [team] = await sql<{ team_id: string }[]>`
    SELECT team_id::text FROM teams WHERE nba_team_id = ${nbaTeamId}
  `;
  if (!player || !team) return; // FK refs not present yet — skip

  await sql`
    INSERT INTO player_team_stints (player_id, team_id, season_id)
    SELECT ${player.player_id}::bigint, ${team.team_id}::bigint, ${seasonId}
    WHERE NOT EXISTS (
      SELECT 1 FROM player_team_stints
      WHERE player_id = ${player.player_id}::bigint
        AND team_id   = ${team.team_id}::bigint
        AND season_id = ${seasonId}
    )
  `;
}

// --- Games ---

/**
 * Normalize a raw BDL game status string into an internal status value.
 *
 * BDL sends three kinds of status values:
 *   - "Final"                        → finished game
 *   - ISO timestamp (scheduled game) → "2026-03-08T01:00:00Z"
 *   - Period/quarter strings          → "1st Qtr", "2nd Qtr", "Halftime", etc.
 *
 * Returns { status, startTimeUtc } where:
 *   status       = "Final" | "scheduled" | "in_progress"
 *   startTimeUtc = the ISO string when status was a timestamp, else null
 */
function normalizeBDLStatus(raw: string | null | undefined): {
  status: string;
  startTimeUtc: string | null;
} {
  if (!raw) return { status: 'scheduled', startTimeUtc: null };
  if (raw === 'Final') return { status: 'Final', startTimeUtc: null };
  // ISO timestamp = scheduled game; use it as start_time_utc
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(raw)) {
    return { status: 'scheduled', startTimeUtc: raw };
  }
  // Anything else ("1st Qtr", "2nd Qtr", "Halftime", "4th Qtr", etc.) = live
  return { status: 'in_progress', startTimeUtc: null };
}

export async function upsertGames(games: BDLGame[], seasonId: number): Promise<void> {
  for (const g of games) {
    // Resolve internal team IDs
    const [homeTeam] = await sql<{ team_id: string }[]>`
      SELECT team_id::text FROM teams WHERE nba_team_id = ${g.home_team.id}
    `;
    const [awayTeam] = await sql<{ team_id: string }[]>`
      SELECT team_id::text FROM teams WHERE nba_team_id = ${g.visitor_team.id}
    `;
    if (!homeTeam || !awayTeam) {
      console.warn(`  Skipping game ${g.id}: team IDs not found (home=${g.home_team.id}, away=${g.visitor_team.id})`);
      continue;
    }

    const { status, startTimeUtc } = normalizeBDLStatus(g.status);

    await sql`
      INSERT INTO games (
        nba_game_id, season_id, game_date, status, start_time_utc,
        home_team_id, away_team_id,
        home_score, away_score,
        period, clock, is_playoffs
      )
      VALUES (
        ${g.id}, ${seasonId}, ${nn(g.date)}, ${status}, ${startTimeUtc},
        ${homeTeam.team_id}::bigint, ${awayTeam.team_id}::bigint,
        ${nn(g.home_team_score)}, ${nn(g.visitor_team_score)},
        ${nn(g.period)}, ${nn(g.time)}, ${nn(g.postseason) ?? false}
      )
      ON CONFLICT (nba_game_id) DO UPDATE SET
        status         = EXCLUDED.status,
        start_time_utc = EXCLUDED.start_time_utc,
        home_score     = EXCLUDED.home_score,
        away_score     = EXCLUDED.away_score,
        period         = EXCLUDED.period,
        clock          = EXCLUDED.clock,
        updated_at     = now()
    `;
  }
}

// --- Box Scores (team + player, in transaction per game) ---
// Wraps both team and player box score inserts in a transaction.
// If player insert fails, team insert is rolled back — no partial writes.
export async function upsertBoxScoresForGame(
  gameId: string,
  teamBoxScores: Array<{ teamId: string; isHome: boolean; stat: BDLStat }>,
  playerStats: BDLStat[]
): Promise<void> {
  // Use sql directly with a transaction
  await sql.begin(async (tx) => {
    // txSql is cast via assignment to work around TypeScript Omit<> losing call signatures
    const txSql = tx as unknown as typeof sql;

    // Upsert team box scores (aggregate per team per game)
    // Note: BDL /stats gives player-level; team totals must be aggregated from players
    // We compute team totals here from player stats grouped by team
    const teamTotals = new Map<number, { bdlTeamId: number; stats: BDLStat[] }>();
    for (const stat of playerStats) {
      const tid = stat.team.id;
      if (!teamTotals.has(tid)) teamTotals.set(tid, { bdlTeamId: tid, stats: [] });
      teamTotals.get(tid)!.stats.push(stat);
    }

    for (const [, { bdlTeamId, stats }] of teamTotals) {
      const [teamRow] = await txSql<{ team_id: string }[]>`
        SELECT team_id::text FROM teams WHERE nba_team_id = ${bdlTeamId}
      `;
      if (!teamRow) continue;

      // Check which team is home from the game record
      const [gameRow] = await txSql<{ home_team_id: string }[]>`
        SELECT home_team_id::text FROM games WHERE game_id = ${gameId}::bigint
      `;
      const isHome = gameRow ? gameRow.home_team_id === teamRow.team_id : false;

      const sum = (fn: (s: BDLStat) => number | null) =>
        stats.reduce((acc, s) => acc + (fn(s) ?? 0), 0);

      await txSql`
        INSERT INTO game_team_box_scores (
          game_id, team_id, is_home,
          points, rebounds, assists, steals, blocks, turnovers, fouls,
          fg_made, fg_attempted, fg3_made, fg3_attempted, ft_made, ft_attempted,
          offensive_reb, defensive_reb
        ) VALUES (
          ${gameId}::bigint, ${teamRow.team_id}::bigint, ${isHome},
          ${sum(s => s.pts)}, ${sum(s => s.reb)}, ${sum(s => s.ast)},
          ${sum(s => s.stl)}, ${sum(s => s.blk)}, ${sum(s => s.turnover)}, ${sum(s => s.pf)},
          ${sum(s => s.fgm)}, ${sum(s => s.fga)}, ${sum(s => s.fg3m)}, ${sum(s => s.fg3a)},
          ${sum(s => s.ftm)}, ${sum(s => s.fta)},
          ${sum(s => s.oreb)}, ${sum(s => s.dreb)}
        )
        ON CONFLICT (game_id, team_id) DO UPDATE SET
          points       = EXCLUDED.points,
          rebounds     = EXCLUDED.rebounds,
          assists      = EXCLUDED.assists,
          steals       = EXCLUDED.steals,
          blocks       = EXCLUDED.blocks,
          turnovers    = EXCLUDED.turnovers,
          fouls        = EXCLUDED.fouls,
          fg_made      = EXCLUDED.fg_made,
          fg_attempted = EXCLUDED.fg_attempted,
          fg3_made     = EXCLUDED.fg3_made,
          fg3_attempted = EXCLUDED.fg3_attempted,
          ft_made      = EXCLUDED.ft_made,
          ft_attempted = EXCLUDED.ft_attempted,
          offensive_reb = EXCLUDED.offensive_reb,
          defensive_reb = EXCLUDED.defensive_reb
      `;
    }

    // Upsert player box scores
    for (const stat of playerStats) {
      const [playerRow] = await txSql<{ player_id: string }[]>`
        SELECT player_id::text FROM players WHERE nba_player_id = ${stat.player.id}
      `;
      const [teamRow] = await txSql<{ team_id: string }[]>`
        SELECT team_id::text FROM teams WHERE nba_team_id = ${stat.team.id}
      `;
      if (!playerRow || !teamRow) continue;

      // Serialize stat to JSON string for raw_payload storage
      const rawPayloadJson = JSON.stringify(stat);

      await txSql`
        INSERT INTO game_player_box_scores (
          game_id, team_id, player_id,
          minutes, points, rebounds, assists, steals, blocks, turnovers, fouls, plus_minus,
          fg_made, fg_attempted, fg3_made, fg3_attempted, ft_made, ft_attempted,
          offensive_reb, defensive_reb,
          raw_payload
        ) VALUES (
          ${gameId}::bigint, ${teamRow.team_id}::bigint, ${playerRow.player_id}::bigint,
          ${nn(stat.min)}, ${stat.pts ?? 0}, ${stat.reb ?? 0}, ${stat.ast ?? 0},
          ${stat.stl ?? 0}, ${stat.blk ?? 0}, ${stat.turnover ?? 0}, ${stat.pf ?? 0}, ${null},
          ${stat.fgm ?? 0}, ${stat.fga ?? 0}, ${stat.fg3m ?? 0}, ${stat.fg3a ?? 0},
          ${stat.ftm ?? 0}, ${stat.fta ?? 0},
          ${stat.oreb ?? 0}, ${stat.dreb ?? 0},
          ${rawPayloadJson}
        )
        ON CONFLICT (game_id, player_id) DO UPDATE SET
          minutes      = EXCLUDED.minutes,
          points       = EXCLUDED.points,
          rebounds     = EXCLUDED.rebounds,
          assists      = EXCLUDED.assists,
          steals       = EXCLUDED.steals,
          blocks       = EXCLUDED.blocks,
          turnovers    = EXCLUDED.turnovers,
          fouls        = EXCLUDED.fouls,
          fg_made      = EXCLUDED.fg_made,
          fg_attempted = EXCLUDED.fg_attempted,
          fg3_made     = EXCLUDED.fg3_made,
          fg3_attempted = EXCLUDED.fg3_attempted,
          ft_made      = EXCLUDED.ft_made,
          ft_attempted = EXCLUDED.ft_attempted,
          offensive_reb = EXCLUDED.offensive_reb,
          defensive_reb = EXCLUDED.defensive_reb,
          raw_payload  = EXCLUDED.raw_payload
      `;
    }
  });
}

// --- NBA Live Box Score Upserts ---

/**
 * Upsert team box score from NBA live boxscore JSON.
 * Uses NBA-provided team statistics directly (not aggregated from players).
 * ON CONFLICT (game_id, team_id) DO UPDATE — idempotent, safe to re-run.
 */
export async function upsertTeamBoxScore(
  gameId: string,      // internal bigint as string
  teamId: string,      // internal bigint as string
  isHome: boolean,
  stats: TeamStatistics,
  rawPayload: string
): Promise<void> {
  await sql`
    INSERT INTO game_team_box_scores (
      game_id, team_id, is_home,
      points, fg_made, fg_attempted, fg3_made, fg3_attempted,
      ft_made, ft_attempted, rebounds, offensive_reb, defensive_reb,
      assists, steals, blocks, turnovers, fouls, raw_payload
    ) VALUES (
      ${gameId}::bigint, ${teamId}::bigint, ${isHome},
      ${stats.points}, ${stats.fieldGoalsMade}, ${stats.fieldGoalsAttempted},
      ${stats.threePointersMade}, ${stats.threePointersAttempted},
      ${stats.freeThrowsMade}, ${stats.freeThrowsAttempted},
      ${stats.reboundsTotal}, ${stats.reboundsOffensive}, ${stats.reboundsDefensive},
      ${stats.assists}, ${stats.steals}, ${stats.blocks}, ${stats.turnovers},
      ${stats.foulsPersonal}, ${rawPayload}
    )
    ON CONFLICT (game_id, team_id) DO UPDATE SET
      points        = EXCLUDED.points,
      fg_made       = EXCLUDED.fg_made,
      fg_attempted  = EXCLUDED.fg_attempted,
      fg3_made      = EXCLUDED.fg3_made,
      fg3_attempted = EXCLUDED.fg3_attempted,
      ft_made       = EXCLUDED.ft_made,
      ft_attempted  = EXCLUDED.ft_attempted,
      rebounds      = EXCLUDED.rebounds,
      offensive_reb = EXCLUDED.offensive_reb,
      defensive_reb = EXCLUDED.defensive_reb,
      assists       = EXCLUDED.assists,
      steals        = EXCLUDED.steals,
      blocks        = EXCLUDED.blocks,
      turnovers     = EXCLUDED.turnovers,
      fouls         = EXCLUDED.fouls,
      raw_payload   = EXCLUDED.raw_payload
  `;
}

/**
 * Upsert a single player box score row from NBA live boxscore JSON.
 * Skips DNPs (played === '0') — callers must guard before calling.
 * ON CONFLICT (game_id, player_id) DO UPDATE — idempotent, safe to re-run.
 */
export async function upsertPlayerBoxScore(
  gameId: string,
  playerId: string,    // internal players.player_id as string
  teamId: string,
  starter: boolean,
  player: BoxscorePlayer
): Promise<void> {
  const s = player.statistics;
  await sql`
    INSERT INTO game_player_box_scores (
      game_id, player_id, team_id, starter, minutes,
      points, rebounds, offensive_reb, defensive_reb, assists,
      steals, blocks, turnovers, fouls, plus_minus,
      fg_made, fg_attempted, fg3_made, fg3_attempted,
      ft_made, ft_attempted, raw_payload
    ) VALUES (
      ${gameId}::bigint, ${playerId}::bigint, ${teamId}::bigint,
      ${starter}, ${s.minutes},
      ${s.points}, ${s.reboundsTotal}, ${s.reboundsOffensive}, ${s.reboundsDefensive},
      ${s.assists}, ${s.steals}, ${s.blocks}, ${s.turnovers}, ${s.foulsPersonal},
      ${s.plusMinusPoints},
      ${s.fieldGoalsMade}, ${s.fieldGoalsAttempted},
      ${s.threePointersMade}, ${s.threePointersAttempted},
      ${s.freeThrowsMade}, ${s.freeThrowsAttempted},
      ${JSON.stringify(player)}
    )
    ON CONFLICT (game_id, player_id) DO UPDATE SET
      starter       = EXCLUDED.starter,
      minutes       = EXCLUDED.minutes,
      points        = EXCLUDED.points,
      rebounds      = EXCLUDED.rebounds,
      offensive_reb = EXCLUDED.offensive_reb,
      defensive_reb = EXCLUDED.defensive_reb,
      assists       = EXCLUDED.assists,
      steals        = EXCLUDED.steals,
      blocks        = EXCLUDED.blocks,
      turnovers     = EXCLUDED.turnovers,
      fouls         = EXCLUDED.fouls,
      plus_minus    = EXCLUDED.plus_minus,
      fg_made       = EXCLUDED.fg_made,
      fg_attempted  = EXCLUDED.fg_attempted,
      fg3_made      = EXCLUDED.fg3_made,
      fg3_attempted = EXCLUDED.fg3_attempted,
      ft_made       = EXCLUDED.ft_made,
      ft_attempted  = EXCLUDED.ft_attempted,
      raw_payload   = EXCLUDED.raw_payload
  `;
}

// --- app_kv checkpoints ---
export async function getCheckpoint(key: string): Promise<number> {
  const [row] = await sql<{ value: number }[]>`
    SELECT value::int AS value FROM app_kv WHERE key = ${key}
  `;
  return row?.value ?? 0;
}

export async function setCheckpoint(key: string, value: number): Promise<void> {
  await sql`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES (${key}, ${sql.json(value)}, now())
    ON CONFLICT (key) DO UPDATE SET
      value      = EXCLUDED.value,
      updated_at = now()
  `;
}
