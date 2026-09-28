// scripts/lib/live-state.ts
// Builds the live_state document (Live v2 spec §4) from the latest scoreboard,
// box score and play-by-play. Pure. The box score is preferred for header fields
// (score, clock, period) only when it is at least as far along as the scoreboard.
// If the scoreboard is ahead, use its data to avoid serving stale mid-game header
// with a final status. Status is the max of both (ensures final from either).

import { createHash } from 'node:crypto';
import type { BoxscoreGame, BoxscoreTeam, PlayByPlayAction, ScoreboardGame } from '../../src/lib/types/live';
import type { LivePhase, LivePlay, LiveStateDoc } from '../../src/lib/types/live-state';
import { parseNBAClock } from './nba-live-client.js';
import { extractRecentScoring, lineScore, summarizeOtherGames } from './poll-live-logic.js';

export const LAST_PLAYS = 15;
export const RECENT_SCORING_LOOKBACK_SECONDS = 120;

export type LiveStateBody = Omit<LiveStateDoc, 'seq'>;

export interface StateInputs {
  sbGame: ScoreboardGame;          // this game's scoreboard entry
  sbGames: ScoreboardGame[];       // the whole scoreboard
  box: BoxscoreGame | null;
  actions: PlayByPlayAction[];     // full play-by-play so far (empty pre-tip)
  phase: LivePhase;
  nextMs: number;
  now: number;
}

export function toLivePlay(a: PlayByPlayAction): LivePlay {
  return {
    action_number: a.actionNumber,
    period: a.period,
    clock: parseNBAClock(a.clock),
    team_tricode: a.teamTricode || null,
    person_id: a.personId || null,
    action_type: a.actionType,
    sub_type: a.subType ?? '',
    description: a.description ?? '',
    score_home: Number(a.scoreHome) || 0,
    score_away: Number(a.scoreAway) || 0,
    time_actual: a.timeActual ?? null,
  };
}

export function lastPlays(actions: PlayByPlayAction[], n = LAST_PLAYS): LivePlay[] {
  return actions.slice(-n).reverse().map(toLivePlay);
}

function boxPeriods(home: BoxscoreTeam, away: BoxscoreTeam): LiveStateDoc['periods'] {
  const awayBy = new Map((away.periods ?? []).map((p) => [p.period, p.score]));
  return (home.periods ?? []).map((p) => ({ period: p.period, home: p.score, away: awayBy.get(p.period) ?? 0 }));
}

function statusOf(code: number): LiveStateDoc['status'] {
  return code >= 3 ? 'final' : code === 2 ? 'in_progress' : 'scheduled';
}

export function buildLiveState(i: StateInputs): LiveStateBody {
  const b = i.box;
  // Use the box for header fields only if it is at least as far along as the
  // scoreboard AND it actually has a clock/period to show. The stats.nba.com
  // fallback (nba-live-client.ts's 403 path) always reports period: 1,
  // gameClock: '' — that must never win the header even when its gameStatus
  // matches or leads, unless it has since gone final (gameStatus >= 3), which
  // it reports reliably even with an empty clock.
  const head =
    i.box && i.box.gameStatus >= i.sbGame.gameStatus && (i.box.gameClock !== '' || i.box.gameStatus >= 3)
      ? i.box
      : null;
  const period = head?.period ?? i.sbGame.period;
  const isoClock = head?.gameClock ?? i.sbGame.gameClock;
  const observed = [...i.actions].reverse().find((a) => a.timeActual)?.timeActual ?? null;
  return {
    v: 1,
    source: 'nba',
    nba_game_id: i.sbGame.gameId,
    status: statusOf(Math.max(i.sbGame.gameStatus, b?.gameStatus ?? 0)),
    status_text: head?.gameStatusText ?? i.sbGame.gameStatusText,
    period,
    clock: parseNBAClock(isoClock),
    home_score: head?.homeTeam.score ?? i.sbGame.homeTeam.score,
    away_score: head?.awayTeam.score ?? i.sbGame.awayTeam.score,
    periods: head ? boxPeriods(head.homeTeam, head.awayTeam) : lineScore(i.sbGame),
    home_box: b?.homeTeam ?? null,
    away_box: b?.awayTeam ?? null,
    recent_scoring: i.actions.length
      ? extractRecentScoring(
          i.actions,
          { period, clock: isoClock },
          {
            homeTeamId: i.sbGame.homeTeam.teamId,
            awayTeamId: i.sbGame.awayTeam.teamId,
            homeTricode: i.sbGame.homeTeam.teamTricode,
            awayTricode: i.sbGame.awayTeam.teamTricode,
          },
          RECENT_SCORING_LOOKBACK_SECONDS
        )
      : [],
    last_plays: lastPlays(i.actions),
    other_games: summarizeOtherGames(i.sbGames, i.sbGame.gameId),
    observed_at: observed,
    fetched_at: new Date(i.now).toISOString(),
    cadence: { phase: i.phase, next_ms: i.nextMs },
    is_stale: false,
    stale_reason: null,
  };
}

/** Content hash: changes when anything a fan would see changes, including the phase. */
export function fingerprint(body: LiveStateBody): string {
  const comparable = { ...body, fetched_at: '', cadence: { phase: body.cadence.phase, next_ms: 0 } };
  return createHash('sha1').update(JSON.stringify(comparable)).digest('hex');
}
