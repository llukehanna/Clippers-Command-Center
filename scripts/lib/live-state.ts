// scripts/lib/live-state.ts
// Builds the live_state document (Live v2 spec §4) from the latest scoreboard,
// box score and play-by-play. Pure. The box score is preferred for header fields
// (score, clock, period) only when it is at least as far along as the scoreboard.
// If the scoreboard is ahead, use its data to avoid serving stale mid-game header
// with a final status. Status is the max of both (ensures final from either).

import { createHash } from 'node:crypto';
import type { BoxscoreGame, BoxscoreTeam, PlayByPlayAction, ScoreboardGame } from '../../src/lib/types/live';
import type { LivePhase, LivePlay, LiveStateDoc, LiveWinProb, WpCalibration } from '../../src/lib/types/live-state';
import { DEFAULT_SIGMA, expectedLacMargin, PERIOD_SECS, winProbability } from '../../src/lib/live/win-prob';
import { buildFlow } from './live-flow';
import { buildLineups } from './live-lineups';
import { clockToSecondsRemaining, parseNBAClock } from './nba-live-client';
import { extractRecentScoring, LAC_TEAM_ID, lineScore, summarizeOtherGames } from './poll-live-logic';

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
  model?: ModelContext;
}

/** What the runner knows before the game: the model's inputs (loaded once per game by loadModelContext). */
export interface ModelContext {
  expected: number;                          // pregame expected LAC margin
  expectedSource: 'spread' | 'home_court';
  sigma: number;
  calibration: WpCalibration | null;
  usualMin: Record<string, number>;          // NBA personId → last-10-game average minutes
}

export function defaultModel(lacIsHome: boolean): ModelContext {
  const e = expectedLacMargin(null, lacIsHome);
  return { expected: e.expected, expectedSource: e.source, sigma: DEFAULT_SIGMA, calibration: null, usualMin: {} };
}

function liveWinProb(
  status: LiveStateDoc['status'],
  period: number,
  clockSec: number,
  lacMargin: number,
  model: ModelContext
): LiveWinProb {
  const { expected, sigma } = model;
  const lac =
    status === 'scheduled'
      ? winProbability({ margin: 0, period: 1, clockSec: PERIOD_SECS, expected, sigma })
      : status === 'final'
        ? lacMargin > 0 ? 1 : lacMargin < 0 ? 0 : 0.5
        : winProbability({ margin: lacMargin, period, clockSec, expected, sigma });
  return {
    lac: Math.round(lac * 1000) / 1000,
    model: 'stern-v1',
    sigma,
    expected_margin: expected,
    expected_source: model.expectedSource,
    calibration: model.calibration,
  };
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

/** Home/away score after the newest play that carries readable scores; 0–0 when none does. */
function pbpScore(actions: PlayByPlayAction[]): { home: number; away: number } {
  for (let i = actions.length - 1; i >= 0; i--) {
    const { scoreHome, scoreAway } = actions[i];
    if (scoreHome === '' || scoreAway === '' || scoreHome == null || scoreAway == null) continue;
    const home = Number(scoreHome);
    const away = Number(scoreAway);
    if (Number.isFinite(home) && Number.isFinite(away)) return { home, away };
  }
  return { home: 0, away: 0 };
}

/**
 * When the doc's newest play happened (spoiler sync's clock, spec §7.3): the
 * newest play-by-play action's timeActual — but only while the header score is
 * the one play-by-play reached. The box score or scoreboard can be ahead of
 * play-by-play, and that basket has no play time yet; dating the doc by the
 * previous play would let a delayed page show it early, so the doc is dated
 * by its fetch instead (late, therefore safe).
 */
function observedAt(actions: PlayByPlayAction[], homeScore: number, awayScore: number, fetchedAt: string): string | null {
  const newest = [...actions].reverse().find((a) => a.timeActual)?.timeActual ?? null;
  const pbp = pbpScore(actions);
  return pbp.home === homeScore && pbp.away === awayScore ? newest : fetchedAt;
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
  const lacIsHome = i.sbGame.homeTeam.teamId === LAC_TEAM_ID;
  const model = i.model ?? defaultModel(lacIsHome);
  const status = statusOf(Math.max(i.sbGame.gameStatus, b?.gameStatus ?? 0));
  const homeScore = head?.homeTeam.score ?? i.sbGame.homeTeam.score;
  const awayScore = head?.awayTeam.score ?? i.sbGame.awayTeam.score;
  const clockSec = clockToSecondsRemaining(isoClock);
  const fetchedAt = new Date(i.now).toISOString();
  const sbLac = lacIsHome ? i.sbGame.homeTeam : i.sbGame.awayTeam;
  const sbOpp = lacIsHome ? i.sbGame.awayTeam : i.sbGame.homeTeam;
  return {
    v: 1,
    source: 'nba',
    nba_game_id: i.sbGame.gameId,
    status,
    status_text: head?.gameStatusText ?? i.sbGame.gameStatusText,
    period,
    clock: parseNBAClock(isoClock),
    home_score: homeScore,
    away_score: awayScore,
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
    observed_at: observedAt(i.actions, homeScore, awayScore, fetchedAt),
    fetched_at: fetchedAt,
    cadence: { phase: i.phase, next_ms: i.nextMs },
    is_stale: false,
    stale_reason: null,
    wp: liveWinProb(status, period, clockSec, lacIsHome ? homeScore - awayScore : awayScore - homeScore, model),
    flow: status === 'scheduled' ? null : buildFlow(i.actions, lacIsHome, model),
    lineups:
      status !== 'scheduled' && b
        ? buildLineups({
            actions: i.actions,
            lacBox: lacIsHome ? b.homeTeam : b.awayTeam,
            oppBox: lacIsHome ? b.awayTeam : b.homeTeam,
            lacIsHome,
            period,
            clockSec,
            usualMin: model.usualMin,
            fallback: {
              timeouts: { lac: sbLac.timeoutsRemaining ?? null, opp: sbOpp.timeoutsRemaining ?? null },
              bonus: { lac: sbLac.inBonus === '1', opp: sbOpp.inBonus === '1' },
            },
          })
        : null,
  };
}

/**
 * Content hash: changes when anything a fan would see changes, including the
 * phase. An observed_at that is only the fetch time (the header is ahead of
 * play-by-play) isn't content: the saved doc keeps the first fetch's time.
 */
export function fingerprint(body: LiveStateBody): string {
  const observed_at = body.observed_at === body.fetched_at ? 'fetched' : body.observed_at;
  const comparable = { ...body, observed_at, fetched_at: '', cadence: { phase: body.cadence.phase, next_ms: 0 } };
  return createHash('sha1').update(JSON.stringify(comparable)).digest('hex');
}
