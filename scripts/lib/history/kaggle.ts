// scripts/lib/history/kaggle.ts
// Reads the Kaggle "Historical NBA Data and Player Box Scores" CSVs (CC0) and
// maps rows to typed records. Pure apart from streamCsv's file read; no DB.
// Cardinal rule: a stat nobody recorded is null, never 0.
//
// Row contract: parseGame returns null ONLY for games skipped by design
// (preseason, All-Star, Cup final). Any malformed row (missing id/score/personId,
// unreadable home flag) throws KaggleRowError; the import task catches it per
// row, counts it and samples it instead of aborting the run.
import fs from 'node:fs';
import { parse } from 'csv-parse';

// Our field -> CSV header. Unverified against the real download; fix names here only.
export const GAMES_COLUMNS = {
  gameId: 'gameId',
  gameDate: 'gameDateTimeEst',
  homeCity: 'hometeamCity',
  homeName: 'hometeamName',
  homeId: 'hometeamId',
  awayCity: 'awayteamCity',
  awayName: 'awayteamName',
  awayId: 'awayteamId',
  homeScore: 'homeScore',
  awayScore: 'awayScore',
  gameType: 'gameType',
} as const;

export const PLAYER_STATS_COLUMNS = {
  firstName: 'firstName',
  lastName: 'lastName',
  personId: 'personId',
  gameId: 'gameId',
  home: 'home',
  minutes: 'numMinutes',
  points: 'points',
  assists: 'assists',
  blocks: 'blocks',
  steals: 'steals',
  fgAttempted: 'fieldGoalsAttempted',
  fgMade: 'fieldGoalsMade',
  fg3Attempted: 'threePointersAttempted',
  fg3Made: 'threePointersMade',
  ftAttempted: 'freeThrowsAttempted',
  ftMade: 'freeThrowsMade',
  defReb: 'reboundsDefensive',
  offReb: 'reboundsOffensive',
  rebounds: 'reboundsTotal',
  fouls: 'foulsPersonal',
  turnovers: 'turnovers',
  plusMinus: 'plusMinusPoints',
  // The dataset probably has no starter column; null means starter is unknown.
  starter: null as string | null,
} as const;

export const PLAYERS_COLUMNS = {
  personId: 'personId',
  firstName: 'firstName',
  lastName: 'lastName',
  birthdate: 'birthdate',
} as const;

const requiredOf = (cols: Record<string, string | null>): string[] =>
  Object.values(cols).filter((v): v is string => !!v);

// Starter is optional, so it is not required.
export const REQUIRED_GAMES_COLUMNS = requiredOf(GAMES_COLUMNS);
export const REQUIRED_PLAYER_STATS_COLUMNS = requiredOf({ ...PLAYER_STATS_COLUMNS, starter: null });
export const REQUIRED_PLAYERS_COLUMNS = requiredOf(PLAYERS_COLUMNS);

export type KaggleGame = {
  nbaGameId: number; seasonId: number; gameDate: string;
  homeFranchiseId: number; awayFranchiseId: number;
  homeScore: number; awayScore: number; isPlayoffs: boolean;
  homeCity: string; homeName: string; awayCity: string; awayName: string;
};

export type KagglePlayerGame = {
  nbaGameId: number; personId: number; firstName: string; lastName: string;
  isHome: boolean; starter: boolean | null; minutes: string | null;
  points: number | null; rebounds: number | null; assists: number | null;
  steals: number | null; blocks: number | null; turnovers: number | null;
  fouls: number | null; plusMinus: number | null;
  fgMade: number | null; fgAttempted: number | null;
  fg3Made: number | null; fg3Attempted: number | null;
  ftMade: number | null; ftAttempted: number | null;
  offReb: number | null; defReb: number | null;
};

export type KagglePerson = { personId: number; firstName: string; lastName: string; birthdate: string | null };

type Row = Record<string, string>;

export class KaggleRowError extends Error {
  constructor(readonly file: string, readonly field: string, readonly value: string) {
    super(`Bad value in ${file}, column ${field}: ${JSON.stringify(value)}`);
    this.name = 'KaggleRowError';
  }
}

export async function* streamCsv(path: string): AsyncIterable<Row> {
  const parser = fs.createReadStream(path).pipe(
    parse({ columns: true, relax_column_count: true, bom: true }),
  );
  for await (const record of parser) yield record as Row;
}

export function assertHeaders(file: string, headers: string[], required: string[]): void {
  const have = new Set(headers);
  const missing = required.filter((h) => !have.has(h));
  if (missing.length > 0) {
    throw new Error(`Missing columns in ${file}: ${missing.join(', ')} (found: ${headers.join(', ')})`);
  }
}

/** Blank or non-numeric -> null; otherwise the number (0 stays 0). */
function num(cell: string | undefined): number | null {
  if (cell == null || cell.trim() === '') return null;
  const n = Number(cell);
  return Number.isFinite(n) ? n : null;
}

function reqNum(cell: string | undefined, file: string, field: string): number {
  const n = num(cell);
  if (n == null) throw new KaggleRowError(file, field, cell ?? '');
  return n;
}

function bool(cell: string | undefined): boolean | null {
  const v = (cell ?? '').trim().toLowerCase();
  if (v === '1' || v === '1.0' || v === 'true') return true;
  if (v === '0' || v === '0.0' || v === 'false') return false;
  return null;
}

/** Ids are TYYNNNNN: T game type, YY season start year mod 100 (>=46 means 19YY). */
export function seasonIdOfGame(nbaGameId: number): number {
  const yy = Math.floor(nbaGameId / 100000) % 100;
  return yy >= 46 ? 1900 + yy : 2000 + yy;
}

const gameTypeOf = (nbaGameId: number) => Math.floor(nbaGameId / 10000000);

const TYPE_HINTS: Record<number, RegExp> = {
  2: /regular/i, 4: /playoff/i, 5: /play-?in/i,
};

export function parseGame(row: Row): KaggleGame | null {
  const c = GAMES_COLUMNS;
  const nbaGameId = reqNum(row[c.gameId], 'Games.csv', c.gameId);
  const t = gameTypeOf(nbaGameId);
  if (t !== 2 && t !== 4 && t !== 5) return null;
  const label = (row[c.gameType] ?? '').trim();
  if (label && !TYPE_HINTS[t].test(label)) {
    console.warn(`Game ${nbaGameId}: type column "${label}" disagrees with id prefix ${t}; trusting the id`);
  }
  return {
    nbaGameId,
    seasonId: seasonIdOfGame(nbaGameId),
    gameDate: (row[c.gameDate] ?? '').trim().slice(0, 10),
    homeFranchiseId: reqNum(row[c.homeId], 'Games.csv', c.homeId),
    awayFranchiseId: reqNum(row[c.awayId], 'Games.csv', c.awayId),
    homeScore: reqNum(row[c.homeScore], 'Games.csv', c.homeScore),
    awayScore: reqNum(row[c.awayScore], 'Games.csv', c.awayScore),
    isPlayoffs: t === 4,
    homeCity: row[c.homeCity] ?? '',
    homeName: row[c.homeName] ?? '',
    awayCity: row[c.awayCity] ?? '',
    awayName: row[c.awayName] ?? '',
  };
}

/** Decimal minutes ("34.5") to "MM:SS"; blank -> null. */
export function minutesToClock(decimalMinutes: string): string | null {
  const m = num(decimalMinutes);
  if (m == null) return null;
  const total = Math.round(m * 60);
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

function reqHome(cell: string | undefined): boolean {
  const v = bool(cell);
  if (v == null) throw new KaggleRowError('PlayerStatistics.csv', PLAYER_STATS_COLUMNS.home, cell ?? '');
  return v;
}

export function parsePlayerGame(row: Row): KagglePlayerGame {
  const c = PLAYER_STATS_COLUMNS;
  const n = (k: keyof typeof c) => {
    const h = c[k];
    return h ? num(row[h]) : null;
  };
  return {
    nbaGameId: reqNum(row[c.gameId], 'PlayerStatistics.csv', c.gameId),
    personId: reqNum(row[c.personId], 'PlayerStatistics.csv', c.personId),
    firstName: row[c.firstName] ?? '',
    lastName: row[c.lastName] ?? '',
    isHome: reqHome(row[c.home]),
    starter: c.starter ? bool(row[c.starter]) : null,
    minutes: minutesToClock(row[c.minutes] ?? ''),
    points: n('points'), rebounds: n('rebounds'), assists: n('assists'),
    steals: n('steals'), blocks: n('blocks'), turnovers: n('turnovers'),
    fouls: n('fouls'), plusMinus: n('plusMinus'),
    fgMade: n('fgMade'), fgAttempted: n('fgAttempted'),
    fg3Made: n('fg3Made'), fg3Attempted: n('fg3Attempted'),
    ftMade: n('ftMade'), ftAttempted: n('ftAttempted'),
    offReb: n('offReb'), defReb: n('defReb'),
  };
}

export function parsePerson(row: Row): KagglePerson {
  const c = PLAYERS_COLUMNS;
  const b = (row[c.birthdate] ?? '').trim().slice(0, 10);
  return {
    personId: reqNum(row[c.personId], 'Players.csv', c.personId),
    firstName: row[c.firstName] ?? '',
    lastName: row[c.lastName] ?? '',
    birthdate: b === '' ? null : b,
  };
}
