// scripts/lib/history/season-totals.ts
// Pure aggregation of Kaggle per-game rows into team_seasons, player_seasons and
// league_season_averages rows. Cardinal rule: a total is null if ANY counted game
// lacks the stat (early eras miss steals, blocks, turnovers, 3-pointers); never
// undercount. A team-game with no player rows at all also nulls its totals.
// Exception: team and opponent POINTS come from the games' final scores, not
// player rows, so a missing player row can't undercount them.
//
// Play-in games (not playoffs, id 50000000-59999999) are excluded from EVERY
// aggregate: NBA.com counts them separately, so they go in neither column.
import type { KaggleGame, KagglePlayerGame } from './kaggle.js';
import { resolveEra } from './team-eras.js';
import { TRICODE_BY_NBA_ID } from '../nba-teams.js';
import { FRANCHISE_RECORDS } from './franchise-records.js';

type N = number | null;

export type Counts = {
  points: N; fgMade: N; fgAttempted: N; fg3Made: N; fg3Attempted: N;
  ftMade: N; ftAttempted: N; rebounds: N; offensiveReb: N; defensiveReb: N;
  assists: N; steals: N; blocks: N; turnovers: N; fouls: N;
};
type Opp<T> = { [K in keyof T as `opp${Capitalize<K & string>}`]: T[K] };

export type PlayerSeasonRow = Counts & {
  seasonId: number; seasonType: 'regular' | 'playoffs'; nbaPersonId: number;
  displayName: string; nbaFranchiseId: number; teamAbbreviation: string | null;
  teamName: string | null; games: number; gamesStarted: N; minutes: N;
};

export type TeamSeasonRow = Counts & Opp<Counts> & {
  seasonId: number; nbaFranchiseId: number; city: string | null; name: string;
  abbreviation: string | null; wins: number; losses: number; playoffRound: number;
  wonTitle: boolean; games: number;
};

export type LeagueAverageRow = {
  seasonId: number; teams: number; games: number;
  ppg: N; rpg: N; apg: N; spg: N; bpg: N; tpg: N;
  fgPct: N; fg3Pct: N; ftPct: N; fg3aPerGame: N; pace: N; ortg: N;
};

// Counts key -> KagglePlayerGame field.
const STAT_FIELDS: Record<keyof Counts, keyof KagglePlayerGame> = {
  points: 'points', fgMade: 'fgMade', fgAttempted: 'fgAttempted', fg3Made: 'fg3Made',
  fg3Attempted: 'fg3Attempted', ftMade: 'ftMade', ftAttempted: 'ftAttempted',
  rebounds: 'rebounds', offensiveReb: 'offReb', defensiveReb: 'defReb',
  assists: 'assists', steals: 'steals', blocks: 'blocks', turnovers: 'turnovers', fouls: 'fouls',
};
const STAT_KEYS = Object.keys(STAT_FIELDS) as Array<keyof Counts>;

const CLIPPERS_ID = 1610612746;

const isPlayIn = (g: KaggleGame) => !g.isPlayoffs && g.nbaGameId >= 50000000 && g.nbaGameId <= 59999999;

function sumNullable(values: N[]): N {
  let total = 0;
  for (const v of values) {
    if (v === null) return null;
    total += v;
  }
  return total;
}

function parseMinutes(m: string | null): N {
  if (m === null) return null;
  const match = /^(\d+):(\d{1,2})$/.exec(m.trim());
  if (!match) return null;
  return Number(match[1]) + Number(match[2]) / 60;
}

// R9: a row is a game played when minutes > 0, or minutes are null and points are not.
export function played(r: KagglePlayerGame): boolean {
  const mins = parseMinutes(r.minutes);
  if (mins !== null) return mins > 0;
  return r.minutes === null && r.points !== null;
}

function sumCounts(items: Counts[]): Counts {
  const out = {} as Counts;
  for (const k of STAT_KEYS) out[k] = sumNullable(items.map((i) => i[k]));
  return out;
}

const rowCounts = (r: KagglePlayerGame): Counts => {
  const out = {} as Counts;
  for (const k of STAT_KEYS) out[k] = r[STAT_FIELDS[k]] as N;
  return out;
};

const nullCounts = (): Counts => Object.fromEntries(STAT_KEYS.map((k) => [k, null])) as Counts;

const round1 = (n: number) => Math.round(n * 10) / 10;

function mostFrequent(values: string[]): string | null {
  const tally = new Map<string, number>();
  for (const v of values) tally.set(v, (tally.get(v) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [v, n] of tally) if (n > bestN) { best = v; bestN = n; }
  return best;
}

// Per (season, franchise): most frequent city/name from the per-game fields.
function franchiseNames(games: KaggleGame[]) {
  const cities = new Map<string, string[]>();
  const names = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const a = m.get(k); if (a) a.push(v); else m.set(k, [v]);
  };
  for (const g of games) {
    const hk = `${g.seasonId}:${g.homeFranchiseId}`;
    const ak = `${g.seasonId}:${g.awayFranchiseId}`;
    push(cities, hk, g.homeCity); push(names, hk, g.homeName);
    push(cities, ak, g.awayCity); push(names, ak, g.awayName);
  }
  return (seasonId: number, franchiseId: number) => {
    const k = `${seasonId}:${franchiseId}`;
    return { city: mostFrequent(cities.get(k) ?? []), name: mostFrequent(names.get(k) ?? []) };
  };
}

function abbreviationFor(franchiseId: number, seasonId: number): string | null {
  const tricode = TRICODE_BY_NBA_ID[franchiseId];
  return tricode ? resolveEra(tricode, seasonId)?.abbreviation ?? null : null;
}

type Joined = { game: KaggleGame; row: KagglePlayerGame; franchiseId: number };

function joinRows(games: KaggleGame[], rows: KagglePlayerGame[]): Joined[] {
  const byId = new Map<number, KaggleGame>();
  for (const g of games) if (!isPlayIn(g)) byId.set(g.nbaGameId, g);
  const out: Joined[] = [];
  for (const row of rows) {
    const game = byId.get(row.nbaGameId);
    if (!game || !played(row)) continue;
    out.push({ game, row, franchiseId: row.isHome ? game.homeFranchiseId : game.awayFranchiseId });
  }
  return out;
}

function playerTotals(rows: KagglePlayerGame[]) {
  return {
    games: rows.length,
    gamesStarted: rows.some((r) => r.starter === null) ? null : rows.filter((r) => r.starter === true).length,
    minutes: ((): N => {
      const m = sumNullable(rows.map((r) => parseMinutes(r.minutes)));
      return m === null ? null : round1(m);
    })(),
    ...sumCounts(rows.map(rowCounts)),
  };
}

export function aggregatePlayerSeasons(games: KaggleGame[], rows: KagglePlayerGame[]): PlayerSeasonRow[] {
  const nameOf = franchiseNames(games);
  const groups = new Map<string, Joined[]>();
  for (const j of joinRows(games, rows)) {
    const type = j.game.isPlayoffs ? 'playoffs' : 'regular';
    const key = `${j.game.seasonId}|${type}|${j.row.personId}|${j.franchiseId}`;
    const a = groups.get(key); if (a) a.push(j); else groups.set(key, [j]);
  }

  const out: PlayerSeasonRow[] = [];
  const perPerson = new Map<string, PlayerSeasonRow[]>();
  for (const [, js] of groups) {
    const { game, row, franchiseId } = js[0];
    const seasonType = game.isPlayoffs ? 'playoffs' : 'regular';
    const t = playerTotals(js.map((j) => j.row));
    const pr: PlayerSeasonRow = {
      seasonId: game.seasonId, seasonType, nbaPersonId: row.personId,
      displayName: `${row.firstName} ${row.lastName}`.trim(),
      nbaFranchiseId: franchiseId,
      teamAbbreviation: abbreviationFor(franchiseId, game.seasonId),
      teamName: nameOf(game.seasonId, franchiseId).name,
      ...t,
    };
    out.push(pr);
    const pk = `${pr.seasonId}|${seasonType}|${pr.nbaPersonId}`;
    const a = perPerson.get(pk); if (a) a.push(pr); else perPerson.set(pk, [pr]);
  }

  // R2: a TOT row only when the player played for more than one franchise.
  for (const [, prs] of perPerson) {
    if (prs.length < 2) continue;
    const first = prs[0];
    out.push({
      seasonId: first.seasonId, seasonType: first.seasonType, nbaPersonId: first.nbaPersonId,
      displayName: first.displayName, nbaFranchiseId: 0, teamAbbreviation: 'TOT', teamName: null,
      games: prs.reduce((s, p) => s + p.games, 0),
      gamesStarted: sumNullable(prs.map((p) => p.gamesStarted)),
      minutes: ((): N => { const m = sumNullable(prs.map((p) => p.minutes)); return m === null ? null : round1(m); })(),
      ...sumCounts(prs),
    });
  }
  return out;
}

export function aggregateTeamSeasons(games: KaggleGame[], rows: KagglePlayerGame[]): TeamSeasonRow[] {
  const real = games.filter((g) => !isPlayIn(g));
  const nameOf = franchiseNames(real);
  const joined = joinRows(real, rows);

  // Counts per (game, franchise) for regular-season games; null when no rows exist.
  const teamGame = new Map<string, Counts>();
  const tgKey = (gameId: number, fid: number) => `${gameId}:${fid}`;
  const bucket = new Map<string, Counts[]>();
  for (const j of joined) {
    if (j.game.isPlayoffs) continue;
    const k = tgKey(j.game.nbaGameId, j.franchiseId);
    const a = bucket.get(k); if (a) a.push(rowCounts(j.row)); else bucket.set(k, [rowCounts(j.row)]);
  }
  for (const [k, v] of bucket) teamGame.set(k, sumCounts(v));
  const countsFor = (gameId: number, fid: number): Counts => teamGame.get(tgKey(gameId, fid)) ?? nullCounts();

  type Acc = {
    wins: number; losses: number; own: Counts[]; opp: Counts[]; opponents: Set<number>;
    pointsFor: number; pointsAgainst: number;
  };
  const teams = new Map<string, Acc & { seasonId: number; fid: number }>();
  const acc = (seasonId: number, fid: number) => {
    const k = `${seasonId}:${fid}`;
    let a = teams.get(k);
    if (!a) {
      a = { seasonId, fid, wins: 0, losses: 0, own: [], opp: [], opponents: new Set(), pointsFor: 0, pointsAgainst: 0 };
      teams.set(k, a);
    }
    return a;
  };

  const lastPlayoff = new Map<number, KaggleGame>();
  for (const g of real) {
    const home = acc(g.seasonId, g.homeFranchiseId);
    const away = acc(g.seasonId, g.awayFranchiseId);
    if (g.isPlayoffs) {
      home.opponents.add(g.awayFranchiseId);
      away.opponents.add(g.homeFranchiseId);
      const prev = lastPlayoff.get(g.seasonId);
      if (!prev || g.gameDate > prev.gameDate || (g.gameDate === prev.gameDate && g.nbaGameId > prev.nbaGameId)) {
        lastPlayoff.set(g.seasonId, g);
      }
      continue;
    }
    const homeWon = g.homeScore > g.awayScore;
    if (homeWon) { home.wins++; away.losses++; } else { away.wins++; home.losses++; }
    home.pointsFor += g.homeScore; home.pointsAgainst += g.awayScore;
    away.pointsFor += g.awayScore; away.pointsAgainst += g.homeScore;
    home.own.push(countsFor(g.nbaGameId, g.homeFranchiseId));
    home.opp.push(countsFor(g.nbaGameId, g.awayFranchiseId));
    away.own.push(countsFor(g.nbaGameId, g.awayFranchiseId));
    away.opp.push(countsFor(g.nbaGameId, g.homeFranchiseId));
  }

  const out: TeamSeasonRow[] = [];
  for (const a of teams.values()) {
    const final = lastPlayoff.get(a.seasonId);
    const champ = final ? (final.homeScore > final.awayScore ? final.homeFranchiseId : final.awayFranchiseId) : null;
    const own = { ...sumCounts(a.own), points: a.pointsFor };
    const opp = { ...sumCounts(a.opp), points: a.pointsAgainst };
    const names = nameOf(a.seasonId, a.fid);
    const row = {
      seasonId: a.seasonId, nbaFranchiseId: a.fid, city: names.city, name: names.name ?? '',
      abbreviation: abbreviationFor(a.fid, a.seasonId),
      wins: a.wins, losses: a.losses, playoffRound: a.opponents.size,
      wonTitle: champ === a.fid, games: a.wins + a.losses, ...own,
    } as TeamSeasonRow;
    for (const k of STAT_KEYS) (row as unknown as Record<string, N>)[`opp${k[0].toUpperCase()}${k.slice(1)}`] = opp[k];
    out.push(row);
  }
  return out;
}

export function leagueAverages(teamSeasons: TeamSeasonRow[]): LeagueAverageRow[] {
  const bySeason = new Map<number, TeamSeasonRow[]>();
  for (const t of teamSeasons) {
    const a = bySeason.get(t.seasonId); if (a) a.push(t); else bySeason.set(t.seasonId, [t]);
  }
  const out: LeagueAverageRow[] = [];
  for (const [seasonId, ts] of bySeason) {
    const tg = ts.reduce((s, t) => s + t.games, 0);
    const s = sumCounts(ts);
    const per = (v: N): N => (v === null || tg === 0 ? null : v / tg);
    const ratio = (a: N, b: N): N => (a === null || b === null || b === 0 ? null : a / b);
    const poss: N = s.fgAttempted === null || s.ftAttempted === null || s.offensiveReb === null || s.turnovers === null
      ? null : s.fgAttempted + 0.44 * s.ftAttempted - s.offensiveReb + s.turnovers;
    out.push({
      seasonId, teams: ts.length, games: tg / 2,
      ppg: per(s.points), rpg: per(s.rebounds), apg: per(s.assists), spg: per(s.steals),
      bpg: per(s.blocks), tpg: per(s.turnovers),
      fgPct: ratio(s.fgMade, s.fgAttempted), fg3Pct: ratio(s.fg3Made, s.fg3Attempted),
      ftPct: ratio(s.ftMade, s.ftAttempted), fg3aPerGame: per(s.fg3Attempted),
      pace: per(poss),
      ortg: poss === null || s.points === null || poss === 0 ? null : (100 * s.points) / poss,
    });
  }
  return out.sort((a, b) => a.seasonId - b.seasonId);
}

// Returns mismatches only. computed/official are 'W-L'.
export function compareFranchiseRecords(teamSeasons: TeamSeasonRow[]): Array<{ seasonId: number; computed: string; official: string }> {
  const out: Array<{ seasonId: number; computed: string; official: string }> = [];
  for (const rec of FRANCHISE_RECORDS) {
    const t = teamSeasons.find((x) => x.seasonId === rec.seasonId && x.nbaFranchiseId === CLIPPERS_ID);
    const computed = t ? `${t.wins}-${t.losses}` : 'missing';
    const official = `${rec.wins}-${rec.losses}`;
    if (computed !== official) out.push({ seasonId: rec.seasonId, computed, official });
  }
  return out;
}
