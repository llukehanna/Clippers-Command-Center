import { describe, it, expect } from 'vitest';
import { buildIcs, escapeText, foldLine, gameIcsEvent } from './ics';

const NOW = new Date('2026-11-17T12:00:00Z');

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma and newlines', () => {
    expect(escapeText('a,b;c\\d\ne')).toBe('a\\,b\\;c\\\\d\\ne');
  });
});

describe('foldLine', () => {
  it('leaves short lines alone and folds long ones at 75 octets', () => {
    expect(foldLine('SUMMARY:x')).toBe('SUMMARY:x');
    const folded = foldLine('a'.repeat(100));
    const parts = folded.split('\r\n');
    expect(parts[0]).toHaveLength(75);
    expect(parts[1]).toBe(' ' + 'a'.repeat(25));
  });
  it('never splits a multi-byte character', () => {
    const folded = foldLine('é'.repeat(50)); // 100 octets
    for (const part of folded.split('\r\n')) {
      expect(new TextEncoder().encode(part).length).toBeLessThanOrEqual(75);
    }
    expect(folded.replaceAll('\r\n ', '')).toBe('é'.repeat(50));
  });
});

describe('buildIcs', () => {
  it('writes a timed event with CRLF line endings', () => {
    const ics = buildIcs(
      [{ uid: 'ccc-1@x', start: '2026-11-18T03:30:00Z', date: '2026-11-17', durationMinutes: 150, summary: 'LAC vs UTA', location: 'Intuit Dome' }],
      'Clippers',
      NOW
    );
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART:20261118T033000Z\r\n');
    expect(ics).toContain('DTEND:20261118T060000Z\r\n');
    expect(ics).toContain('DTSTAMP:20261117T120000Z\r\n');
    expect(ics).toContain('LOCATION:Intuit Dome\r\n');
  });
  it('falls back to an all-day event when the tip time is unknown', () => {
    const ics = buildIcs([{ uid: 'u', start: null, date: '2026-12-31', durationMinutes: 150, summary: 's' }], 'c', NOW);
    expect(ics).toContain('DTSTART;VALUE=DATE:20261231\r\n');
    expect(ics).toContain('DTEND;VALUE=DATE:20270101\r\n');
  });
});

describe('gameIcsEvent', () => {
  const base = { game_id: '101', game_date: '2026-11-20', start_time_utc: '2026-11-21T01:00:00Z', lac_home: false, opponent_abbr: 'SAS', arena: 'Frost Bank Center', status: 'scheduled', lac_score: null, opp_score: null };
  it('links an upcoming game to its preview and lists broadcasts', () => {
    const e = gameIcsEvent({ ...base, broadcasts: ['KTLA', 'ClipperVision'] });
    expect(e.uid).toBe('ccc-101@clippers.lukeghanna.com');
    expect(e.summary).toBe('LAC @ SAS');
    expect(e.url).toBe('https://clippers.lukeghanna.com/schedule/101');
    expect(e.description).toBe('Watch: KTLA, ClipperVision\nhttps://clippers.lukeghanna.com/schedule/101');
  });
  it('puts the result in the summary of a final and links its postgame page', () => {
    const e = gameIcsEvent({ ...base, lac_home: true, status: 'final', lac_score: 113, opp_score: 105 });
    expect(e.summary).toBe('LAC vs SAS · W 113-105');
    expect(e.url).toBe('https://clippers.lukeghanna.com/history/101');
  });
});
