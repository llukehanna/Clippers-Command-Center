import { describe, it, expect } from 'vitest';
import { idBatches } from './id-batches.js';

describe('idBatches', () => {
  it('covers the range in inclusive batches', () => {
    expect(idBatches(1, 25, 10)).toEqual([[1, 10], [11, 20], [21, 25]]);
  });
  it('returns nothing for an empty range', () => {
    expect(idBatches(10, 9, 5)).toEqual([]);
  });
});
