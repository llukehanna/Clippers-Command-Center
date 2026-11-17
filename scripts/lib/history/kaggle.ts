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
  if (t === 1 || t === 3 || t === 6) return null;
  if ((t !== 2 && t !== 4 && t !== 5) || !Number.isInteger(nbaGameId) || nbaGameId < 10000000 || nbaGameId > 99999999) {
    throw new KaggleRowError('Games.csv', c.gameId, row[c.gameId] ?? '');
  }
  const label = (row[c.gameType] ?? '').trim();
  if (label && !TYPE_HINTS[t].test(label)) {
    console.warn(`Game ${nbaGameId}: type column "${label}" disagrees with id prefix ${t}; trusting the id`);
  }
  return {
    nbaGameId,
    seasonId: seasonIdOfGame(nbaGameId),
    gameDate: reqDate(row[c.gameDate], 'Games.csv', c.gameDate),
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

/**
 * The leading YYYY-MM-DD of a date or date-time cell. Throws KaggleRowError for
 * a blank, malformed or impossible date (2019-02-30), so the row is counted and
 * skipped instead of failing a ::date cast mid-run.
 */
function reqDate(cell: string | undefined, file: string, field: string): string {
  const d = (cell ?? '').trim().slice(0, 10);
  const t = /^\d{4}-\d{2}-\d{2}$/.test(d) ? Date.parse(`${d}T00:00:00Z`) : NaN;
  if (Number.isNaN(t) || new Date(t).toISOString().slice(0, 10) !== d) throw new KaggleRowError(file, field, cell ?? '');
  return d;
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

/**
 * Untracked stats are null by era. The first season (start year) each stat was
 * recorded; for earlier games parsePlayerGame forces it to null whatever the
 * cell says, because NBA.com-derived data can write 0 for "not recorded".
 * Source: the spec's "Data completeness by era" section
 * (Docs/superpowers/specs/2026-11-17-history-archive-games-design.md, from
 * Basketball-Reference's coverage table): steals and blocks start in 1973-74
 * (offensive/defensive rebounds with them), turnovers in 1977-78, 3-pointers in
 * 1979-80. Plus-minus is NBA.com's, from 1996-97. Total rebounds, points, FG and
 * FT are complete for every era and are never masked.
 */
export const STAT_TRACKED_FROM_SEASON = {
  steals: 1973, blocks: 1973, offReb: 1973, defReb: 1973,
  turnovers: 1977,
  fg3Made: 1979, fg3Attempted: 1979,
  plusMinus: 1996,
} as const satisfies Partial<Record<keyof KagglePlayerGame, number>>;

export function parsePlayerGame(row: Row): KagglePlayerGame {
  const c = PLAYER_STATS_COLUMNS;
  const nbaGameId = reqNum(row[c.gameId], 'PlayerStatistics.csv', c.gameId);
  const season = seasonIdOfGame(nbaGameId);
  const n = (k: keyof typeof c) => {
    const h = c[k];
    const from = (STAT_TRACKED_FROM_SEASON as Partial<Record<string, number>>)[k];
    if (from !== undefined && season < from) return null;
    return h ? num(row[h]) : null;
  };
  return {
    nbaGameId,
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

// ── Raw-cell report ──────────────────────────────────────────────────────────
// For the import report: how the CSV writes stats in the partly tracked eras,
// read from the raw cells BEFORE the era mask, so Luke can judge whether 1973-82
// seasons use 0 for "not recorded".

export const RAW_CELL_STATS = ['steals', 'blocks', 'turnovers', 'offReb', 'fg3Attempted', 'minutes'] as const;
export type RawCellStat = (typeof RAW_CELL_STATS)[number];
export const RAW_CELL_SEASONS = { from: 1970, to: 1985 } as const;

/** blank: empty or unreadable (imported as null); zero: 0; nonZero: any other number. */
export type CellCounts = { blank: number; zero: number; nonZero: number };
export type RawCellTally = Record<number, Record<RawCellStat, CellCounts>>;

/** Adds one row's raw cells to the tally when its season is in RAW_CELL_SEASONS. */
export function tallyRawCells(tally: RawCellTally, row: Row, nbaGameId: number): void {
  const season = seasonIdOfGame(nbaGameId);
  if (season < RAW_CELL_SEASONS.from || season > RAW_CELL_SEASONS.to) return;
  const bySeason = (tally[season] ??= Object.fromEntries(
    RAW_CELL_STATS.map((k) => [k, { blank: 0, zero: 0, nonZero: 0 }]),
  ) as Record<RawCellStat, CellCounts>);
  for (const k of RAW_CELL_STATS) {
    const v = num(row[PLAYER_STATS_COLUMNS[k]]);
    const counts = bySeason[k];
    if (v === null) counts.blank++;
    else if (v === 0) counts.zero++;
    else counts.nonZero++;
  }
}
