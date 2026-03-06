/**
 * Live insight detection — pure functions with zero DB imports.
 *
 * generateLiveInsights takes a LiveSnapshot and RollingContext (both
 * passed in from the caller) and returns InsightCandidate[] transiently.
 * Results are never written to the insights table.
 *
 * Phase 7 wires this into the live polling loop.
 */

// Matches the shape returned by rolling_team_stats (from rolling-windows.ts)
export interface RollingTeamRow {
  team_id: string;
  window_size: number;
  as_of_game_date: string;
  avg_points: number;
  avg_fg_pct: number;
  avg_efg_pct: number;
  avg_pace: number;
  avg_off_rating: number;
  avg_def_rating: number;
  avg_net_rating: number;
  game_count: number;
}

export interface LiveSnapshot {
  game_id: string;
  period: number;              // 1–4 for regulation, 5+ for OT
  clock: string;               // "MM:SS" format (time remaining in period)
  home_score: number;
  away_score: number;
  home_team_id: string;
  away_team_id: string;
  recent_scoring: ScoringEvent[];  // ordered chronological; from snapshot payload
}

export interface ScoringEvent {
  team_id: string;
  points: number;
  event_time_seconds: number;  // seconds elapsed in game
}

export interface RollingContext {
  home_rolling_10: RollingTeamRow | null;
  away_rolling_10: RollingTeamRow | null;
}

export interface InsightCandidate {
  category: 'run' | 'clutch';
  headline: string;
  detail: string | null;
  importance: number;
  proof_sql: string;
  proof_params: Record<string, unknown>;
  proof_result: unknown[];
}

interface ScoringRun {
  team_id: string;
  points: number;
  start_event_index: number;
  end_event_index: number;
}

/**
 * Parse "MM:SS" clock string into total seconds remaining.
 */
export function parseClockSeconds(clock: string): number {
  const parts = clock.split(':');
  const min = parseInt(parts[0] ?? '0', 10);
  const sec = parseInt(parts[1] ?? '0', 10);
  return (isNaN(min) ? 0 : min) * 60 + (isNaN(sec) ? 0 : sec);
}

/**
 * Detect the best (highest-point) consecutive scoring run by a single team.
 * Returns the run if it is >= 8 points, otherwise null.
 *
 * Algorithm: iterate each start index, count consecutive events from same team,
 * track best total. O(n²) but n is small for live scoring events.
 */
export function detectScoringRun(events: ScoringEvent[]): ScoringRun | null {
  if (events.length === 0) return null;

  let bestRun: ScoringRun | null = null;

  for (let startIdx = 0; startIdx < events.length; startIdx++) {
    const runTeam = events[startIdx].team_id;
    let runPoints = 0;
    let endIdx = startIdx;

    for (let i = startIdx; i < events.length; i++) {
      if (events[i].team_id !== runTeam) break;
      runPoints += events[i].points;
      endIdx = i;
    }

    if (runPoints >= 8) {
      if (!bestRun || runPoints > bestRun.points) {
        bestRun = {
          team_id: runTeam,
          points: runPoints,
          start_event_index: startIdx,
          end_event_index: endIdx,
        };
      }
    }
  }

  return bestRun;
}

/**
 * Returns true when the game is in the last 5 minutes of Q4 or overtime
 * AND the score margin is 8 or fewer points.
 */
export function isClutchSituation(snap: LiveSnapshot): boolean {
  const secondsRemaining = parseClockSeconds(snap.clock);
  const margin = Math.abs(snap.home_score - snap.away_score);
  return snap.period >= 4 && secondsRemaining <= 300 && margin <= 8;
}

function buildRunInsight(run: ScoringRun, snapshot: LiveSnapshot): InsightCandidate {
  const runEvents = snapshot.recent_scoring.slice(
    run.start_event_index,
    run.end_event_index + 1
  );

  return {
    category: 'run',
    headline: `${run.points}-0 scoring run`,
    detail: `Team ${run.team_id} has scored ${run.points} unanswered points`,
    importance: 85,
    proof_sql:
      'SELECT team_id, SUM(points) AS run_points FROM recent_scoring WHERE game_id = $1 AND event_time_seconds BETWEEN $2 AND $3 GROUP BY team_id',
    proof_params: {
      game_id: snapshot.game_id,
      start_time: runEvents[0]?.event_time_seconds ?? 0,
      end_time: runEvents[runEvents.length - 1]?.event_time_seconds ?? 0,
    },
    proof_result: runEvents.map((e) => ({ ...e })),
  };
}

function buildClutchInsight(snapshot: LiveSnapshot): InsightCandidate {
  const margin = Math.abs(snapshot.home_score - snapshot.away_score);

  return {
    category: 'clutch',
    headline: 'Clutch situation',
    detail: `Period ${snapshot.period}, ${snapshot.clock} remaining, margin ${margin}`,
    importance: 90,
    proof_sql:
      'SELECT period, clock, home_score, away_score, ABS(home_score - away_score) AS margin FROM live_snapshots WHERE game_id = $1 ORDER BY captured_at DESC LIMIT 1',
    proof_params: {
      game_id: snapshot.game_id,
    },
    proof_result: [
      {
        period: snapshot.period,
        clock: snapshot.clock,
        home_score: snapshot.home_score,
        away_score: snapshot.away_score,
        margin,
      },
    ],
  };
}

/**
 * generateLiveInsights — main entry point.
 *
 * Returns an array of InsightCandidate objects (possibly empty).
 * Never throws — invalid inputs yield an empty array.
 */
export function generateLiveInsights(
  snapshot: LiveSnapshot,
  _rollingData: RollingContext
): InsightCandidate[] {
  try {
    const results: InsightCandidate[] = [];

    // Scoring run detection
    const run = detectScoringRun(snapshot.recent_scoring);
    if (run) {
      results.push(buildRunInsight(run, snapshot));
    }

    // Clutch alert detection
    if (isClutchSituation(snapshot)) {
      results.push(buildClutchInsight(snapshot));
    }

    return results;
  } catch {
    return [];
  }
}
