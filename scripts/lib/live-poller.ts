// scripts/lib/live-poller.ts
// One game's live polling loop body (Live v2 spec §3). Each tick fetches only
// what is due — the scoreboard pre-tip and once a minute after, play-by-play as
// the heartbeat, the box score only when play-by-play advanced — derives the
// live state, saves it when it changed (or as a 15 s heartbeat), and returns
// how long to wait. All I/O is injected, so the loop is unit-testable.

import type {
  BoxscoreGame,
  NBABoxscoreResponse,
  NBAPlayByPlayResponse,
  NBAScoreboardResponse,
  PlayByPlayAction,
  ScoreboardGame,
} from '../../src/lib/types/live';
import type { LivePhase, LiveStateDoc } from '../../src/lib/types/live-state';
import { clockToSecondsRemaining, type CondResult, type Validators } from './nba-live-client.js';
import { matchScoreboardGame } from './poll-live-logic.js';
import {
  classifyPhase,
  HEARTBEAT_MS,
  isPeriodEnd,
  nextDelayMs,
  NOT_LISTED_DELAY_MS,
  SCOREBOARD_EVERY_MS,
} from './live-cadence.js';
import { buildLiveState, fingerprint } from './live-state.js';

export interface PollerDeps {
  fetchScoreboard(): Promise<NBAScoreboardResponse>;
  fetchPbp(gameId: string, prev?: Validators): Promise<CondResult<NBAPlayByPlayResponse>>;
  fetchBox(gameId: string, prev?: Validators): Promise<CondResult<NBABoxscoreResponse>>;
  saveState(doc: LiveStateDoc): Promise<void>;
  saveMoment(doc: LiveStateDoc, reason: 'period_end' | 'final'): Promise<void>;
  now(): number;
  random?(): number;
  log?(msg: string): void;
}

export interface TickResult {
  status: 'ok' | 'not_on_scoreboard' | 'error';
  phase: LivePhase | null;
  delayMs: number;
  doc: LiveStateDoc | null;     // latest state, saved this tick or not
  saved: boolean;
  final: boolean;
}

export interface Poller {
  tick(): Promise<TickResult>;
}

export function createPoller(nbaGameId: string, tipAt: number | null, deps: PollerDeps, initialSeq = 0): Poller {
  const log = deps.log ?? (() => {});
  let seq = initialSeq;
  let savedFp = '';
  let savedAt = Number.NEGATIVE_INFINITY;
  let doc: LiveStateDoc | null = null;
  let phase: LivePhase | null = null;
  let phaseSince = 0;
  let failures = 0;
  let sbGames: ScoreboardGame[] = [];
  let sbGame: ScoreboardGame | null = null;
  let sbAt = Number.NEGATIVE_INFINITY;
  let actions: PlayByPlayAction[] = [];
  let box: BoxscoreGame | null = null;
  let pbpValidators: Validators | undefined;
  let boxValidators: Validators | undefined;
  let notBefore = 0;
  // Set whenever something means the box is (or may be) stale; cleared only once
  // a box fetch actually succeeds, so a failed attempt or a quiet pbp tick don't
  // lose the signal that a refetch is still owed.
  let boxDue = false;
  const moments = new Set<string>();

  const started = () => Math.max(sbGame?.gameStatus ?? 0, box?.gameStatus ?? 0) >= 2;

  function isGameEnd(a: PlayByPlayAction | null | undefined): boolean {
    return !!a && a.actionType.toLowerCase() === 'game' && (a.subType ?? '').toLowerCase() === 'end';
  }

  async function refreshFeeds(now: number): Promise<void> {
    const needsScoreboard = !sbGame || !started() || now - sbAt >= SCOREBOARD_EVERY_MS;
    if (needsScoreboard) {
      // Only a periodic refresh while already live may fail without failing the
      // tick — pre-tip/tip-watch, the scoreboard is the only feed there is.
      const priorlyStarted = sbGame !== null && started();
      try {
        const sb = await deps.fetchScoreboard();
        sbGames = sb.scoreboard.games;
        sbAt = now;
        // Late West Coast games can outlive the scoreboard's rollover: keep the last match.
        sbGame = matchScoreboardGame(sbGames, nbaGameId) ?? sbGame;
      } catch (err) {
        if (!priorlyStarted) throw err;
        log(`scoreboard fetch failed, keeping cached data: ${(err as Error).message}`);
        // Leave sbAt as-is so the periodic refresh is retried next tick.
      }
    }
    if (!sbGame || !started()) return;

    const pbp = await deps.fetchPbp(sbGame.gameId, pbpValidators);
    pbpValidators = pbp.validators;
    if (pbp.freshness.maxAgeMs !== null) {
      notBefore = now + Math.max(0, pbp.freshness.maxAgeMs - pbp.freshness.ageMs);
    }
    if (pbp.status === 200) {
      const newest = pbp.body.game.actions.at(-1)?.actionNumber ?? -1;
      const advanced = newest !== (actions.at(-1)?.actionNumber ?? -1);
      actions = pbp.body.game.actions;
      if (advanced) boxDue = true;
    }
    if (!box) boxDue = true;
    // The box can lag behind a game-end action (no further pbp action will ever
    // arrive to trigger a refetch) or behind the scoreboard going final ahead of
    // it — either way, keep asking until the box itself reports final.
    if (isGameEnd(actions.at(-1)) && (box?.gameStatus ?? 0) < 3) boxDue = true;
    if (sbGame.gameStatus > (box?.gameStatus ?? 0)) boxDue = true;

    if (boxDue) {
      const b = await deps.fetchBox(sbGame.gameId, boxValidators);
      boxValidators = b.validators;
      if (b.status === 200) box = b.body.game;
      boxDue = false;
    }
  }

  async function tick(): Promise<TickResult> {
    const now = deps.now();
    try {
      await refreshFeeds(now);
      failures = 0;
    } catch (err) {
      failures += 1;
      log(`fetch failed (${failures}x): ${(err as Error).message}`);
      const delayMs = nextDelayMs({ phase: phase ?? 'LIVE', phaseSince, now, failures, notBeforeMs: 0, random: deps.random });
      return { status: 'error', phase, delayMs, doc, saved: false, final: false };
    }
    if (!sbGame) {
      return { status: 'not_on_scoreboard', phase: null, delayMs: NOT_LISTED_DELAY_MS, doc: null, saved: false, final: false };
    }

    const last = actions.at(-1) ?? null;
    const lastAction = last ? { actionType: last.actionType, subType: last.subType ?? '', period: last.period } : null;
    const home = box?.homeTeam.score ?? sbGame.homeTeam.score;
    const away = box?.awayTeam.score ?? sbGame.awayTeam.score;
    const next = classifyPhase({
      gameStatus: Math.max(sbGame.gameStatus, box?.gameStatus ?? 0),
      now,
      tipAt,
      period: last?.period ?? box?.period ?? sbGame.period,
      clockSec: clockToSecondsRemaining(last?.clock ?? box?.gameClock ?? sbGame.gameClock),
      margin: home - away,
      lastAction,
    });
    if (next !== phase) {
      phase = next;
      phaseSince = now;
    }
    const delayMs = nextDelayMs({ phase, phaseSince, now, failures: 0, notBeforeMs: notBefore, random: deps.random });

    const body = buildLiveState({ sbGame, sbGames, box, actions, phase, nextMs: delayMs, now });
    const fp = fingerprint(body);
    let saved = false;
    if (fp !== savedFp || now - savedAt >= HEARTBEAT_MS) {
      seq += 1;
      doc = { ...body, seq };
      try {
        await deps.saveState(doc);
        savedFp = fp;
        savedAt = now;
        saved = true;
      } catch (err) {
        log(`save failed: ${(err as Error).message}`);
      }
    } else if (doc) {
      doc = { ...doc, fetched_at: body.fetched_at, cadence: body.cadence };
    }

    if (doc && isPeriodEnd(lastAction)) await recordMoment(`period_end:${lastAction!.period}`, doc, 'period_end');
    const final = phase === 'FINAL';
    if (doc && final) await recordMoment('final', doc, 'final');
    return { status: 'ok', phase, delayMs, doc, saved, final };
  }

  async function recordMoment(key: string, d: LiveStateDoc, reason: 'period_end' | 'final'): Promise<void> {
    if (moments.has(key)) return;
    try {
      await deps.saveMoment(d, reason);
      moments.add(key); // only after success, so a failed save is retried on a later tick
    } catch (err) {
      log(`moment ${key} not saved: ${(err as Error).message}`);
    }
  }

  return { tick };
}
