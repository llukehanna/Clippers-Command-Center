// src/lib/live/flow-view.ts
// Pure helpers behind components/live/GameFlow.tsx: chart rows, axes, labels.

import type { FlowMarker, LiveFlow, LiveWinProb } from '../types/live-state';
import { OT_SECS, PERIOD_SECS, REGULATION_SECS } from './win-prob';

export interface FlowRow {
  t: number;
  lead: number;                // margin when LAC leads, else 0 (area above zero)
  trail: number;               // margin when LAC trails, else 0 (area below zero)
  m: number;
  wp: number;                  // percent, 1 decimal
  d: string;
}

export function flowRows(flow: LiveFlow): FlowRow[] {
  return flow.points.map((p) => ({
    t: p.t,
    lead: Math.max(0, p.m),
    trail: Math.min(0, p.m),
    m: p.m,
    wp: Math.round(p.wp * 1000) / 10,
    d: p.d,
  }));
}

/** The x-axis end: regulation, or the end of the last overtime period reached. */
export function flowDomainEnd(flow: LiveFlow): number {
  const last = flow.points.at(-1)?.t ?? 0;
  if (last <= REGULATION_SECS) return REGULATION_SECS;
  return REGULATION_SECS + Math.ceil((last - REGULATION_SECS) / OT_SECS) * OT_SECS;
}

/** Each period's start inside [0, end). */
export function periodTicks(end: number): number[] {
  const ticks: number[] = [];
  for (let t = 0; t < Math.min(end, REGULATION_SECS); t += PERIOD_SECS) ticks.push(t);
  for (let t = REGULATION_SECS; t < end; t += OT_SECS) ticks.push(t);
  return ticks;
}

export function tickLabel(t: number): string {
  if (t < REGULATION_SECS) return `Q${Math.floor(t / PERIOD_SECS) + 1}`;
  const ot = Math.floor((t - REGULATION_SECS) / OT_SECS) + 1;
  return ot === 1 ? 'OT' : `${ot}OT`;
}

/** A symmetric margin axis in steps of 5, at least ±5. */
export function marginDomain(flow: LiveFlow): [number, number] {
  const max = flow.points.reduce((a, p) => Math.max(a, Math.abs(p.m)), 0);
  const lim = Math.max(5, Math.ceil(max / 5) * 5);
  return [-lim, lim];
}

export function marginText(m: number, oppAbbr: string): string {
  return m > 0 ? `LAC +${m}` : m < 0 ? `${oppAbbr} +${-m}` : 'Tied';
}

export interface FlowSummary {
  leadChanges: number;
  lac: { margin: number; t: number } | null;
  opp: { margin: number; t: number } | null;
}

export function flowSummary(flow: LiveFlow): FlowSummary {
  const out: FlowSummary = { leadChanges: 0, lac: null, opp: null };
  for (const m of flow.markers) {
    if (m.kind === 'lead_change') out.leadChanges += 1;
    else if (m.kind === 'max_lead') out[m.side] = { margin: m.margin, t: m.t };
  }
  return out;
}

/** "Largest lead LAC +9 · SAC +4": labeled whichever side led; null when neither has. */
export function largestLeadText(summary: FlowSummary, oppAbbr: string): string | null {
  const leads = [
    summary.lac ? `LAC +${summary.lac.margin}` : null,
    summary.opp ? `${oppAbbr} +${summary.opp.margin}` : null,
  ].filter((x): x is string => x !== null);
  return leads.length ? `Largest lead ${leads.join(' · ')}` : null;
}

export function markersOf<K extends FlowMarker['kind']>(flow: LiveFlow, kind: K): Extract<FlowMarker, { kind: K }>[] {
  return flow.markers.filter((m): m is Extract<FlowMarker, { kind: K }> => m.kind === kind);
}

/** Which fit produced the σ behind a game's win probability (mirrors the runner's modelSigma). */
export type ModelFitNote =
  | { kind: 'fit'; basis: 'spread' | 'home_court' | 'all'; n_games: number; brier: number }
  | { kind: 'default_until_spread_fit' }
  | { kind: 'uncalibrated' };

const validSigma = (s: number | undefined): s is number => typeof s === 'number' && Number.isFinite(s) && s > 0;

export function modelFitNote(wp: LiveWinProb): ModelFitNote {
  const c = wp.calibration;
  if (!c) return { kind: 'uncalibrated' };
  const own = c.sigma_by_source?.[wp.expected_source];
  if (own && validSigma(own.sigma)) return { kind: 'fit', basis: wp.expected_source, n_games: own.n_games, brier: own.brier };
  if (wp.expected_source === 'spread' && c.sigma_by_source) return { kind: 'default_until_spread_fit' };
  if (validSigma(c.sigma)) return { kind: 'fit', basis: 'all', n_games: c.n_games, brier: c.brier };
  return { kind: 'uncalibrated' };
}
