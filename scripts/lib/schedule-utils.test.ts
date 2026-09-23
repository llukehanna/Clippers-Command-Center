import { describe, it, expect } from 'vitest';
import {
  seasonLabel,
  currentSeasonId,
  seasonIdFromSeasonYear,
  isNbaFormatGameId,
  toNbaGameId10,
  isPlayoffNbaGameId,
  normalizeGameStatus,
  easternDateOf,
} from './schedule-utils';

describe('seasons', () => {
  it('labels a season from its start year', () => {
    expect(seasonLabel(2026)).toBe('2026-27');
    expect(seasonLabel(2099)).toBe('2099-00');
  });

  it('rolls the season over on July 1', () => {
    expect(currentSeasonId(new Date('2026-06-30T12:00:00Z'))).toBe(2025);
    expect(currentSeasonId(new Date('2026-07-01T12:00:00Z'))).toBe(2026);
    expect(currentSeasonId(new Date('2027-01-15T12:00:00Z'))).toBe(2026);
  });

  it('parses CDN seasonYear', () => {
    expect(seasonIdFromSeasonYear('2026-27')).toBe(2026);
    expect(seasonIdFromSeasonYear(' 2025-26 ')).toBe(2025);
    expect(seasonIdFromSeasonYear('2026')).toBeNull();
    expect(seasonIdFromSeasonYear(undefined)).toBeNull();
  });
});

describe('game ids', () => {
  it('accepts NBA-format ids with or without leading zeros', () => {
    expect(isNbaFormatGameId('0022601199')).toBe(true);
    expect(isNbaFormatGameId(22601199)).toBe(true);
    expect(isNbaFormatGameId('0042500401')).toBe(true);
  });

  it('rejects balldontlie ids and preseason ids', () => {
    expect(isNbaFormatGameId(18448017)).toBe(false); // bdl
    expect(isNbaFormatGameId('0012600001')).toBe(false); // preseason
    expect(isNbaFormatGameId('abc')).toBe(false);
    expect(isNbaFormatGameId(null)).toBe(false);
  });

  it('checks the season digits when a season is given', () => {
    expect(isNbaFormatGameId('0022601199', 2026)).toBe(true);
    expect(isNbaFormatGameId('0022501199', 2026)).toBe(false);
  });

  it('pads to the 10-char CDN form', () => {
    expect(toNbaGameId10(22501199)).toBe('0022501199');
    expect(toNbaGameId10('0022501199', 2025)).toBe('0022501199');
    expect(toNbaGameId10(18448017)).toBeNull();
  });

  it('detects playoff ids', () => {
    expect(isPlayoffNbaGameId('0042500401')).toBe(true);
    expect(isPlayoffNbaGameId('0022500401')).toBe(false);
  });
});

describe('normalizeGameStatus', () => {
  it('lowercases and canonicalizes', () => {
    expect(normalizeGameStatus('Final')).toBe('final');
    expect(normalizeGameStatus('Final/OT')).toBe('final');
    expect(normalizeGameStatus('IN_PROGRESS')).toBe('in_progress');
    expect(normalizeGameStatus('')).toBe('scheduled');
    expect(normalizeGameStatus(null)).toBe('scheduled');
    expect(normalizeGameStatus('In Progress')).toBe('in_progress');
  });
});

describe('easternDateOf', () => {
  it('converts a late-evening Pacific tipoff to its Eastern date', () => {
    // 7:30pm PT on Oct 21 = 02:30Z Oct 22 = 10:30pm ET Oct 21
    expect(easternDateOf('2026-10-22T02:30:00Z')).toBe('2026-10-21');
  });

  it('returns null for invalid input', () => {
    expect(easternDateOf('not a date')).toBeNull();
  });
});
