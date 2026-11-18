import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDataset, type OnlyValue } from './build-dataset.js';

// The fake cache: 2017-18 and 2026-27 (see scripts/lib/__fixtures__/franchise/cache/manifest.json).
const DIR = path.join(process.cwd(), 'scripts/lib/__fixtures__/franchise/cache');
const build = (only: OnlyValue | null = null) =>
  buildDataset(DIR, { players: [], teamSeasons: [] }, { from: 2017, to: 2026, only, currentDraftYear: 2027, overrides: [] });

describe('buildDataset (fake cache)', () => {
  it('builds every table and covers the seasons whose BBRef pages are both cached', () => {
    const { data, checks } = build();
    expect(checks.coveredSeasons).toEqual([2017, 2026]);
    expect(checks.writeScope).toEqual({ importSources: ['bbref:', 'wiki:', 'override:'], seasons: [2017, 2026] });
    expect(data.moves.length).toBeGreaterThan(0);
    expect(data.picks.some((p) => p.status === 'future')).toBe(true);
    expect(data.coachSeasons.map((c) => [c.seasonId, c.bbrefId])).toEqual([[2017, 'riverdo01c'], [2026, 'luety01c']]);
    expect(data.payrollSeasons.map((p) => [p.seasonId, p.listedPlayers, p.isPartial])).toEqual([[2017, 3, true], [2026, 3, true]]);
    expect(checks.contractDuplicates).toEqual(['Rui Hachimura (hachiru01)']);
    expect(checks.degraded.join('\n')).toMatch(/team_seasons is empty/);
    // Every person a written row points at has a person row.
    const keys = new Set(data.people.map((p) => p.personKey));
    for (const k of [...data.salaries.map((s) => s.personKey), ...data.coachSeasons.map((c) => c.bbrefId), ...data.contracts.map((c) => c.personKey)]) {
      expect(keys.has(k), k).toBe(true);
    }
  });

  it('--only narrows the tables and the write scope', () => {
    const salaries = build('salaries');
    expect(salaries.data.moves).toEqual([]);
    expect(salaries.data.picks).toEqual([]);
    expect(salaries.data.salaries.length).toBeGreaterThan(0);
    expect(salaries.data.unparsed).toEqual([]); // the move gate isn't this run's
    expect(salaries.checks.writeScope.importSources).toEqual(['bbref:']);

    const trades = build('trades');
    expect(trades.data.moves.every((m) => m.kind === 'trade')).toBe(true);
    expect(trades.checks.writeScope.seasons).toEqual([]); // never prunes the other moves

    const draft = build('draft');
    expect(draft.data.moves).toEqual([]);
    expect(draft.data.picks.length).toBeGreaterThan(0);
    expect(draft.checks.writeScope).toEqual({ importSources: [], seasons: [2017, 2026] });
    expect(build('honors').data.honors.length).toBeGreaterThan(0);
    expect(build('people').data.coachSeasons).toHaveLength(2);
  });
});
