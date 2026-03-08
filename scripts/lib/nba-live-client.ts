// scripts/lib/nba-live-client.ts
// NBA CDN live data HTTP client + clock parsing utilities.
// Fallback: stats.nba.com box score when CDN returns 403.

import type {
  NBAScoreboardResponse,
  NBABoxscoreResponse,
  NBAPlayByPlayResponse,
  BoxscoreGame,
  BoxscoreTeam,
  BoxscorePlayer,
  PlayerStatistics,
  TeamStatistics,
} from '../../src/lib/types/live.js';

const NBA_CDN = 'https://cdn.nba.com/static/json/liveData';
const NBA_STATS = 'https://stats.nba.com/stats';
const REQUEST_TIMEOUT_MS = 15_000;

/** Headers required to avoid 403 from NBA CDN (expects browser-like requests). */
const NBA_CDN_HEADERS: HeadersInit = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

/** Headers for stats.nba.com (fallback box score). */
const NBA_STATS_HEADERS: HeadersInit = {
  Accept: 'application/json',
  Referer: 'https://stats.nba.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

// ── Clock parsing utilities ───────────────────────────────────────────────────

/**
 * Converts NBA ISO 8601 gameClock ("PT04M32.00S") to display format "4:32".
 * Returns "0:00" for empty string (game not in progress) or invalid input.
 */
export function parseNBAClock(isoClock: string): string {
  const match = isoClock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return '0:00';
  const min = parseInt(match[1], 10);
  const sec = Math.floor(parseFloat(match[2]));
  return `${min}:${sec.toString().padStart(2, '0')}`;
}

/**
 * Converts NBA ISO 8601 gameClock to seconds remaining in the period.
 * Used to build ScoringEvent.event_time_seconds from play-by-play actions.
 * Returns 0 for empty string or invalid input.
 */
export function clockToSecondsRemaining(isoClock: string): number {
  const match = isoClock.match(/PT(\d+)M([\d.]+)S/);
  if (!match) return 0;
  return parseInt(match[1], 10) * 60 + Math.floor(parseFloat(match[2]));
}

// ── NBA CDN fetch ─────────────────────────────────────────────────────────────

/** Fetches today's scoreboard from NBA CDN. */
export async function fetchScoreboard(): Promise<NBAScoreboardResponse> {
  return nbaGet('/scoreboard/todaysScoreboard_00.json');
}

/**
 * Fetches full live boxscore for a specific game. Tries CDN first; on 403 uses stats.nba.com fallback.
 * @param gameId - ID used for CDN (may be BDL/internal id from games.nba_game_id).
 * @param statsNbaGameId - Official NBA GameID for stats.nba.com (e.g. from scoreboard game.gameId). Use this when gameId is BDL id so the fallback gets the correct 10-char NBA id.
 */
export async function fetchBoxscore(
  gameId: string,
  statsNbaGameId?: string
): Promise<NBABoxscoreResponse> {
  const path = `/boxscore/boxscore_${gameId}.json`;
  const url = `${NBA_CDN}${path}`;
  console.log(`[nba-live] Box score URL: ${url}`);
  try {
    const out = await nbaGet<NBABoxscoreResponse>(path);
    console.log('[nba-live] Box score source: cdn.nba.com');
    return out;
  } catch (err) {
    const msg = (err as Error).message ?? '';
    if (msg.includes('403') || msg.includes('CDN 403')) {
      const gid = statsNbaGameId ?? normalizeGameIdForStatsNba(gameId);
      console.log(
        `[nba-live] Box score source: stats.nba.com (fallback); source game id: ${gameId}, mapped stats.nba.com GameID: ${gid}`
      );
      return fetchBoxscoreStatsNba(gid);
    }
    throw err;
  }
}

// ── Stats.nba.com fallback (boxscore when CDN 403) ───────────────────────────

interface StatsNbaResultSet {
  name: string;
  headers: string[];
  rowSet: (string | number)[][];
}

function getResultSet(data: { resultSets?: StatsNbaResultSet[] }, name: string): StatsNbaResultSet | null {
  const set = data.resultSets?.find((s) => s.name === name) ?? null;
  return set ?? null;
}

function rowToMap(rs: StatsNbaResultSet, row: (string | number)[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  rs.headers.forEach((h, i) => {
    out[h] = row[i] as string | number;
  });
  return out;
}

/** "32:15" -> "PT32M15.00S" for API/DB compatibility. */
function minToIso(min: string | number): string {
  const s = String(min ?? '0:00').trim();
  if (!s || s === '0:00' || s === '0') return 'PT0M00.00S';
  const [m, sec] = s.split(':').map((x) => parseInt(x, 10) || 0);
  return `PT${m}M${String(sec).padStart(2, '0')}.00S`;
}

function normalizeGameIdForStatsNba(gameId: string): string {
  const id = String(gameId).replace(/\D/g, '');
  if (id.length >= 10) return id.slice(0, 10);
  return id.padStart(10, '0');
}

async function statsNbaGet<T>(path: string): Promise<T> {
  const url = `${NBA_STATS}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: NBA_STATS_HEADERS,
    });
    if (!res.ok) throw new Error(`stats.nba.com ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

/** Uses official NBA GameID (e.g. 0022400001) — do not pass BDL/internal id. */
async function fetchBoxscoreStatsNba(statsNbaGameId: string): Promise<NBABoxscoreResponse> {
  const gid = statsNbaGameId.length >= 10 ? statsNbaGameId.slice(0, 10) : statsNbaGameId.padStart(10, '0');
  const [summaryRaw, traditionalRaw] = await Promise.all([
    statsNbaGet<{ resultSets?: StatsNbaResultSet[] }>(
      `/boxscoresummaryv2?GameID=${gid}`
    ),
    statsNbaGet<{ resultSets?: StatsNbaResultSet[] }>(
      `/boxscoretraditionalv2?GameID=${gid}&StartPeriod=0&EndPeriod=14&StartRange=0&EndRange=2147483647&RangeType=0`
    ),
  ]);

  const gameSummary = getResultSet(summaryRaw, 'GameSummary');
  const lineScore = getResultSet(summaryRaw, 'LineScore');
  const playerStats = getResultSet(traditionalRaw, 'PlayerStats');
  const teamStats = getResultSet(traditionalRaw, 'TeamStats');

  if (!gameSummary?.rowSet?.length || !playerStats || !teamStats?.rowSet?.length) {
    throw new Error(`stats.nba.com fallback: missing resultSets for GameID=${gid}`);
  }
  const ps: StatsNbaResultSet = playerStats;

  const summaryRow = rowToMap(gameSummary, gameSummary.rowSet[0] as (string | number)[]);
  const homeTeamId = Number(summaryRow.HOME_TEAM_ID);
  const visitorTeamId = Number(summaryRow.VISITOR_TEAM_ID);

  // LineScore: one row per team; PTS_QTR1..4, PTS_OT1..10, PTS total
  const teamScoresByPeriod = new Map<
    number,
    { score: number; periods: Array<{ period: number; periodType: string; score: number }> }
  >();
  const lineScoreRows = (lineScore?.rowSet ?? []).map((r) =>
    rowToMap(lineScore!, r as (string | number)[])
  );
  const rowKeys = (r: Record<string, string | number>, k: string) => Number(r[k] ?? 0);
  for (const row of lineScoreRows) {
    const tid = Number(row.TEAM_ID);
    const periods: Array<{ period: number; periodType: string; score: number }> = [];
    for (let p = 1; p <= 4; p++) {
      periods.push({ period: p, periodType: 'REGULAR', score: rowKeys(row, `PTS_QTR${p}`) });
    }
    let periodNum = 5;
    for (let ot = 1; ot <= 10; ot++) {
      const pts = rowKeys(row, `PTS_OT${ot}`);
      if (pts === 0 && periodNum > 5) break;
      periods.push({ period: periodNum++, periodType: 'OVERTIME', score: pts });
    }
    teamScoresByPeriod.set(tid, { score: Number(row.PTS ?? 0), periods });
  }

  const teamStatsRows = teamStats.rowSet as (string | number[])[];
  const teamStatsByTeamId = new Map<number, Record<string, string | number>>();
  for (const row of teamStatsRows) {
    const rowMap = rowToMap(teamStats, row as (string | number)[]);
    const tid = Number(rowMap.TEAM_ID);
    teamStatsByTeamId.set(tid, rowMap);
  }

  function buildTeamStatistics(row: Record<string, string | number>): TeamStatistics {
    return {
      assists: Number(row.AST ?? 0),
      blocks: Number(row.BLK ?? 0),
      fieldGoalsAttempted: Number(row.FGA ?? 0),
      fieldGoalsMade: Number(row.FGM ?? 0),
      fieldGoalsPercentage: Number(row.FG_PCT ?? 0),
      foulsPersonal: Number(row.PF ?? 0),
      freeThrowsAttempted: Number(row.FTA ?? 0),
      freeThrowsMade: Number(row.FTM ?? 0),
      freeThrowsPercentage: Number(row.FT_PCT ?? 0),
      points: Number(row.PTS ?? 0),
      reboundsDefensive: Number(row.DREB ?? 0),
      reboundsOffensive: Number(row.OREB ?? 0),
      reboundsTotal: Number(row.REB ?? 0),
      steals: Number(row.STL ?? 0),
      threePointersAttempted: Number(row.FG3A ?? 0),
      threePointersMade: Number(row.FG3M ?? 0),
      threePointersPercentage: Number(row.FG3_PCT ?? 0),
      turnovers: Number(row.TO ?? 0),
    };
  }

  function buildBoxscoreTeam(
    teamId: number,
    teamName: string,
    teamTricode: string,
    isHome: boolean
  ): BoxscoreTeam {
    const tsRow = teamStatsByTeamId.get(teamId);
    const stats = tsRow ? buildTeamStatistics(tsRow) : emptyTeamStatistics();
    const scoreRec = teamScoresByPeriod.get(teamId);
    const score = scoreRec?.score ?? (tsRow ? Number(tsRow.PTS) : 0);
    const periods = scoreRec?.periods ?? [];
    const players: BoxscorePlayer[] = (ps.rowSet as (string | number)[][])
      .filter((row) => {
        const m = rowToMap(ps, row);
        return Number(m.TEAM_ID) === teamId;
      })
      .map((row, idx) => {
        const m = rowToMap(ps, row);
        const minStr = String(m.MIN ?? '0:00').trim();
        const played = minStr && minStr !== '0:00' && minStr !== '0' ? '1' : '0';
        const startPos = (m.START_POSITION as string) ?? '';
        return {
          status: 'ACTIVE',
          order: idx + 1,
          personId: Number(m.PLAYER_ID),
          jerseyNum: '',
          name: String(m.PLAYER_NAME ?? ''),
          nameI: String(m.PLAYER_NAME ?? ''),
          position: startPos,
          starter: startPos ? '1' : '0',
          oncourt: '0',
          played,
          statistics: {
            assists: Number(m.AST ?? 0),
            blocks: Number(m.BLK ?? 0),
            fieldGoalsAttempted: Number(m.FGA ?? 0),
            fieldGoalsMade: Number(m.FGM ?? 0),
            fieldGoalsPercentage: Number(m.FG_PCT ?? 0),
            foulsPersonal: Number(m.PF ?? 0),
            freeThrowsAttempted: Number(m.FTA ?? 0),
            freeThrowsMade: Number(m.FTM ?? 0),
            freeThrowsPercentage: Number(m.FT_PCT ?? 0),
            minutes: minToIso(minStr),
            minutesCalculated: minToIso(minStr),
            plus: 0,
            minus: 0,
            plusMinusPoints: Number(m.PLUS_MINUS ?? 0),
            points: Number(m.PTS ?? 0),
            reboundsDefensive: Number(m.DREB ?? 0),
            reboundsOffensive: Number(m.OREB ?? 0),
            reboundsTotal: Number(m.REB ?? 0),
            steals: Number(m.STL ?? 0),
            threePointersAttempted: Number(m.FG3A ?? 0),
            threePointersMade: Number(m.FG3M ?? 0),
            threePointersPercentage: Number(m.FG3_PCT ?? 0),
            turnovers: Number(m.TO ?? 0),
          },
        };
      });

    return {
      teamId,
      teamName,
      teamCity: '',
      teamTricode,
      score,
      periods,
      statistics: stats,
      players,
    };
  }

  function emptyTeamStatistics(): TeamStatistics {
    return {
      assists: 0,
      blocks: 0,
      fieldGoalsAttempted: 0,
      fieldGoalsMade: 0,
      fieldGoalsPercentage: 0,
      foulsPersonal: 0,
      freeThrowsAttempted: 0,
      freeThrowsMade: 0,
      freeThrowsPercentage: 0,
      points: 0,
      reboundsDefensive: 0,
      reboundsOffensive: 0,
      reboundsTotal: 0,
      steals: 0,
      threePointersAttempted: 0,
      threePointersMade: 0,
      threePointersPercentage: 0,
      turnovers: 0,
    };
  }

  const homeTsRow = teamStatsByTeamId.get(homeTeamId);
  const awayTsRow = teamStatsByTeamId.get(visitorTeamId);
  const homeName = homeTsRow ? String(homeTsRow.TEAM_NAME ?? '') : 'Home';
  const homeTricode = homeTsRow ? String(homeTsRow.TEAM_ABBREVIATION ?? '') : 'HOM';
  const awayName = awayTsRow ? String(awayTsRow.TEAM_NAME ?? '') : 'Away';
  const awayTricode = awayTsRow ? String(awayTsRow.TEAM_ABBREVIATION ?? '') : 'AWY';

  const homeTeam = buildBoxscoreTeam(homeTeamId, homeName, homeTricode, true);
  const awayTeam = buildBoxscoreTeam(visitorTeamId, awayName, awayTricode, false);

  const game: BoxscoreGame = {
    gameId: gid,
    gameStatus: 2,
    gameStatusText: 'In Progress',
    period: 1,
    gameClock: '',
    gameTimeUTC: '',
    regulationPeriods: 4,
    homeTeam,
    awayTeam,
  };

  return {
    meta: {
      version: 1,
      code: 200,
      request: `boxscore_${gid}`,
      time: new Date().toISOString(),
    },
    game,
  };
}

/** Fetches play-by-play actions for a specific game. Used by poll-live for recent_scoring. */
export async function fetchPlayByPlay(gameId: string): Promise<NBAPlayByPlayResponse> {
  return nbaGet(`/playbyplay/playbyplay_${gameId}.json`);
}

async function nbaGet<T>(path: string): Promise<T> {
  const url = `${NBA_CDN}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: NBA_CDN_HEADERS,
    });
    if (!res.ok) throw new Error(`NBA CDN ${res.status}: ${path}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`TIMEOUT after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}
