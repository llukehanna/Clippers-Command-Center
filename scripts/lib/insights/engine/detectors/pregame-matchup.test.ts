import { describe, it, expect, vi } from 'vitest';

// The detector module imports the DB-backed query runner; only its SQL is read here.
vi.mock('../../../db', () => ({ sql: {} }));
const { LINE_PROOF_SQL, LINE_SQL, REST_SQL } = await import('./pregame-matchup');

describe('pregame matchup SQL', () => {
  it('rest never counts a preseason game (FW-9)', () => {
    expect(REST_SQL).toContain('JOIN all_games g');
    expect(REST_SQL).toContain('AND NOT g.is_preseason');
  });

  it('the line proof is bounded by the chosen snapshot, so a later snapshot cannot change it (FW-10)', () => {
    expect(LINE_SQL).not.toContain('$4');
    expect(LINE_PROOF_SQL).toContain('AND o.captured_at <= $4::timestamptz');
    // every bind is referenced and the selection is otherwise the same query
    for (const n of [1, 2, 3, 4]) expect(LINE_PROOF_SQL).toContain(`$${n}::`);
    expect(LINE_PROOF_SQL.replace('\n  AND o.captured_at <= $4::timestamptz', '')).toBe(LINE_SQL);
    expect(LINE_PROOF_SQL).toContain('o.captured_at::text AS captured_at');
  });
});
