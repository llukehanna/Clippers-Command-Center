// scripts/lib/history/import-plan.ts
// Pure helpers for scripts/import-kaggle-history.ts: load order, the storage
// guard, the pre-write era check, team box totals and report checks. No DB imports.
import type { KaggleGame, KagglePlayerGame } from './kaggle.js';
import { resolveEra, franchiseStartSeason } from './team-eras.js';
import { played } from './season-totals.js';
import { TRICODE_BY_NBA_ID } from '../nba-teams.js';

export const CLIPPERS_FRANCHISE_ID = 1610612746;
/** Clippers per-game rows: 1970-71 through 2018-19. */
export const CLIPPERS_FIRST_SEASON = 1970;
/** League per-game rows: 1996-97 through 2018-19. */
export const LEAGUE_FIRST_SEASON = 1996;
export const LAST_ARCHIVE_SEASON = 2018;
/** 2019-20 is a gap fill: every game, skipping ones that already have box scores. */
export const GAP_FILL_SEASON = 2019;
// 2020-21 and later belong to the live pipeline; nothing here writes them.

export type LoadStep = { seasonId: number; scope: 'clippers' | 'league' };

/** Clippers seasons oldest first, then the 2019 gap fill, then league seasons newest first. */
export function planLoad(seasonsInFile: number[]): LoadStep[] {
  const seasons = [...new Set(seasonsInFile)].sort((a, b) => a - b);
  const steps: LoadStep[] = [];
  for (const s of seasons) {
    if (s >= CLIPPERS_FIRST_SEASON && s <= LAST_ARCHIVE_SEASON) steps.push({ seasonId: s, scope: 'clippers' });
  }
  if (seasons.includes(GAP_FILL_SEASON)) steps.push({ seasonId: GAP_FILL_SEASON, scope: 'league' });
  for (const s of [...seasons].reverse()) {
    if (s >= LEAGUE_FIRST_SEASON && s <= LAST_ARCHIVE_SEASON) steps.push({ seasonId: s, scope: 'league' });
  }
  return steps;
}

const isClippersGame = (g: KaggleGame) =>
  g.homeFranchiseId === CLIPPERS_FRANCHISE_ID || g.awayFranchiseId === CLIPPERS_FRANCHISE_ID;

/**
 * The games a step writes. A league step for a season that also has a Clippers
 * step leaves the Clippers games to that step (they were written or skipped there).
 */
export function stepGames(step: LoadStep, games: KaggleGame[]): KaggleGame[] {
  const season = games.filter((g) => g.seasonId === step.seasonId);
  if (step.scope === 'clippers') return season.filter(isClippersGame);
  if (step.seasonId <= LAST_ARCHIVE_SEASON && step.seasonId >= CLIPPERS_FIRST_SEASON) {
    return season.filter((g) => !isClippersGame(g));
  }
  return season;
}

/** True when the database stays at or under 85% of the cap after writing the estimate. */
export function guardAllows(currentBytes: number, estimatedBytes: number, capMb: number): boolean {
  return currentBytes + estimatedBytes <= 0.85 * capMb * 1024 * 1024;
}

export function estimateBytes(playerRows: number, teamRows: number): number {
  return playerRows * 250 + teamRows * 300;
}

export type EraProblem = {
  seasonId: number;
  franchiseId: number;
  tricode: string | null;
  reason: 'unknown franchise' | 'no era';
};

/**
 * R12 pre-write check over every game from 1970 on: each franchise must be one
 * of the 30 and have an era that season. Seasons before a franchise's first era
 * and Charlotte's dormant 2002-03 are exempt.
 */
export function eraProblems(games: KaggleGame[]): EraProblem[] {
  const seen = new Set<string>();
  const out: EraProblem[] = [];
  for (const g of games) {
    if (g.seasonId < CLIPPERS_FIRST_SEASON) continue;
    for (const fid of [g.homeFranchiseId, g.awayFranchiseId]) {
      const key = `${g.seasonId}:${fid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const tricode = TRICODE_BY_NBA_ID[fid] ?? null;
      if (!tricode) {
        out.push({ seasonId: g.seasonId, franchiseId: fid, tricode: null, reason: 'unknown franchise' });
        continue;
      }
      if (resolveEra(tricode, g.seasonId)) continue;
      if (g.seasonId < franchiseStartSeason(tricode)) continue;
      if (tricode === 'CHA' && (g.seasonId === 2002 || g.seasonId === 2003)) continue;
      out.push({ seasonId: g.seasonId, franchiseId: fid, tricode, reason: 'no era' });
    }
  }
  return out.sort((a, b) => a.seasonId - b.seasonId || a.franchiseId - b.franchiseId);
}

export type TeamBox = {
  points: number | null; rebounds: number | null; assists: number | null; steals: number | null;
  blocks: number | null; turnovers: number | null; fouls: number | null;
  fg_made: number | null; fg_attempted: number | null; fg3_made: number | null; fg3_attempted: number | null;
  ft_made: number | null; ft_attempted: number | null; offensive_reb: number | null; defensive_reb: number | null;
};

const TEAM_BOX_FIELDS: Record<keyof TeamBox, keyof KagglePlayerGame> = {
  points: 'points', rebounds: 'rebounds', assists: 'assists', steals: 'steals', blocks: 'blocks',
  turnovers: 'turnovers', fouls: 'fouls', fg_made: 'fgMade', fg_attempted: 'fgAttempted',
  fg3_made: 'fg3Made', fg3_attempted: 'fg3Attempted', ft_made: 'ftMade', ft_attempted: 'ftAttempted',
  offensive_reb: 'offReb', defensive_reb: 'defReb',
};
export const TEAM_BOX_COLUMNS = Object.keys(TEAM_BOX_FIELDS) as Array<keyof TeamBox>;

const nullBox = (points: number): TeamBox => {
  const out = {} as TeamBox;
  for (const col of TEAM_BOX_COLUMNS) out[col] = null;
  out.points = points;
  return out;
};

/**
 * One side's team box. `points` is the side's final score (Games.csv), never
 * the player sum: a game missing a player row must not become a fake
 * franchise low. Every other stat is summed from the side's counted (played)
 * rows; a total is null if any counted row lacks it, and all of them are null
 * when no row counts.
 */
export function teamBoxFromRows(rows: KagglePlayerGame[], points: number): TeamBox {
  const counted = rows.filter(played);
  const out = nullBox(points);
  if (counted.length === 0) return out;
  for (const col of TEAM_BOX_COLUMNS) {
    if (col === 'points') continue;
    let total: number | null = 0;
    for (const r of counted) {
      const v = r[TEAM_BOX_FIELDS[col]] as number | null;
      if (v === null) { total = null; break; }
      total += v;
    }
    out[col] = total;
  }
  return out;
}

/**
 * Both team boxes for a game, or neither. When only one side has counted rows
 * the other still gets a box (its final score, every other stat null), so
 * compute-stats never sees a one-sided game. A game with no counted rows on
 * either side has no box score at all: null.
 */
export function teamBoxesForGame(game: KaggleGame, rows: KagglePlayerGame[]): { home: TeamBox; away: TeamBox } | null {
  const mine = rows.filter((r) => r.nbaGameId === game.nbaGameId);
  if (!mine.some(played)) return null;
  return {
    home: teamBoxFromRows(mine.filter((r) => r.isHome), game.homeScore),
    away: teamBoxFromRows(mine.filter((r) => !r.isHome), game.awayScore),
  };
}

export type PointsMismatch = {
  gameId: number; side: 'home' | 'away';
  /** Summed points of the side's counted rows; null when a counted row has no points. */
  sum: number | null;
  score: number;
};

export type PointsCheck = {
  /** Sides with counted rows whose points do not add up to the final score. */
  mismatches: PointsMismatch[];
  /** Sides with no counted player row at all. */
  noPlayerRows: Array<{ gameId: number; side: 'home' | 'away'; score: number }>;
};

/** Compares each side's summed player points with its final score, ordered by season, game id, then side. */
export function checkPointsAgainstScores(games: KaggleGame[], rows: KagglePlayerGame[]): PointsCheck {
  const byGame = new Map<number, KagglePlayerGame[]>();
  for (const r of rows) {
    if (!played(r)) continue;
    const a = byGame.get(r.nbaGameId); if (a) a.push(r); else byGame.set(r.nbaGameId, [r]);
  }
  const out: PointsCheck = { mismatches: [], noPlayerRows: [] };
  for (const g of [...games].sort((a, b) => a.seasonId - b.seasonId || a.nbaGameId - b.nbaGameId)) {
    const counted = byGame.get(g.nbaGameId) ?? [];
    for (const side of ['home', 'away'] as const) {
      const score = side === 'home' ? g.homeScore : g.awayScore;
      const sideRows = counted.filter((r) => r.isHome === (side === 'home'));
      if (sideRows.length === 0) { out.noPlayerRows.push({ gameId: g.nbaGameId, side, score }); continue; }
      const sum = sideRows.some((r) => r.points === null) ? null : sideRows.reduce((s, r) => s + (r.points as number), 0);
      if (sum !== score) out.mismatches.push({ gameId: g.nbaGameId, side, sum, score });
    }
  }
  return out;
}

/** Report shape for a long list: the total plus the first `cap` items. */
export function capped<T>(items: T[], cap = 200): { total: number; shown: number; items: T[] } {
  return { total: items.length, shown: Math.min(cap, items.length), items: items.slice(0, cap) };
}
