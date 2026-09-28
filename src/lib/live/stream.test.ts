import { describe, it, expect } from 'vitest';
import {
  PING_EVERY_MS,
  hubSocketUrl,
  isFlapping,
  isPushFresh,
  needsBackup,
  pickSource,
  pushIsCurrent,
  reconnectDelay,
  socketIsSilent,
  streamGameId,
} from './stream';
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
    // Canonical (numeric) form, so the id doesn't change format at tip.
    expect(streamGameId(payload({ state: 'NO_ACTIVE_GAME', upcoming: { nba_game_id: '0022600093' } }))).toBe('22600093');
    expect(streamGameId(payload({ game: { ...game('in_progress'), nba_game_id: '0022600093' } }))).toBe('22600093');
    expect(streamGameId(payload({ game: { ...game('in_progress'), nba_game_id: null } }))).toBeNull();
    expect(streamGameId(payload({ state: 'NO_ACTIVE_GAME', upcoming: { nba_game_id: 'bogus' } }))).toBeNull();
    expect(streamGameId(payload({ state: 'NO_ACTIVE_GAME' }))).toBeNull();
    expect(streamGameId(undefined)).toBeNull();
  });

  it('judges push freshness by when the runner built the doc (30 s + 15 s clock-skew tolerance), not when it arrived', () => {
    const at = Date.parse('2026-10-21T03:00:00.000Z');
    const doc = { fetched_at: '2026-10-21T03:00:00.000Z' };
    expect(isPushFresh(doc, at + 10_000)).toBe(true);
    expect(isPushFresh(doc, at + 44_999)).toBe(true);
    expect(isPushFresh(doc, at + 45_000)).toBe(false);
    // A replayed message from 150 s ago is not fresh even though it just arrived.
    expect(isPushFresh(doc, at + 150_000)).toBe(false);
    expect(isPushFresh(null, at)).toBe(false);
    expect(isPushFresh({ fetched_at: 'garbage' }, at)).toBe(false);
  });

  it('overlays push only when it is at least as new as the polled snapshot', () => {
    const doc = { fetched_at: '2026-10-21T03:00:10.000Z' };
    expect(pushIsCurrent(doc, payload({ snapshot_captured_at: '2026-10-21T03:00:05.000Z' }))).toBe(true);
    expect(pushIsCurrent(doc, payload({ snapshot_captured_at: '2026-10-21T03:00:10.000Z' }))).toBe(true);
    expect(pushIsCurrent(doc, payload({ snapshot_captured_at: '2026-10-21T03:00:20.000Z' }))).toBe(false);
    expect(pushIsCurrent(doc, payload({}))).toBe(true);
    expect(pushIsCurrent({ fetched_at: 'garbage' }, payload({ snapshot_captured_at: '2026-10-21T03:00:05.000Z' }))).toBe(false);
  });

  it('while the server reports DATA_DELAYED, overlays push only when it is strictly newer than the stale snapshot', () => {
    const doc = { fetched_at: '2026-10-21T03:00:10.000Z' };
    const delayed = (at: string) => payload({ state: 'DATA_DELAYED', snapshot_captured_at: at });
    // The same doc the server already calls stale (e.g. replayed by the hub) is not live.
    expect(pushIsCurrent(doc, delayed('2026-10-21T03:00:10.000Z'))).toBe(false);
    expect(pushIsCurrent(doc, delayed('2026-10-21T03:00:20.000Z'))).toBe(false);
    // The runner came back: its new doc beats the stale snapshot.
    expect(pushIsCurrent(doc, delayed('2026-10-21T03:00:05.000Z'))).toBe(true);
    // Not delayed: equal timestamps still overlay (the >= rule).
    expect(pushIsCurrent(doc, payload({ state: 'LIVE', snapshot_captured_at: '2026-10-21T03:00:10.000Z' }))).toBe(true);
  });

  it('picks the source: idle with no live game, then backup, then fresh push, then poll', () => {
    const at = Date.parse('2026-10-21T03:00:00.000Z');
    const fetched = '2026-10-21T03:00:00.000Z';
    const live = payload({ game: game('in_progress') });
    expect(pickSource({ shown: live, pushFetchedAt: fetched, now: at + 10_000, backup: true })).toBe('backup');
    expect(pickSource({ shown: live, pushFetchedAt: fetched, now: at + 10_000, backup: false })).toBe('push');
    expect(pickSource({ shown: live, pushFetchedAt: fetched, now: at + 60_000, backup: false })).toBe('poll');
    expect(pickSource({ shown: live, pushFetchedAt: null, now: at, backup: false })).toBe('poll');
    expect(pickSource({ shown: payload({ state: 'NO_ACTIVE_GAME' }), pushFetchedAt: fetched, now: at, backup: false })).toBe('idle');
    expect(pickSource({ shown: undefined, pushFetchedAt: null, now: at, backup: false })).toBe('idle');
    // The buzzer has gone: nothing is streaming any more.
    expect(pickSource({ shown: payload({ game: game('final') }), pushFetchedAt: fetched, now: at, backup: false })).toBe('idle');
  });

  it('treats a socket as dead after two ping intervals with no message or pong', () => {
    const heard = 1_000_000;
    expect(socketIsSilent(heard, heard + 2 * PING_EVERY_MS - 1)).toBe(false);
    expect(socketIsSilent(heard, heard + 2 * PING_EVERY_MS)).toBe(true);
  });

  it('wants the ESPN backup only when the feed is delayed, push is not fresh, and the game is live', () => {
    const delayed = payload({ state: 'DATA_DELAYED', game: game('in_progress') });
    expect(needsBackup(delayed, false)).toBe(true);
    expect(needsBackup(delayed, true)).toBe(false);
    expect(needsBackup(payload({ state: 'LIVE', game: game('in_progress') }), false)).toBe(false);
    expect(needsBackup(payload({ state: 'DATA_DELAYED', game: game('final') }), false)).toBe(false);
  });
});
