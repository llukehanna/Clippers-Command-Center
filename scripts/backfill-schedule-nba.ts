// scripts/backfill-schedule-nba.ts
// One-time backfill: seeds games table from NBA CDN schedule (no BDL required).
// Fetches the full 2025-26 league schedule and upserts all LAC regular season games.
//
// Run via: npx tsx scripts/backfill-schedule-nba.ts
//
// Safe to re-run — uses ON CONFLICT DO UPDATE.

import { sql } from './lib/db.js';

const LAC_NBA_TEAM_ID = 1610612746;
const SCHEDULE_URL = 'https://cdn.nba.com/static/json/staticData/scheduleLeagueV2_2.json';

interface NBATeamSchedule {
  teamId: number;
  teamCity: string;
  teamName: string;
  teamTricode: string;
  teamSlug: string;
  wins?: number;
  losses?: number;
  score?: number;
}

interface NBAScheduleGame {
  gameId: string;
  gameCode: string;
  gameStatus: number; // 1=scheduled, 2=in_progress, 3=final
  gameStatusText: string;
  gameLabel?: string;
  gameDateEst: string;
  gameDateTimeUTC: string;
  homeTeam: NBATeamSchedule;
  awayTeam: NBATeamSchedule;
}

interface NBAScheduleDay {
  gameDate: string;
  games: NBAScheduleGame[];
}

interface NBAScheduleResponse {
  leagueSchedule: {
    seasonYear: string;
    gameDates: NBAScheduleDay[];
  };
}

function gameStatusToInternal(status: number): string {
  if (status === 3) return 'final';
  if (status === 2) return 'in_progress';
  return 'scheduled';
}

async function main(): Promise<void> {
  console.log('[backfill-schedule-nba] Fetching NBA CDN schedule...');

  const res = await fetch(SCHEDULE_URL, {
    headers: {
      Accept: 'application/json',
      Referer: 'https://www.nba.com/',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
  });

  if (!res.ok) throw new Error(`NBA CDN ${res.status}`);
  const data = (await res.json()) as NBAScheduleResponse;

  // Collect all LAC regular season games (exclude preseason gameLabel)
  const lacGames: NBAScheduleGame[] = [];
  for (const day of data.leagueSchedule.gameDates) {
    for (const g of day.games) {
      const isLAC = g.homeTeam.teamId === LAC_NBA_TEAM_ID || g.awayTeam.teamId === LAC_NBA_TEAM_ID;
      const isPreseason = g.gameLabel?.toLowerCase().includes('preseason');
      if (isLAC && !isPreseason) {
        lacGames.push(g);
      }
    }
  }

  console.log(`[backfill-schedule-nba] Found ${lacGames.length} LAC regular season games`);

  // Determine season_id from the schedule (e.g., "2025-26" → 2025)
  const seasonYear = data.leagueSchedule.seasonYear; // e.g. "2025-26"
  const seasonId = parseInt(seasonYear.split('-')[0], 10);
  console.log(`[backfill-schedule-nba] Season ID: ${seasonId}`);

  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (const g of lacGames) {
    // Resolve internal team IDs by tricode (teams table uses BDL IDs, not official NBA IDs)
    const [homeTeamRow] = await sql<{ team_id: string }[]>`
      SELECT team_id::text FROM teams WHERE abbreviation = ${g.homeTeam.teamTricode}
    `;
    const [awayTeamRow] = await sql<{ team_id: string }[]>`
      SELECT team_id::text FROM teams WHERE abbreviation = ${g.awayTeam.teamTricode}
    `;

    if (!homeTeamRow || !awayTeamRow) {
      console.warn(`  Skipping ${g.gameId}: team not in DB (home=${g.homeTeam.teamTricode}, away=${g.awayTeam.teamTricode})`);
      skipped++;
      continue;
    }

    const status = gameStatusToInternal(g.gameStatus);
    const gameDate = g.gameDateEst.slice(0, 10); // "2025-10-22"
    const startTimeUtc = status === 'scheduled' ? g.gameDateTimeUTC : null;
    const homeScore = g.homeTeam.score ?? null;
    const awayScore = g.awayTeam.score ?? null;

    const result = await sql`
      INSERT INTO games (
        nba_game_id, season_id, game_date, status, start_time_utc,
        home_team_id, away_team_id,
        home_score, away_score,
        period, clock, is_playoffs
      )
      VALUES (
        ${g.gameId}, ${seasonId}, ${gameDate}::date, ${status}, ${startTimeUtc},
        ${homeTeamRow.team_id}::bigint, ${awayTeamRow.team_id}::bigint,
        ${homeScore}, ${awayScore},
        ${null}, ${null}, false
      )
      ON CONFLICT (nba_game_id) DO UPDATE SET
        game_date      = EXCLUDED.game_date,
        status         = EXCLUDED.status,
        start_time_utc = EXCLUDED.start_time_utc,
        home_score     = EXCLUDED.home_score,
        away_score     = EXCLUDED.away_score,
        updated_at     = now()
      RETURNING (xmax = 0) AS was_inserted
    `;

    if (result[0]?.was_inserted) {
      inserted++;
    } else {
      updated++;
    }
  }

  console.log(`[backfill-schedule-nba] Done: ${inserted} inserted, ${updated} updated, ${skipped} skipped`);

  await sql.end();
}

main().catch(err => {
  console.error('[backfill-schedule-nba] Failed:', err);
  process.exit(1);
});
