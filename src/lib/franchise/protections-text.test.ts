import { describe, it, expect } from 'vitest';
import { protectionsLabel } from './protections-text';

describe('protectionsLabel', () => {
  it('says "Protections not recorded" when protections are unknown (null)', () => {
    expect(protectionsLabel({ protections_known: null, protections_text: null })).toBe('Protections not recorded');
  });

  it('says "Protections not recorded" when protections_known is false, even with text', () => {
    expect(protectionsLabel({ protections_known: false, protections_text: null })).toBe('Protections not recorded');
    expect(protectionsLabel({ protections_known: false, protections_text: 'Top-10 protected' })).toBe('Protections not recorded');
  });

  it('says "Unprotected" only when protections are known and there is no text', () => {
    expect(protectionsLabel({ protections_known: true, protections_text: null })).toBe('Unprotected');
    expect(protectionsLabel({ protections_known: true, protections_text: '  ' })).toBe('Unprotected');
  });

  it('uses the recorded text when protections are known', () => {
    expect(protectionsLabel({ protections_known: true, protections_text: 'Top-14 protected' })).toBe('Top-14 protected');
  });
});
