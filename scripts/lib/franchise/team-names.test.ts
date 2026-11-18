import { describe, expect, it } from 'vitest';
import { ALIASES, franchiseFromName } from './team-names.js';

describe('franchiseFromName', () => {
  it('resolves era-correct names', () => {
    expect(franchiseFromName('the Charlotte Bobcats', 2004)).toBe(1610612766);
    expect(franchiseFromName('Seattle SuperSonics', 1975)).toBe(1610612760);
    expect(franchiseFromName('the Buffalo Braves', 1972)).toBe(1610612746);
  });
  it('resolves city alone and nickname alone', () => {
    expect(franchiseFromName('Seattle', 1990)).toBe(1610612760);
    expect(franchiseFromName('Clippers', 2010)).toBe(1610612746);
  });
  it('returns null when unknown, wrong era, or ambiguous', () => {
    expect(franchiseFromName('Atlantis Fish', 2000)).toBeNull();
    expect(franchiseFromName('Seattle SuperSonics', 2015)).toBeNull();
    expect(franchiseFromName('Los Angeles', 2000)).toBeNull();
    expect(franchiseFromName('New Orleans', 1976)).toBe(1610612762);
  });
  it('handles aliases', () => {
    expect(ALIASES.length).toBeGreaterThan(0);
    expect(franchiseFromName('New Orleans/Oklahoma City Hornets', 2005)).toBe(1610612740);
    expect(franchiseFromName('the New Orleans/Oklahoma City Hornets', 2006)).toBe(1610612740);
  });
  it('resolves "LA Clippers" from 1984 on only', () => {
    expect(franchiseFromName('LA Clippers', 2019)).toBe(1610612746);
    expect(franchiseFromName('LA Clippers', 1984)).toBe(1610612746);
    expect(franchiseFromName('LA Clippers', 1983)).toBeNull();
  });
});
