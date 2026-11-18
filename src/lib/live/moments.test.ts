import { describe, it, expect } from 'vitest';
import { flowMoments, momentClock } from './moments';
import type { FlowMarker, FlowPoint, LiveFlow } from '../types/live-state';

const teams = { game_id: '4532', lac: 'LAC', opp: 'UTA' };
const pt = (t: number, m: number, d = 'basket'): FlowPoint => ({ t, m, wp: 0.5, a: t + 1, d });

describe('momentClock', () => {
  it('maps elapsed seconds to the period and time left', () => {
    expect(momentClock(0)).toBe('Q1 12:00');
    expect(momentClock(90)).toBe('Q1 10:30');
    expect(momentClock(720)).toBe('Q1 0:00'); // at the horn, not Q2 12:00
    expect(momentClock(1432)).toBe('Q2 0:08');
    expect(momentClock(2881)).toBe('OT 4:59');
    expect(momentClock(3480)).toBe('2OT 0:00');
  });
});

describe('flowMoments', () => {
  it('lists every run, newest first, and keeps a run after it is answered', () => {
    const markers: FlowMarker[] = [
      { kind: 'run', t: 177, t_start: 90, side: 'lac', pts: 10 },
      { kind: 'run', t: 600, t_start: 500, side: 'opp', pts: 9 },
    ];
    const flow: LiveFlow = { points: [pt(0, 0, ''), pt(177, 7), pt(600, -2), pt(650, 0)], markers };
    const out = flowMoments(flow, teams);
    expect(out.map((i) => i.headline)).toEqual(['UTA 9-0 run', 'LAC 10-0 run']);
    expect(out[1].detail).toBe('Q1 10:30 to Q1 9:03');
  });

  it('calls a run "on a run" while nobody has answered it', () => {
    const flow: LiveFlow = {
      points: [pt(0, 0, ''), pt(1315, -8), pt(1432, 5)],
      markers: [{ kind: 'run', t: 1432, t_start: 1315, side: 'lac', pts: 13 }],
    };
    const [run] = flowMoments(flow, teams).filter((i) => i.category === 'run');
    expect(run.headline).toBe('LAC on a 13-0 run');
    expect(run.importance).toBe(95);
  });

  it('notes a comeback once the leader has erased a 10-point deficit', () => {
    const flow: LiveFlow = { points: [pt(0, 0, ''), pt(661, -12), pt(1440, 4, '')], markers: [] };
    expect(flowMoments(flow, teams)).toEqual([
      expect.objectContaining({ category: 'comeback', headline: 'LAC erased a 12-point deficit', detail: 'Down 12 at Q1 0:59, now up 4' }),
    ]);
    const small: LiveFlow = { points: [pt(0, 0, ''), pt(300, -9), pt(400, 2)], markers: [] };
    expect(flowMoments(small, teams)).toEqual([]);
  });

  it('is empty before tip and without a flow', () => {
    expect(flowMoments(null, teams)).toEqual([]);
    expect(flowMoments({ points: [pt(0, 0, '')], markers: [] }, teams)).toEqual([]);
  });
});
