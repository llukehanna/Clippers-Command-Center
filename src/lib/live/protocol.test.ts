import { describe, it, expect } from 'vitest';
import type { BoxscorePlayer, BoxscoreTeam } from '../types/live';
import type { FlowMarker, FlowPoint } from '../types/live-state';
import { applyMessage, diffDocs, type KeyframeMessage } from './protocol';
import { box, liveDoc } from '../../../scripts/lib/live-fixtures';

function player(personId: number, points: number): BoxscorePlayer {
  return {
    status: 'ACTIVE', order: 1, personId, jerseyNum: '1', name: `P${personId}`, nameI: `P${personId}`,
    position: 'G', starter: '1', oncourt: '1', played: '1',
    statistics: {
      assists: 0, blocks: 0, fieldGoalsAttempted: 0, fieldGoalsMade: 0, fieldGoalsPercentage: 0, foulsPersonal: 0,
      freeThrowsAttempted: 0, freeThrowsMade: 0, freeThrowsPercentage: 0, minutes: 'PT10M00.00S',
      minutesCalculated: 'PT10M', plus: 0, minus: 0, plusMinusPoints: 0, points, reboundsDefensive: 0,
      reboundsOffensive: 0, reboundsTotal: 0, steals: 0, threePointersAttempted: 0, threePointersMade: 0,
      threePointersPercentage: 0, turnovers: 0,
    },
  };
}
const team = (side: 'homeTeam' | 'awayTeam', players: BoxscorePlayer[], score: number): BoxscoreTeam =>
  ({ ...box({ home: score, away: score })[side], score, players });

describe('diffDocs + applyMessage', () => {
  const prev = liveDoc(1, { home_box: team('homeTeam', [player(1, 2), player(2, 0)], 2), away_box: team('awayTeam', [player(9, 0)], 0) });

  it('round-trips: applying the delta to prev yields next, sending only what changed', () => {
    const next = liveDoc(2, {
      home_score: 4, clock: '9:40',
      home_box: team('homeTeam', [player(1, 4), player(2, 0)], 4), away_box: prev.away_box,
    });
    const delta = diffDocs(prev, next);
    expect(delta).toMatchObject({ kind: 'delta', seq: 2, base_seq: 1 });
    expect(delta.patch).toMatchObject({ home_score: 4, clock: '9:40' });
    expect(delta.patch).not.toHaveProperty('away_score');
    expect(delta.box?.home?.players.map((p) => p.personId)).toEqual([1]);
    expect(delta.box).not.toHaveProperty('away');
    expect(applyMessage(prev, delta)).toEqual({ state: next, applied: true, needKeyframe: false });
  });

  it('appends new players, and replaces the list when a player disappears', () => {
    const added = liveDoc(2, { home_box: team('homeTeam', [player(1, 2), player(2, 0), player(3, 0)], 2), away_box: prev.away_box });
    const d1 = diffDocs(prev, added);
    expect(d1.box?.home?.players.map((p) => p.personId)).toEqual([3]);
    expect(d1.box?.home?.replace).toBeUndefined();
    expect(applyMessage(prev, d1).state).toEqual(added);

    const removed = liveDoc(2, { home_box: team('homeTeam', [player(1, 2)], 2), away_box: prev.away_box });
    const d2 = diffDocs(prev, removed);
    expect(d2.box?.home?.replace).toBe(true);
    expect(applyMessage(prev, d2).state).toEqual(removed);
  });

  it('sends null when a box disappears', () => {
    const next = liveDoc(2, { home_box: null, away_box: prev.away_box });
    const delta = diffDocs(prev, next);
    expect(delta.box?.home).toBeNull();
    expect(applyMessage(prev, delta).state?.home_box).toBeNull();
  });

  it('needs a keyframe before any delta, and on a base mismatch', () => {
    const delta = diffDocs(prev, liveDoc(2, { home_box: prev.home_box, away_box: prev.away_box }));
    expect(applyMessage(null, delta)).toEqual({ state: null, applied: false, needKeyframe: true });
    const other = liveDoc(0); // behind the delta's seq, but not its base
    expect(applyMessage(other, delta)).toEqual({ state: other, applied: false, needKeyframe: true });
  });

  it('ignores replayed deltas it already has', () => {
    const at3 = liveDoc(3);
    const old = diffDocs(liveDoc(1), liveDoc(2));
    expect(applyMessage(at3, old)).toEqual({ state: at3, applied: false, needKeyframe: false });
  });

  it('takes a newer keyframe; ignores an older one unless it is fresher (runner restart)', () => {
    const current = liveDoc(10, { fetched_at: '2026-10-22T03:00:00.000Z' });
    const newer: KeyframeMessage = { kind: 'keyframe', seq: 11, doc: liveDoc(11) };
    expect(applyMessage(current, newer)).toEqual({ state: newer.doc, applied: true, needKeyframe: false });
    const replayed: KeyframeMessage = { kind: 'keyframe', seq: 4, doc: liveDoc(4, { fetched_at: '2026-10-22T02:58:00.000Z' }) };
    expect(applyMessage(current, replayed)).toEqual({ state: current, applied: false, needKeyframe: false });
    const restarted: KeyframeMessage = { kind: 'keyframe', seq: 3, doc: liveDoc(3, { fetched_at: '2026-10-22T03:00:05.000Z' }) };
    expect(applyMessage(current, restarted).state).toBe(restarted.doc);
  });

  it('detects reordered players (same ids, different order) and sends full replacement', () => {
    const next = liveDoc(2, { home_box: team('homeTeam', [player(2, 0), player(1, 2)], 2), away_box: prev.away_box });
    const delta = diffDocs(prev, next);
    expect(delta.box?.home?.replace).toBe(true);
    expect(delta.box?.home?.players.map((p) => p.personId)).toEqual([2, 1]);
    const applied = applyMessage(prev, delta);
    expect(applied.state).toEqual(next);
    expect(applied.state?.home_box?.players.map((p) => p.personId)).toEqual([2, 1]);
  });

  it('detects new player inserted in the middle (not at end) and sends full replacement', () => {
    const next = liveDoc(2, { home_box: team('homeTeam', [player(1, 2), player(3, 0), player(2, 0)], 2), away_box: prev.away_box });
    const delta = diffDocs(prev, next);
    expect(delta.box?.home?.replace).toBe(true);
    expect(delta.box?.home?.players.map((p) => p.personId)).toEqual([1, 3, 2]);
    const applied = applyMessage(prev, delta);
    expect(applied.state).toEqual(next);
    expect(applied.state?.home_box?.players.map((p) => p.personId)).toEqual([1, 3, 2]);
  });
});

const P = (t: number, m: number): FlowPoint => ({ t, m, wp: 0.5, a: t, d: `play ${t}` });
const RUN: FlowMarker = { kind: 'run', t: 90, t_start: 30, side: 'lac', pts: 8 };

describe('flow deltas', () => {
  it('send only the new points, and rebuild the same state', () => {
    const prev = liveDoc(1, { flow: { points: [P(0, 0), P(30, 2)], markers: [] } });
    const next = liveDoc(2, { flow: { points: [P(0, 0), P(30, 2), P(90, 8)], markers: [RUN] } });
    const d = diffDocs(prev, next);
    expect(d.patch.flow).toBeUndefined();
    expect(d.flow_append).toEqual({ from: 2, points: [P(90, 8)], markers: [RUN] });
    expect(applyMessage(prev, d).state).toEqual(next);
  });

  it('send the whole series when an earlier point changed', () => {
    const prev = liveDoc(1, { flow: { points: [P(0, 0), P(30, 2)], markers: [] } });
    const next = liveDoc(2, { flow: { points: [P(0, 0), P(30, 3)], markers: [] } });
    const d = diffDocs(prev, next);
    expect(d.flow_append).toBeUndefined();
    expect(d.patch.flow).toEqual(next.flow);
    expect(applyMessage(prev, d).state).toEqual(next);
  });

  it('carry nothing when the flow did not change', () => {
    const flow = { points: [P(0, 0)], markers: [] };
    const d = diffDocs(liveDoc(1, { flow }), liveDoc(2, { flow, clock: '9:59' }));
    expect(d.flow_append).toBeUndefined();
    expect(d.patch.flow).toBeUndefined();
  });

  it('ask for a keyframe when an append does not line up', () => {
    const state = liveDoc(1, { flow: { points: [P(0, 0)], markers: [] } });
    const r = applyMessage(state, {
      kind: 'delta', seq: 2, base_seq: 1, patch: {}, flow_append: { from: 2, points: [P(90, 8)], markers: [] },
    });
    expect(r).toEqual({ state, applied: false, needKeyframe: true });
  });
});
