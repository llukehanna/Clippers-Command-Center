import { describe, it, expect } from 'vitest';
// These imports will be RED until Plan 02 creates proof-utils.ts
import { makeProofHash, guardProofResult } from '../proof-utils.js';

describe('makeProofHash', () => {
  it('returns a 64-char hex SHA-256 string', () => {
    const hash = makeProofHash('SELECT 1', { id: 1 }, [{ count: 5 }]);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    const sql = 'SELECT * FROM games WHERE team_id = $1';
    const params = { team_id: 7 };
    const result = [{ game_id: 100, score: 112 }];
    const hash1 = makeProofHash(sql, params, result);
    const hash2 = makeProofHash(sql, params, result);
    expect(hash1).toBe(hash2);
  });

  it('produces different hashes for different inputs', () => {
    const base = makeProofHash('SELECT 1', {}, [{ a: 1 }]);
    const different = makeProofHash('SELECT 2', {}, [{ a: 1 }]);
    expect(base).not.toBe(different);
  });

  it('handles null fields (treats null as empty string)', () => {
    // Should not throw; null fields are coerced to empty string in the join
    const hashWithNull = makeProofHash('SELECT 1', null, null);
    expect(hashWithNull).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('guardProofResult', () => {
  it('returns false for empty array', () => {
    expect(guardProofResult([])).toBe(false);
  });

  it('returns true for non-empty array', () => {
    expect(guardProofResult([{ row: 1 }])).toBe(true);
  });
});
