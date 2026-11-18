import { describe, it, expect } from 'vitest';
import { addDays } from './dates';
import { applyRosterSnapshot, parseRosterSnapshot, snapshotProblem, snapshotUsable, type RosterSnapshot } from './roster';
import type { RosterPlayer } from './types';

const ASOF = '2026-12-10';
const snap = (syncedDate: string, ids: string[]): RosterSnapshot => ({ syncedDate, playerIds: new Set(ids) });
const player = (id: string): RosterPlayer => ({ playerId: id, name: `P${id}`, games: 20, mpg: 25 });
const box = () => new Map([['1', player('1')], ['2', player('2')], ['3', player('3')]]);

describe('snapshotUsable', () => {
  it('rejects a missing snapshot', () => expect(snapshotUsable(null, ASOF)).toBe(false));
  it('accepts sync dates from asOf-3 through asOf+1', () => {
    expect(snapshotUsable(snap(ASOF, []), ASOF)).toBe(true);
    expect(snapshotUsable(snap(addDays(ASOF, -3), []), ASOF)).toBe(true);
    expect(snapshotUsable(snap(addDays(ASOF, 1), []), ASOF)).toBe(true);
  });
  it('rejects stale (asOf-4) and future (asOf+2) snapshots', () => {
    expect(snapshotUsable(snap(addDays(ASOF, -4), []), ASOF)).toBe(false);
    expect(snapshotUsable(snap(addDays(ASOF, 2), []), ASOF)).toBe(false);
  });
});

describe('applyRosterSnapshot', () => {
  it('returns the same Map when the league is complete', () => {
    const r = box();
    expect(applyRosterSnapshot(r, snap(ASOF, ['1']), ASOF, true)).toBe(r);
  });
  it('returns the same Map when the snapshot is unusable', () => {
    const r = box();
    expect(applyRosterSnapshot(r, null, ASOF, false)).toBe(r);
    expect(applyRosterSnapshot(r, snap(addDays(ASOF, -4), ['1']), ASOF, false)).toBe(r);
  });
  it('keeps only intersecting players when incomplete with a usable snapshot', () => {
    const r = box();
    const out = applyRosterSnapshot(r, snap(ASOF, ['1', '3']), ASOF, false);
    expect(out).not.toBe(r);
    expect([...out.keys()].sort()).toEqual(['1', '3']);
    expect(out.get('1')).toBe(r.get('1'));
  });
  it('never adds a snapshot player missing from the box-score roster', () => {
    const out = applyRosterSnapshot(box(), snap(ASOF, ['1', '99']), ASOF, false);
    expect([...out.keys()]).toEqual(['1']);
  });
});

describe('parseRosterSnapshot', () => {
  const valid = { team: 'LAC', source: 'espn', synced_at: '2026-12-10T08:30:00.000Z', players: [{ player_id: '1', name: 'A' }, { player_id: '2', name: 'B' }] };
  it('parses the production shape with the LA sync date', () => {
    const s = parseRosterSnapshot(valid)!;
    expect(s.syncedDate).toBe('2026-12-10');
    expect([...s.playerIds]).toEqual(['1', '2']);
    // 03:00Z is the previous evening in Los Angeles
    expect(parseRosterSnapshot({ ...valid, synced_at: '2026-12-10T03:00:00Z' })!.syncedDate).toBe('2026-12-09');
  });
  it('decodes a JSON-string value', () => {
    expect(parseRosterSnapshot(JSON.stringify(valid))!.syncedDate).toBe('2026-12-10');
    expect(parseRosterSnapshot('not json')).toBeNull();
  });
  it('returns null for unusable values', () => {
    expect(parseRosterSnapshot(null)).toBeNull();
    expect(parseRosterSnapshot({ ...valid, synced_at: undefined })).toBeNull();
    expect(parseRosterSnapshot({ ...valid, synced_at: 'garbage' })).toBeNull();
    expect(parseRosterSnapshot({ ...valid, players: 'x' })).toBeNull();
    expect(parseRosterSnapshot({ ...valid, players: [{ player_id: 1 }] })).toBeNull();
    expect(parseRosterSnapshot({ ...valid, players: [] })).toBeNull();
  });
});

describe('snapshotProblem', () => {
  it('names missing, stale and future snapshots; null when usable', () => {
    expect(snapshotProblem(null, ASOF)).toMatch(/missing/);
    expect(snapshotProblem(snap(addDays(ASOF, -4), ['1']), ASOF)).toBe('stale (synced 2026-12-06)');
    expect(snapshotProblem(snap(addDays(ASOF, 2), ['1']), ASOF)).toMatch(/future/);
    expect(snapshotProblem(snap(ASOF, ['1']), ASOF)).toBeNull();
  });
});
