// scripts/lib/insights/engine/records.ts
// Where complete records begin (app_kv insights.records_start, written by
// scripts/build-record-book.ts as { season_id, label }). Pure.
import { currentSeasonId, seasonLabel } from '../../schedule-utils.js';
import type { InsightSeason, RecordsStart } from './types.js';

export function parseRecordsStart(value: unknown): RecordsStart | null {
  if (typeof value === 'number' && Number.isInteger(value)) return { season_id: value, label: seasonLabel(value) };
  if (value !== null && typeof value === 'object') {
    const id = (value as { season_id?: unknown }).season_id;
    const label = (value as { label?: unknown }).label;
    if (typeof id === 'number' && Number.isInteger(id)) {
      return { season_id: id, label: typeof label === 'string' && label ? label : seasonLabel(id) };
    }
  }
  return null;
}

/**
 * Date before any game of a season, after every game of the one before. Normally Aug 1,
 * but 2019-20 finished in the NBA bubble (to 2020-10-11), so 2020-21 starts after Nov 1.
 * record-book/highs.ts keeps its own `${firstSeason}-08-01` for stat eras (1970-1996),
 * where the rule is identical (the bubble never applies there).
 */
export function seasonStartDate(seasonId: number): string {
  return seasonId === 2020 ? '2020-11-01' : `${seasonId}-08-01`;
}

/** A career is complete when the player's first recorded season is strictly after where records start. */
export function careerComplete(firstSeason: number | null, start: RecordsStart | null): boolean {
  return start !== null && firstSeason !== null && firstSeason > start.season_id;
}

/** Seasons of records from the start through `throughSeason`, at least 1. */
export function recordsSeasons(start: RecordsStart, throughSeason: number): number {
  return Math.max(1, throughSeason - start.season_id + 1);
}

/**
 * The season a fact is worded in. Postgame and player facts can belong to a
 * newer season than the stats season (the first games of a season, before
 * MIN_SEASON_GAMES): "his season high" must mean the fact's season.
 */
export function renderSeason(seasonId: number | null, season: InsightSeason, asOf: string, factDate: string): InsightSeason {
  if (seasonId === null || seasonId === season.id) return season;
  const label = seasonLabel(seasonId);
  const isCurrent = seasonId === currentSeasonId(new Date(`${asOf}T12:00:00Z`));
  return { id: seasonId, label, isCurrent, phrase: isCurrent ? 'this season' : `in ${label}`, lastGameDate: factDate };
}
