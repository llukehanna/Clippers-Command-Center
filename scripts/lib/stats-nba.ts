// scripts/lib/stats-nba.ts
// Past-season box scores from stats.nba.com, for seasons older than the
// cdn.nba.com box score archive (which starts with 2019-20).
//
// Two sources, both converted to the CDN NBABoxscoreResponse shape so
// ingestBoxscore/finalizeGame write them like any other game:
//   - Season game logs (leaguegamelog, one request per season type and
//     player/team) → every game of a season in a handful of requests. They
//     carry no starters, line score or tip time.
//   - Per-game boxscoresummaryv3 + boxscoretraditionalv3 → full fidelity
//     (starters, per-period line score, tip time, inactives). Used for
//     Clippers games, which the app displays in detail.
//
// stats.nba.com throttles aggressively (a burst of ~50 quick requests gets the
// IP tarpitted for a while) and blocks most cloud IPs, so requests are
// sequential, paced, and retried with long backoff. Run from a home network.

import type {
  BoxscorePlayer,
  BoxscoreTeam,
  NBABoxscoreResponse,
  PlayerStatistics,
  TeamStatistics,
} from '../../src/lib/types/live.js';
import { easternDateOf, seasonLabel } from './schedule-utils.js';
import type { CdnBoxscoreResult } from './nba-season.js';

const STATS_BASE = 'https://stats.nba.com/stats';
const STATS_HEADERS = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  Origin: 'https://www.nba.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'x-nba-stats-origin': 'stats',
  'x-nba-stats-token': 'true',
};

/** Minimum gap between request starts. Override with STATS_NBA_GAP_MS. */
const MIN_GAP_MS = Number(process.env.STATS_NBA_GAP_MS ?? 3_000);
const TIMEOUT_MS = 60_000;
const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

/** Tricodes stats.nba.com reports for relocated/renamed franchises → teams.abbreviation. */
const TRICODE_ALIASES: Record<string, string> = {
  NJN: 'BKN', // New Jersey Nets (through 2011-12)
  NOH: 'NOP', // New Orleans Hornets (through 2012-13)
  NOK: 'NOP', // New Orleans/Oklahoma City Hornets (2005-07)
};

export function normalizeTricode(tricode: string): string {
  return TRICODE_ALIASES[tricode] ?? tricode;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────

let lastRequestAt = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** GET a stats.nba.com endpoint: paced, retried on timeouts, 429 and 5xx. */
async function statsGet<T>(path: string, log: (msg: string) => void): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const wait = lastRequestAt + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    let reason: string;
    try {
      const res = await fetch(`${STATS_BASE}${path}`, {
        headers: STATS_HEADERS,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (res.ok) return (await res.json()) as T;
      if (res.status !== 429 && res.status < 500) throw new Error(`stats.nba.com HTTP ${res.status}: ${path}`);
      reason = `HTTP ${res.status}`;
    } catch (err) {
      const e = err as Error;
      if (e.message.startsWith('stats.nba.com HTTP')) throw e;
      reason = e.name === 'TimeoutError' ? 'timeout (likely throttled)' : e.message;
    }
    if (attempt >= BACKOFF_MS.length) throw new Error(`stats.nba.com gave up after ${attempt + 1} attempts (${reason}): ${path}`);
    log(`stats.nba.com ${reason} — retrying in ${BACKOFF_MS[attempt] / 1000}s (${path.split('?')[0]})`);
    await sleep(BACKOFF_MS[attempt]);
  }
}

// ── Shared conversions ───────────────────────────────────────────────────────

/** "38:27" / 38.45 (decimal minutes) → CDN ISO duration "PT38M27.00S". */
export function toIsoMinutes(min: string | number | null | undefined): string {
  let seconds: number;
  if (typeof min === 'number') seconds = Math.round(min * 60);
  else {
    const s = String(min ?? '').trim();
    if (!s) return 'PT00M00.00S';
    const [m, sec] = s.split(':');
    seconds = (parseInt(m, 10) || 0) * 60 + (parseInt(sec ?? '0', 10) || 0);
  }
  const m = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return `PT${String(m).padStart(2, '0')}M${String(sec).padStart(2, '0')}.00S`;
}

function isoSeconds(iso: string): number {
  const m = /PT(\d+)M(\d+)/.exec(iso);
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
}

const pct = (made: number, att: number) => (att > 0 ? Math.round((made / att) * 1000) / 1000 : 0);

type Row = Record<string, string | number | null>;

function rowsOf(rs: { headers: string[]; rowSet: unknown[][] }): Row[] {
  return rs.rowSet.map((r) => Object.fromEntries(rs.headers.map((h, i) => [h, r[i] as string | number | null])));
}

const num = (v: unknown) => Number(v ?? 0) || 0;

function teamStatsFromRow(r: Row): TeamStatistics {
  const fgm = num(r.FGM), fga = num(r.FGA), fg3m = num(r.FG3M), fg3a = num(r.FG3A), ftm = num(r.FTM), fta = num(r.FTA);
  return {
    assists: num(r.AST),
    blocks: num(r.BLK),
    fieldGoalsAttempted: fga,
    fieldGoalsMade: fgm,
    fieldGoalsPercentage: pct(fgm, fga),
    foulsPersonal: num(r.PF),
    freeThrowsAttempted: fta,
    freeThrowsMade: ftm,
    freeThrowsPercentage: pct(ftm, fta),
    points: num(r.PTS),
    reboundsDefensive: num(r.DREB),
    reboundsOffensive: num(r.OREB),
    reboundsTotal: num(r.REB),
    steals: num(r.STL),
    threePointersAttempted: fg3a,
    threePointersMade: fg3m,
    threePointersPercentage: pct(fg3m, fg3a),
    turnovers: num(r.TOV ?? r.TO),
  };
}

function wrap(game: NBABoxscoreResponse['game']): NBABoxscoreResponse {
  return { meta: { version: 1, code: 200, request: `stats.nba.com ${game.gameId}`, time: new Date().toISOString() }, game };
}

// ── Season game logs (every game, reduced fidelity) ──────────────────────────

export interface SeasonLogGame {
  gameId: string;
  gameDate: string; // YYYY-MM-DD (Eastern)
  homeTricode: string;
  awayTricode: string;
  box: NBABoxscoreResponse;
}

interface ResultSetsResponse {
  resultSets: { name: string; headers: string[]; rowSet: unknown[][] }[];
}

const SEASON_TYPES = ['Regular Season', 'Playoffs'] as const;

/** Team and player leaguegamelog rows of a season (regular season + playoffs). */
export async function fetchSeasonLogs(
  seasonId: number,
  log: (msg: string) => void
): Promise<{ teamRows: Row[]; playerRows: Row[] }> {
  const teamRows: Row[] = [];
  const playerRows: Row[] = [];
  for (const type of SEASON_TYPES) {
    for (const who of ['T', 'P'] as const) {
      const q = new URLSearchParams({
        LeagueID: '00',
        Season: seasonLabel(seasonId),
        SeasonType: type,
        PlayerOrTeam: who,
        Direction: 'ASC',
        Sorter: 'DATE',
        Counter: '0',
      });
      const data = await statsGet<ResultSetsResponse>(`/leaguegamelog?${q}`, log);
      const rows = rowsOf(data.resultSets[0]);
      (who === 'T' ? teamRows : playerRows).push(...rows);
      log(`leaguegamelog ${seasonLabel(seasonId)} ${type} ${who === 'T' ? 'team' : 'player'}: ${rows.length} rows`);
    }
  }
  return { teamRows, playerRows };
}

/**
 * One final box score per game from season log rows. The home team is the row
 * whose MATCHUP reads "AAA vs. BBB" (away rows read "AAA @ BBB"). Players get
 * no starter flag or jersey, and the line score / tip time are left empty.
 */
export function boxscoresFromSeasonLogs(teamRows: Row[], playerRows: Row[]): SeasonLogGame[] {
  const playersByGameTeam = new Map<string, Row[]>();
  for (const p of playerRows) {
    const key = `${p.GAME_ID}:${p.TEAM_ID}`;
    const list = playersByGameTeam.get(key) ?? [];
    list.push(p);
    playersByGameTeam.set(key, list);
  }

  const teamsByGame = new Map<string, Row[]>();
  for (const t of teamRows) {
    const list = teamsByGame.get(String(t.GAME_ID)) ?? [];
    list.push(t);
    teamsByGame.set(String(t.GAME_ID), list);
  }

  const games: SeasonLogGame[] = [];
  for (const [gameId, rows] of teamsByGame) {
    const home = rows.find((r) => String(r.MATCHUP).includes(' vs. '));
    const away = rows.find((r) => String(r.MATCHUP).includes(' @ '));
    if (rows.length !== 2 || !home || !away) {
      throw new Error(`leaguegamelog: game ${gameId} has unexpected team rows: ${rows.map((r) => r.MATCHUP).join(' | ')}`);
    }
    const team = (r: Row): BoxscoreTeam => ({
      teamId: num(r.TEAM_ID),
      teamName: String(r.TEAM_NAME ?? ''),
      teamCity: '',
      teamTricode: normalizeTricode(String(r.TEAM_ABBREVIATION)),
      score: num(r.PTS),
      periods: [],
      statistics: teamStatsFromRow(r),
      players: (playersByGameTeam.get(`${gameId}:${r.TEAM_ID}`) ?? []).map((p, i) => playerFromLogRow(p, i)),
    });
    const homeTeam = team(home);
    const awayTeam = team(away);
    games.push({
      gameId,
      gameDate: String(home.GAME_DATE).slice(0, 10),
      homeTricode: homeTeam.teamTricode,
      awayTricode: awayTeam.teamTricode,
      box: wrap({
        gameId,
        gameStatus: 3,
        gameStatusText: 'Final',
        period: 4,
        gameClock: '',
        gameTimeUTC: '',
        regulationPeriods: 4,
        homeTeam,
        awayTeam,
      }),
    });
  }
  return games.sort((a, b) => a.gameId.localeCompare(b.gameId));
}

function playerFromLogRow(p: Row, index: number): BoxscorePlayer {
  const minutes = toIsoMinutes(p.MIN as number | string);
  const s = teamStatsFromRow(p);
  const statistics: PlayerStatistics = {
    ...s,
    minutes,
    minutesCalculated: minutes,
    plus: 0,
    minus: 0,
    plusMinusPoints: num(p.PLUS_MINUS),
  };
  const name = String(p.PLAYER_NAME ?? '').trim();
  return {
    status: 'ACTIVE',
    order: index + 1,
    personId: num(p.PLAYER_ID),
    jerseyNum: '',
    name,
    nameI: name,
    position: '',
    starter: '0',
    oncourt: '0',
    played: '1', // game logs only list players who appeared
    statistics,
  };
}

// ── Per-game v3 box score (full fidelity) ────────────────────────────────────

interface V3Player {
  personId: number;
  firstName: string;
  familyName: string;
  nameI: string;
  position: string;
  comment: string;
  jerseyNum: string;
  statistics: Omit<PlayerStatistics, 'minutes' | 'minutesCalculated' | 'plus' | 'minus'> & { minutes: string };
}

interface V3TraditionalTeam {
  teamId: number;
  teamCity: string;
  teamName: string;
  teamTricode: string;
  players: V3Player[];
  statistics: TeamStatistics & { minutes: string };
}

interface V3SummaryTeam {
  teamId: number;
  teamCity: string;
  teamName: string;
  teamTricode: string;
  score: number;
  periods: Array<{ period: number; periodType: string; score: number }>;
  inactives?: Array<{ personId: number; firstName: string; familyName: string; jerseyNum: string }>;
}

export interface V3Summary {
  boxScoreSummary: {
    gameId: string | null;
    gameStatus: number;
    gameStatusText: string;
    period: number;
    gameTimeUTC: string;
    homeTeam: V3SummaryTeam;
    awayTeam: V3SummaryTeam;
  };
}

export interface V3Traditional {
  boxScoreTraditional: { gameId: string; homeTeam: V3TraditionalTeam; awayTeam: V3TraditionalTeam };
}

/** Converts boxscoresummaryv3 + boxscoretraditionalv3 into the CDN box score shape. */
export function boxscoreFromV3(summary: V3Summary, traditional: V3Traditional): NBABoxscoreResponse {
  const s = summary.boxScoreSummary;
  const t = traditional.boxScoreTraditional;

  const team = (st: V3SummaryTeam, tt: V3TraditionalTeam): BoxscoreTeam => {
    const players: BoxscorePlayer[] = tt.players.map((p, i) => {
      const minutes = toIsoMinutes(p.statistics.minutes);
      return {
        status: 'ACTIVE',
        order: i + 1,
        personId: p.personId,
        jerseyNum: p.jerseyNum ?? '',
        name: `${p.firstName} ${p.familyName}`.trim(),
        nameI: p.nameI,
        firstName: p.firstName,
        familyName: p.familyName,
        position: p.position ?? '',
        starter: p.position ? '1' : '0', // v3 lists a position for starters only
        oncourt: '0',
        played: isoSeconds(minutes) > 0 ? '1' : '0',
        statistics: { ...p.statistics, minutes, minutesCalculated: minutes, plus: 0, minus: 0 },
      } as BoxscorePlayer;
    });
    // Inactive players are listed too (played '0'), as on the CDN, so rosters
    // include them — see finalizeGame's stints.
    for (const p of st.inactives ?? []) {
      if (players.some((x) => x.personId === p.personId)) continue;
      players.push({
        status: 'INACTIVE',
        order: players.length + 1,
        personId: p.personId,
        jerseyNum: p.jerseyNum ?? '',
        name: `${p.firstName} ${p.familyName}`.trim(),
        nameI: '',
        firstName: p.firstName,
        familyName: p.familyName,
        position: '',
        starter: '0',
        oncourt: '0',
        played: '0',
        statistics: emptyPlayerStatistics(),
      } as BoxscorePlayer);
    }
    const { minutes: _teamMinutes, ...teamStats } = tt.statistics;
    void _teamMinutes;
    return {
      teamId: st.teamId,
      teamName: st.teamName,
      teamCity: st.teamCity,
      teamTricode: normalizeTricode(st.teamTricode),
      score: st.score,
      periods: st.periods ?? [],
      statistics: teamStats,
      players,
    };
  };

  return wrap({
    gameId: String(s.gameId),
    gameStatus: s.gameStatus,
    gameStatusText: s.gameStatusText,
    period: s.period,
    gameClock: '',
    gameTimeUTC: s.gameTimeUTC,
    regulationPeriods: 4,
    homeTeam: team(s.homeTeam, t.homeTeam),
    awayTeam: team(s.awayTeam, t.awayTeam),
  });
}

function emptyPlayerStatistics(): PlayerStatistics {
  return {
    assists: 0, blocks: 0, fieldGoalsAttempted: 0, fieldGoalsMade: 0, fieldGoalsPercentage: 0,
    foulsPersonal: 0, freeThrowsAttempted: 0, freeThrowsMade: 0, freeThrowsPercentage: 0,
    minutes: 'PT00M00.00S', minutesCalculated: 'PT00M00.00S', plus: 0, minus: 0, plusMinusPoints: 0,
    points: 0, reboundsDefensive: 0, reboundsOffensive: 0, reboundsTotal: 0, steals: 0,
    threePointersAttempted: 0, threePointersMade: 0, threePointersPercentage: 0, turnovers: 0,
  };
}

/** One game's full box score from stats.nba.com v3 endpoints. Never throws. */
export async function fetchStatsBoxscore(gameId10: string, log: (msg: string) => void): Promise<CdnBoxscoreResult> {
  try {
    const summary = await statsGet<V3Summary>(`/boxscoresummaryv3?GameID=${gameId10}`, log);
    // Unknown ids come back 200 with a null gameId.
    if (!summary.boxScoreSummary?.gameId) return { status: 'missing', http: 200 };
    const traditional = await statsGet<V3Traditional>(`/boxscoretraditionalv3?GameID=${gameId10}`, log);
    const box = boxscoreFromV3(summary, traditional);
    if (!easternDateOf(box.game.gameTimeUTC)) return { status: 'error', message: `bad gameTimeUTC ${box.game.gameTimeUTC}` };
    return { status: 'ok', boxscore: box };
  } catch (err) {
    return { status: 'error', message: (err as Error).message };
  }
}
