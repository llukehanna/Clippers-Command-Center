// scripts/lib/insights/engine/coverage.ts
// Is the league's box-score data complete enough for league-wide claims?
// Since 2026-10-27 cdn.nba.com refuses every non-nba.com client (deliberate;
// never bypass it): Clippers games keep arriving via ESPN while the rest of
// the league can stall. League ranks on a partial league would be false. Pure.
import { daysBetween } from './dates.js';
import type { LeagueCoverage } from './types.js';

export const MAX_GAMES_SPREAD = 5;
export const MAX_STALE_DAYS = 3;

export interface TeamGames { team_id: string; games: number; last_date: string }

export function assessLeagueCoverage(rows: TeamGames[], lacTeamId: string, expectedTeams = 30): LeagueCoverage {
  if (rows.length < expectedTeams) return { complete: false, reason: `${rows.length} of ${expectedTeams} teams have box scores` };
  const counts = rows.map((r) => r.games);
  const min = Math.min(...counts);
  const max = Math.max(...counts);
  if (max - min > MAX_GAMES_SPREAD) return { complete: false, reason: `games played range ${min}–${max}` };
  const lac = rows.find((r) => r.team_id === lacTeamId);
  const leagueLatest = rows.filter((r) => r.team_id !== lacTeamId).map((r) => r.last_date).sort().at(-1);
  if (lac && leagueLatest && daysBetween(leagueLatest, lac.last_date) > MAX_STALE_DAYS) {
    return { complete: false, reason: `league box scores end ${leagueLatest}, Clippers ${lac.last_date}` };
  }
  return { complete: true, reason: null };
}
