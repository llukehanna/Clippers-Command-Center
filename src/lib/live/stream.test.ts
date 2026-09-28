import { describe, it, expect } from 'vitest';
import { hubSocketUrl, isFlapping, needsBackup, pickSource, reconnectDelay, streamGameId } from './stream';
import type { LivePayload } from '../ui/types';

const payload = (over: Partial<LivePayload>): LivePayload =>
  ({ meta: {}, state: 'LIVE', game: null, key_metrics: [], box_score: null, insights: [], other_games: [], odds: null, ...over } as LivePayload);
const game = (status: string) => ({ game_id: '9', nba_game_id: '22600093', status } as NonNullable<LivePayload['game']>);

describe('stream helpers', () => {
  it('backs off 1 → 2 → 4 → 8 → 16 → 30 s and stays at 30 s', () => {
    expect([0, 1, 2, 3, 4, 5, 9].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });

  it('flags 3 drops within 60 s as flapping', () => {
    expect(isFlapping([0, 10_000, 20_000], 30_000)).toBe(true);
    expect(isFlapping([0, 10_000, 20_000], 70_000)).toBe(false);
    expect(isFlapping([50_000, 55_000], 60_000)).toBe(false);
  });

  it('builds the socket URL with the canonical numeric game id', () => {
    expect(hubSocketUrl('wss://live.lukeghanna.com/', '0022600093')).toBe('wss://live.lukeghanna.com/ws/22600093');
  });

  it('streams the live game, or the upcoming one before tip', () => {
    expect(streamGameId(payload({ game: game('in_progress') }))).toBe('22600093');
    expect(streamGameId(payload({ state: 'NO_ACTIVE_GAME', upcoming: { nba_game_id: '0022600093' } }))).toBe('0022600093');
    expect(streamGameId(payload({ state: 'NO_ACTIVE_GAME' }))).toBeNull();
    expect(streamGameId(undefined)).toBeNull();
  });

  it('picks the source: backup, then fresh push, then poll; idle with no game', () => {
    const live = payload({ game: game('in_progress') });
    expect(pickSource({ base: live, lastPushAt: 100_000, now: 110_000, backup: true })).toBe('backup');
    expect(pickSource({ base: live, lastPushAt: 100_000, now: 110_000, backup: false })).toBe('push');
    expect(pickSource({ base: live, lastPushAt: 100_000, now: 140_000, backup: false })).toBe('poll');
    expect(pickSource({ base: payload({ state: 'NO_ACTIVE_GAME' }), lastPushAt: null, now: 0, backup: false })).toBe('idle');
  });

  it('wants the ESPN backup only when the feed is delayed, push is not fresh, and the game is live', () => {
    const delayed = payload({ state: 'DATA_DELAYED', game: game('in_progress') });
    expect(needsBackup(delayed, false)).toBe(true);
    expect(needsBackup(delayed, true)).toBe(false);
    expect(needsBackup(payload({ state: 'LIVE', game: game('in_progress') }), false)).toBe(false);
    expect(needsBackup(payload({ state: 'DATA_DELAYED', game: game('final') }), false)).toBe(false);
  });
});
