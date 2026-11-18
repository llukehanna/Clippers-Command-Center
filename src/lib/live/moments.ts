// src/lib/live/moments.ts
// The live Insights panel's game moments, read off the game-flow series the
// runner already builds (scripts/lib/live-flow.ts): every scoring run of 8+
// points, and a comeback once the leader has erased a big deficit. Unlike the
// old recent-scoring window, a run stays listed after the other team answers,
// and its size is the flow chart's own count.

import type { LiveFlow } from '../types/live-state';
import type { Insight } from '../ui/types';

const PERIOD_SECS = 720;
const OT_SECS = 300;
const REGULATION_SECS = 4 * PERIOD_SECS;
/** A comeback is worth calling out once the leader has erased this many points. */
export const COMEBACK_MIN = 10;
/** At most this many moments; the newest win. */
const MAX_MOMENTS = 5;

/** Game seconds elapsed → "Q2 4:08" (time left in the period). */
export function momentClock(t: number): string {
  let period: number;
  let left: number;
  if (t < REGULATION_SECS) {
    period = Math.min(4, Math.floor(t / PERIOD_SECS) + 1);
    left = period * PERIOD_SECS - t;
  } else {
    const ot = Math.floor((t - REGULATION_SECS) / OT_SECS);
    period = 5 + ot;
    left = REGULATION_SECS + (ot + 1) * OT_SECS - t;
  }
  // A basket at the horn belongs to the period it ended, not the next one at 12:00.
  if (left === (period <= 4 ? PERIOD_SECS : OT_SECS) && t > 0) {
    period -= 1;
    left = 0;
  }
  const label = period <= 4 ? `Q${period}` : period === 5 ? 'OT' : `${period - 4}OT`;
  const s = Math.max(0, Math.round(left));
  return `${label} ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export interface MomentTeams {
  game_id: string;
  lac: string; // tricode
  opp: string;
}

export function flowMoments(flow: LiveFlow | null | undefined, teams: MomentTeams): Insight[] {
  if (!flow || flow.points.length < 2) return [];
  const name = (side: 'lac' | 'opp') => (side === 'lac' ? teams.lac : teams.opp);
  const scoring = flow.points.filter((p) => p.a !== 0 && p.d !== '');
  const lastScoreT = scoring.length ? scoring[scoring.length - 1].t : -1;
  const out: (Insight & { t: number })[] = [];

  for (const m of flow.markers) {
    if (m.kind !== 'run') continue;
    // The newest basket is this run's last one: nobody has answered yet.
    const ongoing = m.t === lastScoreT && m === flow.markers.filter((x) => x.kind === 'run').at(-1);
    out.push({
      t: m.t,
      insight_id: `live-${teams.game_id}-run-${m.t_start}`,
      category: 'run',
      headline: ongoing ? `${name(m.side)} on a ${m.pts}-0 run` : `${name(m.side)} ${m.pts}-0 run`,
      detail: ongoing
        ? `${m.pts} straight points since ${momentClock(m.t_start)}`
        : `${momentClock(m.t_start)} to ${momentClock(m.t)}`,
      importance: ongoing ? 95 : 70,
      proof: { summary: 'run', result: { side: m.side, pts: m.pts, t_start: m.t_start, t: m.t } },
    });
  }

  // Comeback: the side leading now once trailed by COMEBACK_MIN or more.
  const now = flow.points[flow.points.length - 1];
  if (now.m !== 0) {
    const leader: 'lac' | 'opp' = now.m > 0 ? 'lac' : 'opp';
    let worst = 0;
    let worstT = 0;
    for (const p of flow.points) {
      const deficit = leader === 'lac' ? -p.m : p.m;
      if (deficit > worst) {
        worst = deficit;
        worstT = p.t;
      }
    }
    if (worst >= COMEBACK_MIN) {
      const lead = Math.abs(now.m);
      out.push({
        t: now.t,
        insight_id: `live-${teams.game_id}-comeback-${leader}`,
        category: 'comeback',
        headline: `${name(leader)} erased a ${worst}-point deficit`,
        detail: `Down ${worst} at ${momentClock(worstT)}, now up ${lead}`,
        importance: 90,
        proof: { summary: 'comeback', result: { side: leader, deficit: worst, at: worstT, lead } },
      });
    }
  }

  return out
    .sort((x, y) => y.t - x.t || y.importance - x.importance)
    .slice(0, MAX_MOMENTS)
    .map(({ insight_id, category, headline, detail, importance, proof }) => ({ insight_id, category, headline, detail, importance, proof }));
}
