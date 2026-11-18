import { describe, expect, it } from 'vitest';
import { parseProtections } from './protections.js';

describe('parseProtections', () => {
  it('reads "top-N protected" as one range in the pick\'s own year', () => {
    expect(parseProtections('top-14 protected')).toEqual({ protections: [{ year: 0, range: '1-14', then: null }], text: 'Top-14 protected' });
    expect(parseProtections('Top 3 protected')).toEqual({ protections: [{ year: 0, range: '1-3', then: null }], text: 'Top-3 protected' });
  });

  it('reads "N–M protected"', () => {
    expect(parseProtections('1–10 protected')).toEqual({ protections: [{ year: 0, range: '1-10', then: null }], text: '1–10 protected' });
    expect(parseProtections('11-30 protected')).toEqual({ protections: [{ year: 0, range: '11-30', then: null }], text: '11–30 protected' });
  });

  it('reads "unprotected" as no protections', () => {
    expect(parseProtections('unprotected')!.protections).toEqual([]);
    expect(parseProtections('Unprotected')).toEqual({ protections: [], text: 'Unprotected' });
  });

  it('reads a protection that changes by year', () => {
    expect(parseProtections('top-10 protected in 2019, top-8 protected in 2020')).toEqual({
      protections: [
        { year: 2019, range: '1-10', then: null },
        { year: 2020, range: '1-8', then: null },
      ],
      text: 'Top-10 protected in 2019, top-8 protected in 2020',
    });
  });

  it('returns null for anything else', () => {
    expect(parseProtections('protected unless it falls between 11 and 30, in which case…')).toBeNull();
    expect(parseProtections('top-14 protected; if not conveyed, becomes two second-round picks')).toBeNull();
    expect(parseProtections('protected')).toBeNull();
    expect(parseProtections('lottery protected')).toBeNull();
    expect(parseProtections('top-0 protected')).toBeNull();
    expect(parseProtections('20–10 protected')).toBeNull();
    expect(parseProtections('top-10 protected in 2020, top-8 protected in 2019')).toBeNull();
    expect(parseProtections('')).toBeNull();
  });
});
