import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BarRow } from '../insights/quality';

const unsafe = vi.fn();
vi.mock('@/src/lib/db', () => ({ sql: { unsafe: (...a: unknown[]) => unsafe(...a) }, LAC_NBA_TEAM_ID: 13 }));

import { INSIGHT_ROW_COLUMNS, barFilter, loadQualityContext } from './insight-quality';

function row(id: string, frame: unknown): BarRow {
  return {
    insight_id: id, surface: 'postgame', category: 'x', player_id: '7', game_id: 'g1', season_id: 2025,
    game_date: '2026-01-10', detail: null, frame: frame as BarRow['frame'], evidence: null,
    proof_result: [{ part: 'fact', data: { game_date: '2026-01-10' } }],
  };
}
const since = (id: string) => row(id, { type: 'first_since', who: 'subject', since_date: '2024-01-01', text: 't', strength: 1 });
const careerHigh = row('n', { type: 'career_high', who: 'subject', text: 't', strength: 1 });
const none = row('m', { type: 'none', text: '', strength: 0 });

beforeEach(() => unsafe.mockReset());

describe('loadQualityContext / barFilter', () => {
  it('no query when nothing needs context', async () => {
    await loadQualityContext([careerHigh, none]);
    expect(unsafe).not.toHaveBeenCalled();
  });

  it('one query for all rows that need context', async () => {
    unsafe.mockResolvedValue([{ insight_id: 'a', games_since: 50, team_game_number: null }]);
    const res = await barFilter([since('a'), since('b'), since('c')]);
    expect(unsafe).toHaveBeenCalledTimes(1);
    const params = unsafe.mock.calls[0][1] as unknown[];
    expect(params).toHaveLength(7);
    expect(params[6]).toBe(13);
    expect(res.cards.map((r) => r.insight_id)).toEqual(['a']);
  });

  it('query failure: cuts rows needing context, keeps others, resolves', async () => {
    unsafe.mockRejectedValueOnce(new Error('boom'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await barFilter([since('a'), careerHigh]);
    expect(res.cards.map((r) => r.insight_id)).toEqual(['n']);
    expect(err).toHaveBeenCalledWith('[insights] quality context failed', expect.any(Error));
    err.mockRestore();
  });
});

describe('INSIGHT_ROW_COLUMNS', () => {
  it('casts every column', () => {
    const items = INSIGHT_ROW_COLUMNS.split(/,\s*(?=\(|\w+[.(])/).map((s) => s.trim());
    expect(items.length).toBe(23);
    for (const it of items) expect(it).toMatch(/::\w+(\[\])? AS \w+$|^to_char\(/);
  });
});
