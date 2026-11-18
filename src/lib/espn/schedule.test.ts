import { describe, it, expect } from 'vitest';
import { etDate, findScheduledGame, parseEspnSchedule, toBroadcasts } from './schedule';

const event = (date: string, home: string, away: string, broadcasts: unknown[]) => ({
  id: '401910006',
  date,
  competitions: [{
    competitors: [
      { homeAway: 'home', team: { abbreviation: home } },
      { homeAway: 'away', team: { abbreviation: away } },
    ],
    broadcasts,
  }],
});
const b = (market: string, type: string, name: string) => ({ market: { type: market }, type: { shortName: type }, media: { shortName: name } });

describe('etDate', () => {
  it('converts a UTC tip to the US Eastern calendar date', () => {
    expect(etDate('2026-11-18T03:30Z')).toBe('2026-11-17');
    expect(etDate('2026-11-20T01:00Z')).toBe('2026-11-19');
  });
  it('returns an empty string for an unreadable date', () => {
    expect(etDate('nope')).toBe('');
  });
});

describe('toBroadcasts', () => {
  it('groups national, Clippers and opponent outlets and drops League Pass', () => {
    const out = toBroadcasts([
      b('Home', 'Streaming', 'ClipperVision'),
      b('Home', 'TV', 'KJZZ-TV'),
      b('Away', 'Streaming', 'ClipperVision'),
      b('National', 'TV', 'ESPN'),
      b('Away', 'Subscription Package', 'NBA League Pass'),
      b('Home', 'TV', 'KTLA'),
    ]);
    expect(out).toEqual([
      { name: 'ESPN', kind: 'tv', group: 'national' },
      { name: 'KTLA', kind: 'tv', group: 'clippers' },
      { name: 'ClipperVision', kind: 'streaming', group: 'clippers' },
      { name: 'KJZZ-TV', kind: 'tv', group: 'opponent' },
    ]);
  });
});

describe('parseEspnSchedule', () => {
  it('maps ESPN abbreviations to NBA tricodes and finds the game by ET date and opponent', () => {
    const games = parseEspnSchedule({
      events: [
        event('2026-11-18T03:30Z', 'LAC', 'UTAH', [b('Home', 'TV', 'KTLA')]),
        event('2026-11-21T01:00Z', 'SA', 'LAC', []),
      ],
    });
    expect(games).toHaveLength(2);
    expect(games[0]).toMatchObject({ etDate: '2026-11-17', opponent: 'UTA', lacHome: true });
    expect(games[1]).toMatchObject({ etDate: '2026-11-20', opponent: 'SAS', lacHome: false });
    expect(findScheduledGame(games, '2026-11-20', 'SAS')?.lacHome).toBe(false);
    expect(findScheduledGame(games, '2026-11-20', 'UTA')).toBeNull();
  });
  it('tolerates junk', () => {
    expect(parseEspnSchedule(null)).toEqual([]);
    expect(parseEspnSchedule({ events: [{}] })).toEqual([]);
  });
});
