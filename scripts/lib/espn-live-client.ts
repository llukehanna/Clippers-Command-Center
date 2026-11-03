// scripts/lib/espn-live-client.ts
// ESPN's public scoreboard + game summary, translated into the NBA CDN shapes
// the live poller consumes (NBAScoreboardResponse, NBABoxscoreResponse,
// NBAPlayByPlayResponse). The runner falls back to this when cdn.nba.com
// liveData refuses it (403 for every client since late October 2026); see
// scripts/lib/live-deps.ts. Converters are pure; the fetchers are thin.
//
// What ESPN can't give us exactly:
//   - player ids: ESPN athlete ids are mapped to NBA personIds by name
//     (PersonIdResolver); an unmatched player gets the negated ESPN id, so it
//     never collides with a real NBA id (no headshot, usual minutes unknown).
//   - on-court flags: derived from starters + substitutions in play-by-play.
//   - timeouts remaining / bonus: not in the feed (left unknown).

import type {
  BoxscoreGame,
  BoxscorePlayer,
  BoxscoreTeam,
  NBABoxscoreResponse,
  NBAPlayByPlayResponse,
  NBAScoreboardResponse,
  PlayByPlayAction,
  PlayerStatistics,
  ScoreboardGame,
  ScoreboardTeam,
  TeamStatistics,
} from '../../src/lib/types/live';

const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const REQUEST_TIMEOUT_MS = 15_000;

// ESPN abbreviation → NBA tricode, where they differ.
const ESPN_TO_NBA: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS' };

/** NBA team ids (stats.nba.com / cdn.nba.com) by tricode. */
export const NBA_TEAM_IDS: Record<string, number> = {
  ATL: 1610612737, BOS: 1610612738, CLE: 1610612739, NOP: 1610612740, CHI: 1610612741,
  DAL: 1610612742, DEN: 1610612743, GSW: 1610612744, HOU: 1610612745, LAC: 1610612746,
  LAL: 1610612747, MIA: 1610612748, MIL: 1610612749, MIN: 1610612750, BKN: 1610612751,
  NYK: 1610612752, ORL: 1610612753, IND: 1610612754, PHI: 1610612755, PHX: 1610612756,
  POR: 1610612757, SAC: 1610612758, SAS: 1610612759, OKC: 1610612760, TOR: 1610612761,
  UTA: 1610612762, MEM: 1610612763, WAS: 1610612764, DET: 1610612765, CHA: 1610612766,
};

export const tricodeOf = (abbr: string | undefined): string => (abbr ? ESPN_TO_NBA[abbr] ?? abbr : '');
const teamIdOf = (abbr: string | undefined): number => NBA_TEAM_IDS[tricodeOf(abbr)] ?? 0;

// ── ESPN payload shapes (only what we read) ──────────────────────────────────

interface EspnTeamRef { id?: string; abbreviation?: string; displayName?: string; name?: string; location?: string }
interface EspnStatus {
  clock?: number;
  displayClock?: string;
  period?: number;
  type?: { state?: string; completed?: boolean; shortDetail?: string; detail?: string };
}
interface EspnCompetitor {
  homeAway?: string;
  score?: string;
  team?: EspnTeamRef;
  linescores?: Array<{ value?: number; displayValue?: string }>;
  records?: Array<{ summary?: string; type?: string }>;
}
interface EspnCompetition { date?: string; status?: EspnStatus; competitors?: EspnCompetitor[] }
interface EspnEvent { id?: string; date?: string; status?: EspnStatus; competitions?: EspnCompetition[] }
export interface EspnScoreboardJson { events?: EspnEvent[] }

interface EspnAthleteLine {
  athlete?: { id?: string; displayName?: string; shortName?: string; jersey?: string; position?: { abbreviation?: string } };
  starter?: boolean;
  didNotPlay?: boolean;
  active?: boolean;
  stats?: string[];
}
interface EspnPlay {
  id?: string;
  sequenceNumber?: string;
  type?: { id?: string; text?: string };
  text?: string;
  awayScore?: number;
  homeScore?: number;
  period?: { number?: number };
  clock?: { displayValue?: string };
  scoringPlay?: boolean;
  scoreValue?: number;
  shootingPlay?: boolean;
  team?: { id?: string };
  participants?: Array<{ athlete?: { id?: string } }>;
  wallclock?: string;
}
export interface EspnSummaryJson {
  header?: { id?: string; competitions?: EspnCompetition[] };
  boxscore?: {
    teams?: Array<{ team?: EspnTeamRef; statistics?: Array<{ name?: string; displayValue?: string }> }>;
    players?: Array<{ team?: EspnTeamRef; statistics?: Array<{ labels?: string[]; athletes?: EspnAthleteLine[] }> }>;
  };
  plays?: EspnPlay[];
}

// ── Small parsers ────────────────────────────────────────────────────────────

/** "4:32" | "45.2" | "0.0" → "PT04M32.00S" (the CDN's clock format). */
export function isoClock(display: string | undefined): string {
  const m = /^\s*(?:(\d+):)?(\d+(?:\.\d+)?)\s*$/.exec(display ?? '');
  if (!m) return '';
  const total = (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
  const min = Math.floor(total / 60);
  const sec = total - min * 60;
  return `PT${String(min).padStart(2, '0')}M${sec.toFixed(2).padStart(5, '0')}S`;
}

function gameStatusOf(st: EspnStatus | undefined): number {
  const state = st?.type?.state;
  return state === 'post' ? 3 : state === 'in' ? 2 : 1;
}

/** "10-19" → [10, 19]. */
function madeAttempted(v: string | undefined): [number, number] {
  const m = /^(\d+)-(\d+)$/.exec(v ?? '');
  return m ? [Number(m[1]), Number(m[2])] : [0, 0];
}

const pct = (made: number, att: number) => (att > 0 ? Math.round((made / att) * 1000) / 1000 : 0);
const num = (v: string | undefined) => {
  const n = Number(String(v ?? '').replace(/^\+/, ''));
  return Number.isFinite(n) ? n : 0;
};

/** Normalized for matching ESPN names to ours: no accents, punctuation or suffixes. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.'’-]/g, ' ')
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ESPN athlete → NBA personId. Unmatched players get -espnId (never a real NBA id). */
export type PersonIdResolver = (espnId: string, displayName: string) => number;

export function nameResolver(byName: Map<string, number>): PersonIdResolver {
  return (espnId, displayName) => byName.get(normalizeName(displayName)) ?? -Number(espnId || 0);
}

// ── Scoreboard ───────────────────────────────────────────────────────────────

function scoreboardTeam(c: EspnCompetitor): ScoreboardTeam {
  const [wins, losses] = (c.records?.[0]?.summary ?? '').split('-').map(Number);
  return {
    teamId: teamIdOf(c.team?.abbreviation),
    teamName: c.team?.name ?? '',
    teamCity: c.team?.location ?? '',
    teamTricode: tricodeOf(c.team?.abbreviation),
    wins: Number.isFinite(wins) ? wins : 0,
    losses: Number.isFinite(losses) ? losses : 0,
    score: num(c.score),
    periods: (c.linescores ?? []).map((l, i) => ({
      period: i + 1,
      periodType: i < 4 ? 'REGULAR' : 'OVERTIME',
      score: l.value ?? num(l.displayValue),
    })),
    // Not in ESPN's feed; the lineups panel treats these as unknown.
    timeoutsRemaining: undefined as unknown as number,
    inBonus: '',
  };
}

export interface EspnMatch {
  /** ESPN event id of our game, for the summary endpoint. */
  espnEventId: string;
}

/**
 * ESPN scoreboard → CDN scoreboard. Our game (matched by home/away tricodes)
 * carries `nbaGameId` so matchScoreboardGame finds it; other games keep an
 * ESPN-prefixed id (they're only shown in the ticker).
 */
export function toScoreboard(
  json: EspnScoreboardJson,
  ours: { nbaGameId: string; homeTricode: string; awayTricode: string }
): { scoreboard: NBAScoreboardResponse; match: EspnMatch | null } {
  let match: EspnMatch | null = null;
  const games: ScoreboardGame[] = [];
  for (const e of json.events ?? []) {
    const comp = e.competitions?.[0];
    const home = comp?.competitors?.find((c) => c.homeAway === 'home');
    const away = comp?.competitors?.find((c) => c.homeAway === 'away');
    if (!comp || !home || !away) continue;
    const st = comp.status ?? e.status;
    // Postponed/cancelled games read as post without completed.
    if (st?.type?.state === 'post' && !st.type.completed) continue;
    const homeTeam = scoreboardTeam(home);
    const awayTeam = scoreboardTeam(away);
    const isOurs = homeTeam.teamTricode === ours.homeTricode && awayTeam.teamTricode === ours.awayTricode;
    if (isOurs) match = { espnEventId: String(e.id) };
    const status = gameStatusOf(st);
    games.push({
      gameId: isOurs ? ours.nbaGameId.padStart(10, '0') : `espn${e.id}`,
      gameCode: '',
      gameStatus: status,
      gameStatusText: st?.type?.shortDetail ?? '',
      period: st?.period ?? 0,
      gameClock: status === 2 ? isoClock(st?.displayClock) : '',
      gameTimeUTC: comp.date ?? e.date ?? '',
      homeTeam,
      awayTeam,
    });
  }
  const scoreboard: NBAScoreboardResponse = {
    meta: { version: 1, code: 200, request: 'espn', time: new Date().toISOString() },
    scoreboard: { gameDate: '', leagueId: '00', leagueName: 'NBA', games },
  };
  return { scoreboard, match };
}

// ── Play-by-play ─────────────────────────────────────────────────────────────

/** ESPN play type → CDN actionType/subType/shotResult. */
function classify(p: EspnPlay): { actionType: string; subType: string; shotResult?: string } {
  const t = (p.type?.text ?? '').toLowerCase();
  const desc = (p.text ?? '').toLowerCase();
  if (t === 'end period') return { actionType: 'period', subType: 'end' };
  if (t === 'end game') return { actionType: 'game', subType: 'end' };
  if (t.includes('timeout')) return { actionType: 'timeout', subType: t.includes('official') ? 'official' : 'full' };
  if (t.includes('jumpball') || t.includes('jump ball')) return { actionType: 'jumpball', subType: '' };
  if (t.includes('challenge') || t.includes('review')) return { actionType: 'instantreplay', subType: '' };
  if (p.shootingPlay) {
    const shotResult = p.scoringPlay ? 'Made' : 'Missed';
    if (t.startsWith('free throw')) return { actionType: 'freethrow', subType: t.replace('free throw - ', ''), shotResult };
    const three = (p.scoreValue ?? 0) === 3 || desc.includes('three point') || desc.includes('3-pt');
    return { actionType: three ? '3pt' : '2pt', subType: t, shotResult };
  }
  if (t.includes('rebound')) return { actionType: 'rebound', subType: t.includes('offensive') ? 'offensive' : 'defensive' };
  if (t.includes('turnover') || t === 'traveling' || t.includes('violation')) return { actionType: 'turnover', subType: t };
  if (t.includes('foul')) return { actionType: 'foul', subType: t };
  return { actionType: t.replace(/\s+/g, ''), subType: '' };
}

export function toActions(json: EspnSummaryJson, resolve: PersonIdResolver, names: Map<string, string>): PlayByPlayAction[] {
  const comp = json.header?.competitions?.[0];
  const byEspnTeam = new Map<string, string>();
  for (const c of comp?.competitors ?? []) if (c.team?.id) byEspnTeam.set(c.team.id, tricodeOf(c.team.abbreviation));
  const person = (id: string | undefined) => (id ? resolve(id, names.get(id) ?? '') : 0);

  const out: PlayByPlayAction[] = [];
  for (const p of json.plays ?? []) {
    const seq = Number(p.sequenceNumber ?? 0);
    const tri = p.team?.id ? byEspnTeam.get(p.team.id) ?? '' : '';
    const base = {
      clock: isoClock(p.clock?.displayValue),
      period: p.period?.number ?? 0,
      teamId: NBA_TEAM_IDS[tri] ?? 0,
      teamTricode: tri,
      qualifiers: [] as string[],
      description: p.text ?? '',
      scoreHome: String(p.homeScore ?? ''),
      scoreAway: String(p.awayScore ?? ''),
      pointsTotal: 0,
      timeActual: p.wallclock,
    };
    // The CDN logs a substitution as two actions (in, out); ESPN as one with
    // participants [entering, leaving]. actionNumbers stay unique and ordered.
    if ((p.type?.text ?? '').toLowerCase() === 'substitution') {
      const [entering, leaving] = p.participants ?? [];
      out.push({ ...base, actionNumber: seq * 2, actionType: 'substitution', subType: 'out', personId: person(leaving?.athlete?.id) });
      out.push({ ...base, actionNumber: seq * 2 + 1, actionType: 'substitution', subType: 'in', personId: person(entering?.athlete?.id) });
      continue;
    }
    const c = classify(p);
    out.push({
      ...base,
      actionNumber: seq * 2,
      actionType: c.actionType,
      subType: c.subType,
      shotResult: c.shotResult,
      personId: person(p.participants?.[0]?.athlete?.id),
    });
  }
  return out;
}

// ── Box score ────────────────────────────────────────────────────────────────

const ZERO_TEAM_STATS: TeamStatistics = {
  assists: 0, blocks: 0, fieldGoalsAttempted: 0, fieldGoalsMade: 0, fieldGoalsPercentage: 0,
  foulsPersonal: 0, freeThrowsAttempted: 0, freeThrowsMade: 0, freeThrowsPercentage: 0, points: 0,
  reboundsDefensive: 0, reboundsOffensive: 0, reboundsTotal: 0, steals: 0,
  threePointersAttempted: 0, threePointersMade: 0, threePointersPercentage: 0, turnovers: 0,
};

function playerStats(labels: string[], stats: string[]): PlayerStatistics {
  const at = (l: string) => stats[labels.indexOf(l)];
  const [fgm, fga] = madeAttempted(at('FG'));
  const [tpm, tpa] = madeAttempted(at('3PT'));
  const [ftm, fta] = madeAttempted(at('FT'));
  const min = num(at('MIN'));
  const pm = num(at('+/-'));
  return {
    assists: num(at('AST')),
    blocks: num(at('BLK')),
    fieldGoalsAttempted: fga,
    fieldGoalsMade: fgm,
    fieldGoalsPercentage: pct(fgm, fga),
    foulsPersonal: num(at('PF')),
    freeThrowsAttempted: fta,
    freeThrowsMade: ftm,
    freeThrowsPercentage: pct(ftm, fta),
    minutes: `PT${String(min).padStart(2, '0')}M00.00S`,
    minutesCalculated: `PT${min}M`,
    plus: Math.max(0, pm),
    minus: Math.max(0, -pm),
    plusMinusPoints: pm,
    points: num(at('PTS')),
    reboundsDefensive: num(at('DREB')),
    reboundsOffensive: num(at('OREB')),
    reboundsTotal: num(at('REB')),
    steals: num(at('STL')),
    threePointersAttempted: tpa,
    threePointersMade: tpm,
    threePointersPercentage: pct(tpm, tpa),
    turnovers: num(at('TO')),
  };
}

function teamStats(players: BoxscorePlayer[], espn: Array<{ name?: string; displayValue?: string }> | undefined, score: number): TeamStatistics {
  // Sum the players (exact for everything we show), then prefer ESPN's team
  // totals where it has them (they include team rebounds/turnovers).
  const s: TeamStatistics = { ...ZERO_TEAM_STATS };
  for (const p of players) {
    const ps = p.statistics;
    s.assists += ps.assists; s.blocks += ps.blocks; s.steals += ps.steals; s.turnovers += ps.turnovers;
    s.fieldGoalsMade += ps.fieldGoalsMade; s.fieldGoalsAttempted += ps.fieldGoalsAttempted;
    s.threePointersMade += ps.threePointersMade; s.threePointersAttempted += ps.threePointersAttempted;
    s.freeThrowsMade += ps.freeThrowsMade; s.freeThrowsAttempted += ps.freeThrowsAttempted;
    s.reboundsOffensive += ps.reboundsOffensive; s.reboundsDefensive += ps.reboundsDefensive; s.reboundsTotal += ps.reboundsTotal;
    s.foulsPersonal += ps.foulsPersonal;
  }
  const by = new Map((espn ?? []).map((x) => [x.name ?? '', x.displayValue]));
  if (by.has('totalRebounds')) s.reboundsTotal = num(by.get('totalRebounds'));
  if (by.has('offensiveRebounds')) s.reboundsOffensive = num(by.get('offensiveRebounds'));
  if (by.has('defensiveRebounds')) s.reboundsDefensive = num(by.get('defensiveRebounds'));
  if (by.has('totalTurnovers')) s.turnovers = num(by.get('totalTurnovers'));
  s.points = score;
  s.fieldGoalsPercentage = pct(s.fieldGoalsMade, s.fieldGoalsAttempted);
  s.threePointersPercentage = pct(s.threePointersMade, s.threePointersAttempted);
  s.freeThrowsPercentage = pct(s.freeThrowsMade, s.freeThrowsAttempted);
  return s;
}

/** Who is on the floor now: starters, then every substitution in order. */
function onCourt(teamId: number, starters: number[], actions: PlayByPlayAction[]): Set<number> {
  const on = new Set(starters);
  for (const a of actions) {
    if (a.actionType !== 'substitution' || a.teamId !== teamId || !a.personId) continue;
    if (a.subType === 'in') on.add(a.personId);
    else on.delete(a.personId);
  }
  return on;
}

export function toBoxscore(json: EspnSummaryJson, nbaGameId: string, resolve: PersonIdResolver, actions: PlayByPlayAction[]): BoxscoreGame | null {
  const comp = json.header?.competitions?.[0];
  const st = comp?.status;
  const status = gameStatusOf(st);
  const teams = new Map<string, BoxscoreTeam>();

  for (const c of comp?.competitors ?? []) {
    const tri = tricodeOf(c.team?.abbreviation);
    const teamId = NBA_TEAM_IDS[tri] ?? 0;
    const block = json.boxscore?.players?.find((p) => tricodeOf(p.team?.abbreviation) === tri)?.statistics?.[0];
    const labels = block?.labels ?? [];
    const lines = block?.athletes ?? [];
    const starters = lines.filter((l) => l.starter).map((l) => resolve(l.athlete?.id ?? '', l.athlete?.displayName ?? ''));
    const on = status >= 2 ? onCourt(teamId, starters, actions) : new Set<number>();
    const players: BoxscorePlayer[] = lines.map((l, i) => {
      const personId = resolve(l.athlete?.id ?? '', l.athlete?.displayName ?? '');
      const name = l.athlete?.displayName ?? '';
      const played = !l.didNotPlay && (l.stats?.length ?? 0) > 0;
      return {
        status: l.active === false && !played ? 'INACTIVE' : 'ACTIVE',
        order: i + 1,
        personId,
        jerseyNum: l.athlete?.jersey ?? '',
        name,
        nameI: l.athlete?.shortName ?? name,
        position: l.athlete?.position?.abbreviation ?? '',
        starter: l.starter ? '1' : '0',
        oncourt: on.has(personId) ? '1' : '0',
        played: played ? '1' : '0',
        statistics: playerStats(labels, played ? l.stats ?? [] : []),
      };
    });
    const score = num(c.score);
    const team: BoxscoreTeam = {
      teamId,
      teamName: c.team?.name ?? '',
      teamCity: c.team?.location ?? '',
      teamTricode: tri,
      score,
      periods: (c.linescores ?? []).map((l, i) => ({
        period: i + 1,
        periodType: i < 4 ? 'REGULAR' : 'OVERTIME',
        score: l.value ?? num(l.displayValue),
      })),
      statistics: teamStats(
        players.filter((p) => p.played === '1'),
        json.boxscore?.teams?.find((t) => tricodeOf(t.team?.abbreviation) === tri)?.statistics,
        score
      ),
      players,
    };
    teams.set(c.homeAway ?? '', team);
  }
  const homeTeam = teams.get('home');
  const awayTeam = teams.get('away');
  if (!homeTeam || !awayTeam) return null;
  // The summary header can omit period/clock (it does once final): fall back
  // to the newest play, then the line score.
  const last = actions.at(-1);
  const period = st?.period ?? last?.period ?? homeTeam.periods.length;
  const clock = st?.displayClock !== undefined ? isoClock(st.displayClock) : last?.clock ?? '';
  return {
    gameId: nbaGameId.padStart(10, '0'),
    gameStatus: status,
    gameStatusText: st?.type?.shortDetail ?? '',
    period,
    gameClock: status === 2 ? clock : '',
    gameTimeUTC: comp?.date ?? '',
    regulationPeriods: 4,
    homeTeam,
    awayTeam,
  };
}

/** ESPN athlete id → display name, from the summary's box score (plays only carry ids). */
export function athleteNames(json: EspnSummaryJson): Map<string, string> {
  const names = new Map<string, string>();
  for (const t of json.boxscore?.players ?? []) {
    for (const l of t.statistics?.[0]?.athletes ?? []) {
      if (l.athlete?.id) names.set(l.athlete.id, l.athlete.displayName ?? '');
    }
  }
  return names;
}

export function toPbpResponse(nbaGameId: string, actions: PlayByPlayAction[]): NBAPlayByPlayResponse {
  return {
    meta: { version: 1, code: 200, request: 'espn', time: new Date().toISOString() },
    game: { gameId: nbaGameId.padStart(10, '0'), actions },
  } as NBAPlayByPlayResponse;
}

export function toBoxResponse(game: BoxscoreGame): NBABoxscoreResponse {
  return { meta: { version: 1, code: 200, request: 'espn', time: new Date().toISOString() }, game };
}

// ── Fetch ────────────────────────────────────────────────────────────────────

async function espnGet<T>(url: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { Accept: 'application/json' }, signal: controller.signal });
    if (!res.ok) throw new Error(`ESPN ${res.status}: ${new URL(url).pathname}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timeout);
  }
}

/** gameDate is the game's US Eastern date, "YYYY-MM-DD". */
export function fetchEspnScoreboard(gameDate: string): Promise<EspnScoreboardJson> {
  return espnGet(`${ESPN_SITE}/scoreboard?dates=${gameDate.replaceAll('-', '')}`);
}

export function fetchEspnSummary(eventId: string): Promise<EspnSummaryJson> {
  return espnGet(`${ESPN_SITE}/summary?event=${encodeURIComponent(eventId)}`);
}
