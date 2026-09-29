import { describe, it, expect } from 'vitest';
import { buildFlow, RUN_MARKER_MIN } from './live-flow.js';
import { action, LAC_ID, SAC_ID } from './live-fixtures.js';
import { normalCdf, winProbability } from '../../src/lib/live/win-prob.js';
import type { PlayByPlayAction } from '../../src/lib/types/live.js';

const EVEN = { expected: 0, sigma: 12.5 };

/** A scoring action that leaves the score at home–away (LAC is home unless stated). */
function score(n: number, home: number, away: number, clock: string, period = 1, teamId = LAC_ID): PlayByPlayAction {
  return action(n, {
    scoreHome: String(home),
    scoreAway: String(away),
    clock,
    period,
    teamId,
    teamTricode: teamId === LAC_ID ? 'LAC' : 'SAC',
    description: `Score ${home}-${away}`,
  });
}

describe('buildFlow', () => {
  it('starts at the tip with the pregame win probability', () => {
    const flow = buildFlow([], true, { expected: 4.5, sigma: 12.5 });
    expect(flow.markers).toEqual([]);
    expect(flow.points).toHaveLength(1);
    expect(flow.points[0]).toMatchObject({ t: 0, m: 0, a: 0, d: '' });
    expect(flow.points[0].wp).toBeCloseTo(normalCdf(4.5 / 12.5), 3);
  });

  it('adds a point per score change, from the Clippers side', () => {
    const actions = [
      score(1, 2, 0, 'PT11M30.00S'),
      action(2, { actionType: 'rebound', subType: 'defensive', scoreHome: '2', scoreAway: '0', clock: 'PT11M00.00S' }),
      score(3, 2, 3, 'PT10M40.00S', 1, SAC_ID),
    ];
    const home = buildFlow(actions, true, EVEN).points;
    expect(home.map((p) => [p.t, p.m, p.a])).toEqual([[0, 0, 0], [30, 2, 1], [80, -1, 3]]);
    expect(home[1].d).toBe('Score 2-0');
    expect(home[1].wp).toBeCloseTo(winProbability({ margin: 2, period: 1, clockSec: 690, ...EVEN }), 3);

    const away = buildFlow(actions, false, EVEN).points;
    expect(away.map((p) => p.m)).toEqual([0, -2, 1]);
  });

  it('skips actions without a readable score', () => {
    const flow = buildFlow([action(1, { scoreHome: '', scoreAway: '' }), score(2, 3, 0, 'PT11M00.00S')], true, EVEN);
    expect(flow.points.map((p) => p.a)).toEqual([0, 2]);
  });

  it(`marks a run of ${RUN_MARKER_MIN} or more unanswered points, not a shorter one`, () => {
    const flow = buildFlow(
      [
        score(1, 2, 0, 'PT11M00.00S'),
        score(2, 5, 0, 'PT10M30.00S'),
        score(3, 8, 0, 'PT10M00.00S'),
        score(4, 8, 2, 'PT09M30.00S', 1, SAC_ID),
        score(5, 8, 5, 'PT09M00.00S', 1, SAC_ID),
        score(6, 10, 5, 'PT08M30.00S'),
      ],
      true,
      EVEN
    );
    const runs = flow.markers.filter((m) => m.kind === 'run');
    expect(runs).toEqual([{ kind: 'run', t: 120, t_start: 60, side: 'lac', pts: 8 }]);
  });

  it('marks a run that is still going', () => {
    const flow = buildFlow(
      [score(1, 0, 3, 'PT11M00.00S', 1, SAC_ID), score(2, 0, 6, 'PT10M00.00S', 1, SAC_ID), score(3, 0, 9, 'PT09M00.00S', 1, SAC_ID)],
      true,
      EVEN
    );
    expect(flow.markers).toContainEqual({ kind: 'run', t: 180, t_start: 60, side: 'opp', pts: 9 });
  });

  it('marks lead changes, not ties', () => {
    const flow = buildFlow(
      [
        score(1, 2, 0, 'PT11M00.00S'),
        score(2, 2, 2, 'PT10M00.00S', 1, SAC_ID),
        score(3, 2, 4, 'PT09M00.00S', 1, SAC_ID),
        score(4, 5, 4, 'PT08M00.00S'),
      ],
      true,
      EVEN
    );
    expect(flow.markers.filter((m) => m.kind === 'lead_change')).toEqual([
      { kind: 'lead_change', t: 180, side: 'opp' },
      { kind: 'lead_change', t: 240, side: 'lac' },
    ]);
  });

  it('marks team timeouts and skips official ones', () => {
    const flow = buildFlow(
      [
        action(1, { actionType: 'timeout', subType: 'full', teamId: SAC_ID, teamTricode: 'SAC', clock: 'PT06M00.00S' }),
        action(2, { actionType: 'timeout', subType: 'official', teamId: 0, teamTricode: '', clock: 'PT05M00.00S' }),
      ],
      true,
      EVEN
    );
    expect(flow.markers).toEqual([{ kind: 'timeout', t: 360, side: 'opp' }]);
  });

  it('closes each period with a point at its buzzer', () => {
    const flow = buildFlow(
      [score(1, 2, 0, 'PT05M00.00S'), action(2, { actionType: 'period', subType: 'end', clock: 'PT00M00.00S', scoreHome: '2', scoreAway: '0' })],
      true,
      EVEN
    );
    expect(flow.markers).toContainEqual({ kind: 'period_end', t: 720, period: 1 });
    expect(flow.points.at(-1)).toMatchObject({ t: 720, m: 2, a: 2, d: '' });
  });

  it('marks the largest lead each way', () => {
    const flow = buildFlow(
      [score(1, 5, 0, 'PT11M00.00S'), score(2, 5, 9, 'PT09M00.00S', 1, SAC_ID), score(3, 7, 9, 'PT08M00.00S')],
      true,
      EVEN
    );
    expect(flow.markers).toContainEqual({ kind: 'max_lead', t: 60, side: 'lac', margin: 5 });
    expect(flow.markers).toContainEqual({ kind: 'max_lead', t: 180, side: 'opp', margin: 4 });
  });

  it('keeps markers in time order', () => {
    const flow = buildFlow(
      [
        score(1, 3, 0, 'PT11M00.00S'),
        action(2, { actionType: 'timeout', subType: 'full', teamId: SAC_ID, clock: 'PT10M50.00S' }),
        score(3, 3, 5, 'PT10M00.00S', 1, SAC_ID),
      ],
      true,
      EVEN
    );
    const ts = flow.markers.map((m) => m.t);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
  });

  it('only appends points as the feed grows', () => {
    const actions: PlayByPlayAction[] = [];
    let home = 0;
    let away = 0;
    for (let n = 1; n <= 40; n++) {
      if (n % 3 === 0) away += 2;
      else home += n % 2 ? 3 : 1;
      actions.push(score(n, home, away, `PT${String(11 - Math.floor(n / 4)).padStart(2, '0')}M00.00S`, 1, n % 3 === 0 ? SAC_ID : LAC_ID));
    }
    const full = buildFlow(actions, true, EVEN).points;
    for (let k = 0; k <= actions.length; k++) {
      const part = buildFlow(actions.slice(0, k), true, EVEN).points;
      expect(full.slice(0, part.length)).toEqual(part);
    }
  });
});
