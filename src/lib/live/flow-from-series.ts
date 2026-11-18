// src/lib/live/flow-from-series.ts
// A finished game's flow chart from game_flow.margin_series ([elapsed_sec,
// lac_margin] per margin change) — the same LiveFlow shape /live draws, so
// the postgame page reuses components/live/GameFlow. Mirrors the markers of
// scripts/lib/live-flow.ts buildFlow (runs of 8+, lead changes, period ends,
// largest leads); timeouts aren't in the series and are omitted.

import type { FlowMarker, FlowPoint, LiveFlow } from '../types/live-state';
import { OT_SECS, PERIOD_SECS, REGULATION_SECS, periodClockAt, winProbability } from './win-prob';

export const RUN_MARKER_MIN = 8;

type Side = 'lac' | 'opp';
const round3 = (x: number) => Math.round(x * 1000) / 1000;

export function periodsReached(series: [number, number][], periods: number): number {
  const last = series.at(-1)?.[0] ?? 0;
  const fromSeries = last > REGULATION_SECS ? 4 + Math.ceil((last - REGULATION_SECS) / OT_SECS) : 4;
  return Math.max(4, periods, fromSeries);
}

export function periodEnds(periods: number): number[] {
  const ends: number[] = [];
  for (let p = 1; p <= periods; p++) {
    ends.push(p <= 4 ? p * PERIOD_SECS : REGULATION_SECS + (p - 4) * OT_SECS);
  }
  return ends;
}

export function flowFromSeries(
  series: [number, number][],
  periods: number,
  model: { expected: number; sigma: number },
  descriptions: Map<number, string> = new Map()
): LiveFlow {
  const ends = periodEnds(periodsReached(series, periods));
  const wp = (margin: number, t: number) => {
    const { period, clockSec } = periodClockAt(t);
    return round3(winProbability({ margin, period, clockSec, expected: model.expected, sigma: model.sigma }));
  };

  const points: FlowPoint[] = [{ t: 0, m: 0, wp: wp(0, 0), a: 0, d: '' }];
  const markers: FlowMarker[] = [];
  let margin = 0;
  let lastSign = 0;
  let seq = 0;
  let endIdx = 0;
  let run: { side: Side; pts: number; t_start: number; t: number } | null = null;
  const lead = { lac: { margin: 0, t: 0 }, opp: { margin: 0, t: 0 } };

  const endRun = () => {
    if (run && run.pts >= RUN_MARKER_MIN) markers.push({ kind: 'run', t: run.t, t_start: run.t_start, side: run.side, pts: run.pts });
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
  /** Period-end points strictly before t (a buzzer-beater at t = 720 belongs to Q1, before its end point). */
  const flushEnds = (t: number) => {
    while (endIdx < ends.length && ends[endIdx] < t) {
      const end = ends[endIdx];
      markers.push({ kind: 'period_end', t: end, period: endIdx + 1 });
      points.push({ t: end, m: margin, wp: wp(margin, end), a: ++seq, d: '' });
      endIdx++;
    }
  };

  for (const [t, m] of series) {
    if (t === 0 && m === 0) continue;
    flushEnds(t);
    const delta = m - margin;
    if (delta > 0) extendRun('lac', delta, t);
    else if (delta < 0) extendRun('opp', -delta, t);
    const sign = Math.sign(m);
    if (sign !== 0 && lastSign !== 0 && sign !== lastSign) markers.push({ kind: 'lead_change', t, side: sign > 0 ? 'lac' : 'opp' });
    if (sign !== 0) lastSign = sign;
    margin = m;
    if (m > lead.lac.margin) lead.lac = { margin: m, t };
    if (-m > lead.opp.margin) lead.opp = { margin: -m, t };
    points.push({ t, m, wp: wp(m, t), a: ++seq, d: descriptions.get(t) ?? '' });
  }
  endRun();
  flushEnds(Number.POSITIVE_INFINITY);

  if (lead.lac.margin > 0) markers.push({ kind: 'max_lead', t: lead.lac.t, side: 'lac', margin: lead.lac.margin });
  if (lead.opp.margin > 0) markers.push({ kind: 'max_lead', t: lead.opp.t, side: 'opp', margin: lead.opp.margin });
  markers.sort((x, y) => x.t - y.t);
  return { points, markers };
}
