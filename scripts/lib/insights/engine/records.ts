// scripts/lib/insights/engine/records.ts
// Where complete records begin (app_kv insights.records_start, written by
// scripts/build-record-book.ts as { season_id, label }). Pure.
import { seasonLabel } from '../../schedule-utils.js';
import type { RecordsStart } from './types.js';

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

/** Date before any game of a season (same rule as record-book/highs.ts firstSeason). */
export function seasonStartDate(seasonId: number): string {
  return `${seasonId}-08-01`;
}

/** Seasons of records from the start through `throughSeason`, at least 1. */
export function recordsSeasons(start: RecordsStart, throughSeason: number): number {
  return Math.max(1, throughSeason - start.season_id + 1);
}
