// The quality bar over the 88 rows of the Nov 19, 2026 production audit.
import { describe, expect, it } from 'vitest';
import { mergeSameGamePlayer } from './compose';
import { normalizeRow, verdict, type BarRow, type QualityContext, type Verdict } from './quality';
import audit from './__fixtures__/audit-2026-11-19.json';

type Row = BarRow & { importance: number; headline: string; context: QualityContext; expected: Verdict };
const rows = audit as unknown as Row[];

describe('quality bar over the Nov 19 production sample', () => {
  it('every audited row gets the audit\'s verdict', () => {
    expect(rows).toHaveLength(88);
    for (const row of rows) {
      expect(verdict(row, row.context), row.headline).toBe(row.expected);
    }
  });

  it('totals match the audit', () => {
    const count = (v: Verdict) => rows.filter((r) => verdict(r, r.context) === v).length;
    expect({ card: count('card'), tag: count('tag'), note: count('note'), merge: count('merge'), cut: count('cut') })
      .toEqual({ card: 22, tag: 10, note: 3, merge: 3, cut: 50 });
  });

  it('postgame: 8 of 62 survive as cards after Q4', () => {
    const post = rows.filter((r) => r.surface === 'postgame');
    expect(post).toHaveLength(62);
    const cards = post
      .filter((r) => verdict(r, r.context) === 'card')
      .map((r) => ({ ...r, surface: 'postgame' as const, score_parts: null }));
    expect(cards).toHaveLength(9);
    const merged = mergeSameGamePlayer(cards);
    expect(merged).toHaveLength(8);
    expect(merged.filter((m) => m.merged_ids.length === 1)).toHaveLength(1);
  });

  it('Q7 rewrites the fragile career best', () => {
    const fragile = rows.filter((r) => r.detail === 'A career-best season');
    expect(fragile).toHaveLength(2);
    for (const r of fragile) {
      const n = normalizeRow(r);
      expect(n.frame?.type).toBe('none');
      expect(n.detail).toBe('Through 11 games');
    }
  });
});
