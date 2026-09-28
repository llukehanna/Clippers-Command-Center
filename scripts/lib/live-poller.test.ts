import { describe, it, expect, vi } from 'vitest';
import type { NBABoxscoreResponse, NBAPlayByPlayResponse, PlayByPlayAction, BoxscoreGame } from '../../src/lib/types/live';
import type { CondResult } from './nba-live-client.js';
import { createPoller, type PollerDeps } from './live-poller.js';
import { action, box, GAME_ID, sbGame, scoreboard } from './live-fixtures.js';

const TIP = Date.UTC(2026, 9, 22, 2, 30, 0);

const ok = <T>(body: T, maxAgeMs: number | null = null): CondResult<T> =>
  ({ status: 200, body, validators: { etag: '"e"', lastModified: null }, freshness: { maxAgeMs, ageMs: 0 } });
const notModified = <T>(): CondResult<T> =>
  ({ status: 304, validators: { etag: '"e"', lastModified: null }, freshness: { maxAgeMs: null, ageMs: 0 } });
const pbpOf = (...actions: PlayByPlayAction[]): NBAPlayByPlayResponse =>
  ({ meta: { version: 1, code: 200, request: '', time: '' }, game: { gameId: GAME_ID, actions } });
const boxOf = (game: BoxscoreGame): NBABoxscoreResponse =>
  ({ meta: { version: 1, code: 200, request: '', time: '' }, game });

function harness(start = TIP + 60_000) {
  const h = {
    t: start,
    sb: scoreboard(sbGame({ status: 2 })),
    pbp: ok(pbpOf(action(1))) as CondResult<NBAPlayByPlayResponse>,
    box: ok(boxOf(box())) as CondResult<NBABoxscoreResponse>,
    fail: null as Error | null,
  };
  const deps = {
    fetchScoreboard: vi.fn(async () => { if (h.fail) throw h.fail; return h.sb; }),
    fetchPbp: vi.fn(async () => { if (h.fail) throw h.fail; return h.pbp; }),
    fetchBox: vi.fn(async () => h.box),
    saveState: vi.fn(async () => {}),
    saveMoment: vi.fn(async () => {}),
    now: () => h.t,
    random: () => 0.5,
  } satisfies PollerDeps;
  return { h, deps };
}

describe('createPoller', () => {
  it('pre-tip: polls only the scoreboard every 30 s and saves a scheduled state', async () => {
    const { h, deps } = harness(TIP - 5 * 60_000);
    h.sb = scoreboard(sbGame({ status: 1 }));
    const r = await createPoller(GAME_ID, TIP, deps).tick();
    expect(r).toMatchObject({ status: 'ok', phase: 'PREGAME', delayMs: 30_000, saved: true, final: false });
    expect(r.doc?.status).toBe('scheduled');
    expect(deps.fetchPbp).not.toHaveBeenCalled();
  });

  it('past the scheduled tip but not started: watches for the tip every 10 s', async () => {
    const { h, deps } = harness(TIP + 60_000);
    h.sb = scoreboard(sbGame({ status: 1 }));
    expect((await createPoller(GAME_ID, TIP, deps).tick()).delayMs).toBe(10_000);
  });

  it('is not_on_scoreboard when the game is missing', async () => {
    const { h, deps } = harness();
    h.sb = scoreboard(sbGame({ gameId: '0022600001' }));
    expect(await createPoller(GAME_ID, TIP, deps).tick()).toMatchObject({ status: 'not_on_scoreboard', delayMs: 60_000, doc: null });
  });

  it('live: fetches the box only when play-by-play advances, and saves only on change', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps, 41);

    const first = await poller.tick();
    expect(first).toMatchObject({ status: 'ok', phase: 'LIVE', delayMs: 3_000, saved: true });
    expect(first.doc?.seq).toBe(42);
    expect(deps.fetchBox).toHaveBeenCalledTimes(1);

    h.t += 3_000;
    h.pbp = notModified();
    const second = await poller.tick();
    expect(second.saved).toBe(false);
    expect(deps.fetchBox).toHaveBeenCalledTimes(1);
    expect(deps.fetchScoreboard).toHaveBeenCalledTimes(1);   // not again within 60 s

    h.t += 3_000;
    h.pbp = ok(pbpOf(action(1), action(2, { scoreHome: '4' })));
    h.box = ok(boxOf(box({ home: 4 })));
    const third = await poller.tick();
    expect(third.saved).toBe(true);
    expect(third.doc).toMatchObject({ seq: 43, home_score: 4 });
    expect(deps.fetchBox).toHaveBeenCalledTimes(2);
  });

  it('rewrites the state as a heartbeat after 15 s without changes', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps);
    await poller.tick();
    h.pbp = notModified();
    h.t += 9_000;
    expect((await poller.tick()).saved).toBe(false);
    h.t += 7_000;
    const beat = await poller.tick();
    expect(beat.saved).toBe(true);
    expect(beat.doc?.seq).toBe(2);
  });

  it('slows down on a timeout and at halftime, and records the period end once', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps);
    h.pbp = ok(pbpOf(action(1), action(2, { actionType: 'timeout', subType: 'full' })));
    expect((await poller.tick()).phase).toBe('STOPPAGE');
    expect((await poller.tick()).delayMs).toBe(8_000);

    h.t += 8_000;
    h.pbp = ok(pbpOf(action(1), action(2), action(3, { actionType: 'period', subType: 'end', period: 2, clock: 'PT00M00.00S' })));
    h.box = ok(boxOf(box({ period: 2, clock: 'PT00M00.00S' })));
    const half = await poller.tick();
    expect(half).toMatchObject({ phase: 'HALFTIME', delayMs: 30_000 });
    h.t += 30_000;
    await poller.tick();
    expect(deps.saveMoment).toHaveBeenCalledTimes(1);
    expect(deps.saveMoment).toHaveBeenCalledWith(expect.objectContaining({ period: 2 }), 'period_end');
  });

  it('honors the CDN freshness floor', async () => {
    const { h, deps } = harness();
    h.pbp = ok(pbpOf(action(1)), 5_000);
    expect((await createPoller(GAME_ID, TIP, deps).tick()).delayMs).toBe(5_000);
  });

  it('finishes when the box score goes final', async () => {
    const { h, deps } = harness();
    h.pbp = ok(pbpOf(action(1), action(2, { actionType: 'game', subType: 'end', period: 4 })));
    h.box = ok(boxOf(box({ status: 3, period: 4, home: 110, away: 101 })));
    const r = await createPoller(GAME_ID, TIP, deps).tick();
    expect(r).toMatchObject({ phase: 'FINAL', final: true });
    expect(r.doc?.status).toBe('final');
    expect(deps.saveMoment).toHaveBeenCalledWith(expect.anything(), 'final');
  });

  it('backs off on fetch errors and recovers', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps);
    h.fail = new Error('NBA CDN 503');
    expect(await poller.tick()).toMatchObject({ status: 'error', delayMs: 3_000, saved: false });
    expect((await poller.tick()).delayMs).toBe(6_000);
    h.fail = null;
    expect(await poller.tick()).toMatchObject({ status: 'ok', delayMs: 3_000 });
  });

  it('a failed save is retried on the next tick with a higher seq', async () => {
    const { deps } = harness();
    deps.saveState.mockRejectedValueOnce(new Error('db down'));
    const poller = createPoller(GAME_ID, TIP, deps);
    expect((await poller.tick()).saved).toBe(false);
    const retry = await poller.tick();
    expect(retry.saved).toBe(true);
    expect(retry.doc?.seq).toBe(2);
  });

  // ── Fix round 1 ──────────────────────────────────────────────────────────

  it('reaches FINAL from a lagging box after a game-end action, even once the scoreboard rolls the game off (frozen sbGame)', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps);

    // Tick 1: establish sbGame + box caches at LIVE (status 2 both).
    await poller.tick();

    // Tick 2: the game-end action arrives; the box fetched right after still reads status 2 (lagging).
    h.t += 3_000;
    h.pbp = ok(pbpOf(action(1), action(2, { actionType: 'game', subType: 'end', period: 4 })));
    h.box = ok(boxOf(box({ period: 4 })));
    const afterEnd = await poller.tick();
    expect(afterEnd.final).toBe(false);
    expect(afterEnd.phase).not.toBe('FINAL');
    expect(deps.fetchBox).toHaveBeenCalledTimes(2);

    // Tick 3: past the 60 s scoreboard cadence, the scoreboard rolls the game off entirely.
    // sbGame stays frozen at the last known (still-status-2) entry via the `?? sbGame` fallback.
    // No new pbp action arrives (304) — the box must still be retried because the last action was a game end.
    h.t += 60_000;
    h.sb = scoreboard(sbGame({ gameId: '0022600001' }));
    h.pbp = notModified();
    const stillLagging = await poller.tick();
    expect(stillLagging.status).toBe('ok');
    expect(stillLagging.final).toBe(false);
    expect(deps.fetchBox).toHaveBeenCalledTimes(3); // refetched despite no pbp advance

    // Tick 4: the box source finally reports final.
    h.t += 3_000;
    h.box = ok(boxOf(box({ status: 3, period: 4, home: 110, away: 101 })));
    const final = await poller.tick();
    expect(final).toMatchObject({ phase: 'FINAL', final: true });
    expect(final.doc?.status).toBe('final');
    expect(final.doc).toMatchObject({ home_score: 110, away_score: 101 });
    expect(deps.saveMoment).toHaveBeenCalledWith(expect.anything(), 'final');
  });

  it('retries the box fetch on a later tick after a failed fetch, even without a new pbp advance', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps, 41);
    await poller.tick(); // establish caches (box already fetched once)
    expect(deps.fetchBox).toHaveBeenCalledTimes(1);

    h.t += 3_000;
    h.pbp = ok(pbpOf(action(1), action(2, { scoreHome: '4' }))); // basket, pbp advances
    deps.fetchBox.mockRejectedValueOnce(new Error('NBA CDN 503'));
    const errored = await poller.tick();
    expect(errored.status).toBe('error');
    expect(deps.fetchBox).toHaveBeenCalledTimes(2); // attempted, but failed

    h.t += 3_000;
    h.pbp = notModified(); // no further pbp advance
    h.box = ok(boxOf(box({ home: 4 })));
    const recovered = await poller.tick();
    expect(recovered.status).toBe('ok');
    expect(recovered.saved).toBe(true);
    expect(deps.fetchBox).toHaveBeenCalledTimes(3); // retried despite the 304
    expect(recovered.doc).toMatchObject({ home_score: 4 });
  });

  it('keeps polling play-by-play when the periodic scoreboard refresh fails once live', async () => {
    const { h, deps } = harness();
    const poller = createPoller(GAME_ID, TIP, deps);
    await poller.tick(); // establishes started() state (sbGame + box both status 2)

    h.t += 60_000; // due for the periodic scoreboard refresh
    deps.fetchScoreboard.mockRejectedValueOnce(new Error('NBA CDN 503'));
    h.pbp = ok(pbpOf(action(1), action(2, { scoreHome: '4' })));
    h.box = ok(boxOf(box({ home: 4 })));
    const r = await poller.tick();
    expect(r.status).toBe('ok');
    expect(r.saved).toBe(true);
    expect(deps.fetchPbp).toHaveBeenCalledTimes(2);
    expect(deps.fetchScoreboard).toHaveBeenCalledTimes(2); // attempted, but failed and swallowed
  });

  it('a failed period-end moment save is retried until it succeeds, then stops', async () => {
    const { h, deps } = harness();
    deps.saveMoment.mockRejectedValueOnce(new Error('db down'));
    const poller = createPoller(GAME_ID, TIP, deps);
    h.pbp = ok(pbpOf(action(1), action(2, { actionType: 'period', subType: 'end', period: 1, clock: 'PT00M00.00S' })));
    h.box = ok(boxOf(box({ period: 1, clock: 'PT00M00.00S' })));
    await poller.tick();
    expect(deps.saveMoment).toHaveBeenCalledTimes(1);

    h.t += 8_000;
    await poller.tick();
    expect(deps.saveMoment).toHaveBeenCalledTimes(2);

    h.t += 8_000;
    await poller.tick();
    expect(deps.saveMoment).toHaveBeenCalledTimes(2); // deduped after the successful save
  });
});
