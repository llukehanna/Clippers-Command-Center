// scripts/lib/live-flow.ts
// The game-flow series and markers behind /live's flow chart (Live v2 spec
// §7.1), from the raw play-by-play: one point per score change plus the tip
// and each period's buzzer, each with the LAC margin and the model's win
// probability at that moment. Markers: runs of 8+ unanswered points, team
// timeouts, lead changes, period ends and the largest lead each way. Pure; the
// points only grow as long as the feed only appends actions.

import type { PlayByPlayAction } from '../../src/lib/types/live';
import type { FlowMarker, FlowPoint, LiveFlow } from '../../src/lib/types/live-state';
import { elapsedSecs, PERIOD_SECS, winProbability } from '../../src/lib/live/win-prob';
import { clockToSecondsRemaining } from './nba-live-client';
import { LAC_TEAM_ID } from './poll-live-logic';

/** Same threshold as detectScoringRun in src/lib/insights/live.ts. */
export const RUN_MARKER_MIN = 8;

export interface FlowModel {
  expected: number;            // pregame expected LAC margin
  sigma: number;
}

type Side = 'lac' | 'opp';

const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function buildFlow(actions: PlayByPlayAction[], lacIsHome: boolean, model: FlowModel): LiveFlow {
  const wp = (margin: number, period: number, clockSec: number) =>
    round3(winProbability({ margin, period, clockSec, expected: model.expected, sigma: model.sigma }));

  const points: FlowPoint[] = [{ t: 0, m: 0, wp: wp(0, 1, PERIOD_SECS), a: 0, d: '' }];
  const markers: FlowMarker[] = [];
  let home = 0;
  let away = 0;
  let margin = 0;
  let lastSign = 0;
  let run: { side: Side; pts: number; t_start: number; t: number } | null = null;
  const lead = { lac: { margin: 0, t: 0 }, opp: { margin: 0, t: 0 } };

  const endRun = () => {
    if (run && run.pts >= RUN_MARKER_MIN) {
      markers.push({ kind: 'run', t: run.t, t_start: run.t_start, side: run.side, pts: run.pts });
    }
    run = null;
  };
  const extendRun = (side: Side, pts: number, t: number) => {
    if (run && run.side === side) {
      run.pts += pts;
      run.t = t;
    } else {
      endRun();
      run = { side, pts, t_start: t, t };
    }
  };

  for (const a of actions) {
    const type = a.actionType.toLowerCase();
    const sub = (a.subType ?? '').toLowerCase();
    const clockSec = clockToSecondsRemaining(a.clock);
    const t = elapsedSecs(a.period, clockSec);

    if (type === 'timeout') {
      // Official (media) timeouts carry no team.
      if (a.teamId) markers.push({ kind: 'timeout', t, side: a.teamId === LAC_TEAM_ID ? 'lac' : 'opp' });
      continue;
    }
    if (type === 'period' && sub === 'end') {
      markers.push({ kind: 'period_end', t, period: a.period });
      points.push({ t, m: margin, wp: wp(margin, a.period, 0), a: a.actionNumber, d: '' });
      continue;
    }

    const h = parseInt(a.scoreHome, 10);
    const w = parseInt(a.scoreAway, 10);
    if (!Number.isFinite(h) || !Number.isFinite(w) || (h === home && w === away)) continue;
    const dLac = lacIsHome ? h - home : w - away;
    const dOpp = lacIsHome ? w - away : h - home;
    home = h;
    away = w;

    if (dLac > 0 && dOpp === 0) extendRun('lac', dLac, t);
    else if (dOpp > 0 && dLac === 0) extendRun('opp', dOpp, t);
    else endRun(); // a score correction breaks any run

    const m = lacIsHome ? h - w : w - h;
    const sign = Math.sign(m);
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
      markers.push({ kind: 'lead_change', t, side: sign > 0 ? 'lac' : 'opp' });
    }
    if (sign !== 0) lastSign = sign;
    margin = m;
    if (m > lead.lac.margin) lead.lac = { margin: m, t };
    if (-m > lead.opp.margin) lead.opp = { margin: -m, t };

    points.push({ t, m, wp: wp(m, a.period, clockSec), a: a.actionNumber, d: a.description ?? '' });
  }
  endRun();

  if (lead.lac.margin > 0) markers.push({ kind: 'max_lead', t: lead.lac.t, side: 'lac', margin: lead.lac.margin });
  if (lead.opp.margin > 0) markers.push({ kind: 'max_lead', t: lead.opp.t, side: 'opp', margin: lead.opp.margin });
  markers.sort((x, y) => x.t - y.t); // stable: same-time markers keep their order

  return { points, markers };
}
