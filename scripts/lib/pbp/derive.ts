// scripts/lib/pbp/derive.ts
// Per-game facts derived from normalized play-by-play. Pure.
import type { NormalizedPbp, PbpEvent } from './types.js';

export interface GameFlow {
  lacLargestLead: number;
  lacLargestDeficit: number;
  leadChanges: number;
  timesTied: number;
  lacBestRun: number;
  oppBestRun: number;
  comebackMargin: number | null;
  marginSeries: [number, number][];   // [elapsed_sec, lac_margin]
}

/** Lead, runs and comeback facts from the Clippers' side. */
export function deriveGameFlow(events: PbpEvent[], lacIsHome: boolean): GameFlow {
  let margin = 0;
  let lead = 0;
  let deficit = 0;
  let leadChanges = 0;
  let timesTied = 0;
  let lastSign = 0;                  // sign of the last non-zero margin
  const series: [number, number][] = [[0, 0]];
  const best = { lac: 0, opp: 0 };
  let run: { side: 'lac' | 'opp' | null; pts: number } = { side: null, pts: 0 };
  let runStartBest = 0;               // best[run.side] snapshotted when the current run began
  let prevHome = 0;
  let prevAway = 0;

  for (const e of events) {
    const dHome = e.scoreHome - prevHome;
    const dAway = e.scoreAway - prevAway;
    prevHome = e.scoreHome;
    prevAway = e.scoreAway;
    const dLac = lacIsHome ? dHome : dAway;
    const dOpp = lacIsHome ? dAway : dHome;

    if (e.points === 0) continue;
    const m = lacIsHome ? e.scoreHome - e.scoreAway : e.scoreAway - e.scoreHome;
    if (m !== margin) {
      if (m === 0) timesTied++;
      const sign = Math.sign(m);
      if (sign !== 0 && lastSign !== 0 && sign !== lastSign) leadChanges++;
      if (sign !== 0) lastSign = sign;
      margin = m;
      lead = Math.max(lead, m);
      deficit = Math.max(deficit, -m);
      series.push([e.elapsedSec, m]);
    }
    if (e.points > 0 && e.scoringSide) {
      const side = (e.scoringSide === 'home') === lacIsHome ? 'lac' : 'opp';
      if (run.side !== side) runStartBest = best[side];
      run = run.side === side ? { side, pts: run.pts + e.points } : { side, pts: e.points };
      best[side] = Math.max(best[side], run.pts);
    } else if (run.side) {
      // Score-correction event (points < 0): only a correction to the run's own
      // side affects it — subtract the drop, floor at 0, and recompute the side's
      // best from what it was before this run started (never lower an earlier run).
      const side = run.side;
      const delta = side === 'lac' ? dLac : dOpp;
      if (delta < 0) {
        const pts = Math.max(0, run.pts + delta);
        run = { side, pts };
        best[side] = Math.max(runStartBest, pts);
      }
    }
  }

  return {
    lacLargestLead: lead,
    lacLargestDeficit: deficit,
    leadChanges,
    timesTied,
    lacBestRun: best.lac,
    oppBestRun: best.opp,
    comebackMargin: margin > 0 ? deficit : null,
    marginSeries: series,
  };
}

export interface PeriodTeamLine {
  tricode: string; period: number;
  pts: number; fgm: number; fga: number; fg3m: number; fg3a: number; ftm: number; fta: number;
  reb: number; ast: number | null; tov: number;
}

export interface PeriodPlayerLine {
  personId: number; tricode: string; period: number;
  pts: number; reb: number; ast: number | null; fg3m: number; fgm: number; fga: number;
  stl: number | null; blk: number | null;
}

/** Team and player lines per period. Team points follow the score, so they match the line score. */
export function derivePeriodStats(
  pbp: NormalizedPbp,
  tricodes: { home: string; away: string }
): { teams: PeriodTeamLine[]; players: PeriodPlayerLine[] } {
  const credits = pbp.hasDefensiveCredits;
  const teams = new Map<string, PeriodTeamLine>();
  const players = new Map<string, PeriodPlayerLine>();

  const team = (tricode: string, period: number) => {
    const key = `${tricode}|${period}`;
    let line = teams.get(key);
    if (!line) {
      line = { tricode, period, pts: 0, fgm: 0, fga: 0, fg3m: 0, fg3a: 0, ftm: 0, fta: 0, reb: 0, ast: credits ? 0 : null, tov: 0 };
      teams.set(key, line);
    }
    return line;
  };
  const player = (personId: number, tricode: string, period: number) => {
    const key = `${personId}|${period}`;
    let line = players.get(key);
    if (!line) {
      line = { personId, tricode, period, pts: 0, reb: 0, ast: credits ? 0 : null, fg3m: 0, fgm: 0, fga: 0, stl: credits ? 0 : null, blk: credits ? 0 : null };
      players.set(key, line);
    }
    return line;
  };

  let prevHome = 0;
  let prevAway = 0;
  for (const e of pbp.events) {
    const dh = e.scoreHome - prevHome;
    const da = e.scoreAway - prevAway;
    prevHome = e.scoreHome;
    prevAway = e.scoreAway;
    if (dh !== 0) team(tricodes.home, e.period).pts += dh;
    if (da !== 0) team(tricodes.away, e.period).pts += da;
    if (!e.teamTricode) continue;

    const t = team(e.teamTricode, e.period);
    const p = () => (e.personId ? player(e.personId, e.teamTricode!, e.period) : null);
    switch (e.kind) {
      case 'fg': {
        const shooter = p();
        t.fga++;
        if (shooter) shooter.fga++;
        if (e.shotValue === 3) t.fg3a++;
        if (e.made) {
          t.fgm++;
          if (e.shotValue === 3) t.fg3m++;
          if (shooter) {
            shooter.fgm++;
            shooter.pts += e.shotValue ?? 2;
            if (e.shotValue === 3) shooter.fg3m++;
          }
          if (credits && e.assistPersonId) {
            t.ast = (t.ast ?? 0) + 1;
            const assister = player(e.assistPersonId, e.teamTricode, e.period);
            assister.ast = (assister.ast ?? 0) + 1;
          }
        }
        break;
      }
      case 'ft': {
        t.fta++;
        if (e.made) {
          t.ftm++;
          const shooter = p();
          if (shooter) shooter.pts += 1;
        }
        break;
      }
      case 'rebound': {
        const rebounder = p();
        if (rebounder) {   // team rebounds (no player) are not counted, as in the box score
          t.reb++;
          rebounder.reb++;
        }
        break;
      }
      case 'turnover':
        t.tov++;
        break;
      case 'steal': {
        const stealer = credits ? p() : null;
        if (stealer) stealer.stl = (stealer.stl ?? 0) + 1;
        break;
      }
      case 'block': {
        const blocker = credits ? p() : null;
        if (blocker) blocker.blk = (blocker.blk ?? 0) + 1;
        break;
      }
      default:
        break;
    }
  }
  return { teams: [...teams.values()], players: [...players.values()] };
}

export interface ClutchLine {
  tricode: string;
  personId: number | null;     // null = team line
  pts: number; fgm: number; fga: number; fg3m: number; ftm: number; fta: number; tov: number;
}

/** Clutch = period >= 4, <= 5:00 left, margin <= 5 before the event (NBA definition). */
export function deriveClutch(events: PbpEvent[]): ClutchLine[] {
  const lines = new Map<string, ClutchLine>();
  const line = (tricode: string, personId: number | null) => {
    const key = `${tricode}|${personId ?? ''}`;
    let l = lines.get(key);
    if (!l) {
      l = { tricode, personId, pts: 0, fgm: 0, fga: 0, fg3m: 0, ftm: 0, fta: 0, tov: 0 };
      lines.set(key, l);
    }
    return l;
  };

  let prevHome = 0;
  let prevAway = 0;
  for (const e of events) {
    const inWindow = e.period >= 4 && e.clockSec <= 300 && Math.abs(prevHome - prevAway) <= 5;
    prevHome = e.scoreHome;
    prevAway = e.scoreAway;
    if (!inWindow || !e.teamTricode) continue;
    if (e.kind !== 'fg' && e.kind !== 'ft' && e.kind !== 'turnover') continue;

    const targets = [line(e.teamTricode, null), ...(e.personId ? [line(e.teamTricode, e.personId)] : [])];
    for (const l of targets) {
      if (e.kind === 'turnover') l.tov++;
      else if (e.kind === 'fg') {
        l.fga++;
        if (e.made) {
          l.fgm++;
          l.pts += e.shotValue ?? 2;
          if (e.shotValue === 3) l.fg3m++;
        }
      } else {
        l.fta++;
        if (e.made) {
          l.ftm++;
          l.pts += 1;
        }
      }
    }
  }
  return [...lines.values()];
}
