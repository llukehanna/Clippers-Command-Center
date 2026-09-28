// scripts/lib/live-lineups.ts
// The rotation clipboard (Live v2 spec §7.2): who is on the floor and for how
// long, each stint's +/-, foul trouble, minutes against the player's usual,
// and tonight's Clippers five-man units. On-court players come from the box
// score (`oncourt`); stint starts and units from play-by-play substitutions.
// The feed doesn't always log substitutions between periods: a player on the
// floor whose last logged substitution was "out" counts as back since the next
// period started. Pure.

import type { BoxscorePlayer, BoxscoreTeam, PlayByPlayAction } from '../../src/lib/types/live';
import type { LineupState, LineupUnit, StintPlayer } from '../../src/lib/types/live-state';
import { elapsedSecs, OT_SECS, PERIOD_SECS, REGULATION_SECS } from '../../src/lib/live/win-prob';
import { clockToSecondsRemaining, parseNBAClock } from './nba-live-client';

export const UNITS_SHOWN = 5;
/** Projected minutes this far off the usual are flagged. */
export const PACE_FLAG_RATIO = 0.25;
/** Minutes pace isn't judged before this much game time. */
export const PACE_MIN_ELAPSED_SECS = PERIOD_SECS;

export interface LineupInputs {
  actions: PlayByPlayAction[];
  lacBox: BoxscoreTeam;
  oppBox: BoxscoreTeam;
  lacIsHome: boolean;
  period: number;              // game clock now
  clockSec: number;
  usualMin: Record<string, number>; // NBA personId → last-10-game average minutes
  /** Scoreboard values, for a box score without timeouts/bonus. */
  fallback?: { timeouts: { lac: number | null; opp: number | null }; bonus: { lac: boolean; opp: boolean } };
}

/** 2 fouls in Q1, 3 in Q2, 4 in Q3, 5 in Q4 and overtime. */
export function inFoulTrouble(period: number, fouls: number): boolean {
  const limit = period <= 1 ? 2 : period === 2 ? 3 : period === 3 ? 4 : 5;
  return fouls >= limit;
}

/** "PT25M30.00S" → 25.5 */
export function isoMinutes(iso: string): number {
  const m = /PT(?:(\d+)M)?(?:([\d.]+)S)?/.exec(iso ?? '');
  if (!m || (!m[1] && !m[2])) return 0;
  return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60;
}

export function minutesPace(min: number, usual: number | null, elapsed: number): 'over' | 'under' | null {
  if (usual === null || usual <= 0 || elapsed < PACE_MIN_ELAPSED_SECS) return null;
  const ratio = (min * REGULATION_SECS) / elapsed / usual;
  return ratio > 1 + PACE_FLAG_RATIO ? 'over' : ratio < 1 - PACE_FLAG_RATIO ? 'under' : null;
}

interface Timeline {
  t: number[];                 // elapsed secs of each action
  margin: number[];            // LAC margin after each action
}

interface Stint {
  t: number;
  margin: number;              // LAC margin when it started
  period: number;
  clock: string;
}

function timeline(actions: PlayByPlayAction[], lacIsHome: boolean): Timeline {
  const t: number[] = [];
  const margin: number[] = [];
  let m = 0;
  for (const a of actions) {
    t.push(elapsedSecs(a.period, clockToSecondsRemaining(a.clock)));
    const h = parseInt(a.scoreHome, 10);
    const w = parseInt(a.scoreAway, 10);
    if (Number.isFinite(h) && Number.isFinite(w)) m = lacIsHome ? h - w : w - h;
    margin.push(m);
  }
  return { t, margin };
}

function marginAt(tl: Timeline, at: number): number {
  let m = 0;
  for (let i = 0; i < tl.t.length && tl.t[i] <= at; i++) m = tl.margin[i];
  return m;
}

function periodStart(period: number): number {
  return period <= 4 ? (period - 1) * PERIOD_SECS : REGULATION_SECS + (period - 5) * OT_SECS;
}

const isSub = (a: PlayByPlayAction, teamId: number) => a.actionType.toLowerCase() === 'substitution' && a.teamId === teamId;
const shortName = (p: BoxscorePlayer) => p.nameI || p.name;
const round1 = (x: number) => Math.round(x * 10) / 10;

function stintStart(personId: number, team: BoxscoreTeam, i: LineupInputs, tl: Timeline): Stint {
  let lastIn = -1;
  let lastOut = -1;
  i.actions.forEach((a, idx) => {
    if (a.personId !== personId || !isSub(a, team.teamId)) return;
    const dir = (a.subType ?? '').toLowerCase();
    if (dir === 'in') lastIn = idx;
    else if (dir === 'out') lastOut = idx;
  });
  if (lastIn > lastOut) {
    const a = i.actions[lastIn];
    return { t: tl.t[lastIn], margin: tl.margin[lastIn], period: a.period, clock: parseNBAClock(a.clock) };
  }
  if (lastOut >= 0) {
    const period = Math.min(i.actions[lastOut].period + 1, i.period);
    const t = periodStart(period);
    return { t, margin: marginAt(tl, t), period, clock: period <= 4 ? '12:00' : '5:00' };
  }
  return { t: 0, margin: 0, period: 1, clock: '12:00' };
}

function unitsTonight(i: LineupInputs, tl: Timeline, now: number, marginNow: number): LineupUnit[] {
  const team = i.lacBox;
  const names = new Map(team.players.map((p) => [p.personId, shortName(p)]));
  const unit = new Set(team.players.filter((p) => p.starter === '1').map((p) => p.personId));
  const acc = new Map<string, LineupUnit>();
  let since = 0;
  let sinceMargin = 0;
  const close = (t: number, margin: number) => {
    if (unit.size === 5 && t > since) {
      const ids = [...unit].sort((a, b) => a - b);
      const key = ids.join('-');
      const u = acc.get(key) ?? { player_ids: ids, names: ids.map((id) => names.get(id) ?? String(id)), secs: 0, plus_minus: 0 };
      u.secs += t - since;
      u.plus_minus += margin - sinceMargin;
      acc.set(key, u);
    }
    since = t;
    sinceMargin = margin;
  };
  i.actions.forEach((a, idx) => {
    if (!isSub(a, team.teamId) || !a.personId) return;
    close(tl.t[idx], tl.margin[idx]);
    const dir = (a.subType ?? '').toLowerCase();
    if (dir === 'in') unit.add(a.personId);
    else if (dir === 'out') unit.delete(a.personId);
  });
  close(now, marginNow);
  return [...acc.values()].sort((a, b) => b.secs - a.secs).slice(0, UNITS_SHOWN);
}

export function buildLineups(i: LineupInputs): LineupState {
  const tl = timeline(i.actions, i.lacIsHome);
  const now = elapsedSecs(i.period, i.clockSec);
  const marginNow = tl.margin.at(-1) ?? 0;

  const onCourt = (team: BoxscoreTeam) =>
    team.players.filter((p) => p.oncourt === '1').map((p) => ({ p, start: stintStart(p.personId, team, i, tl) }));
  const toStint = (side: 'lac' | 'opp') => ({ p, start }: { p: BoxscorePlayer; start: Stint }): StintPlayer => {
    const delta = marginNow - start.margin;
    const min = round1(isoMinutes(p.statistics.minutes));
    const usual = i.usualMin[String(p.personId)] ?? null;
    return {
      player_id: p.personId,
      name: shortName(p),
      stint_start: { period: start.period, clock: start.clock },
      stint_secs: Math.max(0, now - start.t),
      stint_plus_minus: side === 'lac' ? delta : -delta,
      pf: p.statistics.foulsPersonal,
      foul_trouble: inFoulTrouble(i.period, p.statistics.foulsPersonal),
      min,
      usual_min: usual,
      pace: minutesPace(min, usual, now),
    };
  };

  const lacOn = onCourt(i.lacBox);
  const newest = lacOn.reduce<Stint | null>((best, s) => (!best || s.start.t > best.t ? s.start : best), null);

  return {
    on_court: { lac: lacOn.map(toStint('lac')), opp: onCourt(i.oppBox).map(toStint('opp')) },
    current_unit: newest
      ? { lac_plus_minus: marginNow - newest.margin, secs_together: Math.max(0, now - newest.t) }
      : { lac_plus_minus: 0, secs_together: 0 },
    units_tonight: unitsTonight(i, tl, now, marginNow),
    timeouts: {
      lac: i.lacBox.timeoutsRemaining ?? i.fallback?.timeouts.lac ?? null,
      opp: i.oppBox.timeoutsRemaining ?? i.fallback?.timeouts.opp ?? null,
    },
    bonus: {
      lac: i.lacBox.inBonus !== undefined ? i.lacBox.inBonus === '1' : (i.fallback?.bonus.lac ?? false),
      opp: i.oppBox.inBonus !== undefined ? i.oppBox.inBonus === '1' : (i.fallback?.bonus.opp ?? false),
    },
  };
}
