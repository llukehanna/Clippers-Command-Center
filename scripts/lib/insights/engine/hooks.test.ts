import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const runEngine = vi.fn();
vi.mock('./run.js', () => ({ runEngine: (...args: unknown[]) => runEngine(...args) }));

import { HOOK_TIMEOUT_MS, postgameAtFinal, pregameAtStart } from './hooks';

describe('runner hooks', () => {
  // Braces: mockReset() returns the mock, which vitest would run as a cleanup hook.
  beforeEach(() => { runEngine.mockReset(); });
  afterEach(() => vi.useRealTimers());

  it('runs the postgame surface for one game and reports the count', async () => {
    runEngine.mockResolvedValue({ context: {}, upserted: 7 });
    expect(await postgameAtFinal('640')).toEqual({ status: 'ok', upserted: 7, message: '7 postgame insights for game 640' });
    expect(runEngine).toHaveBeenCalledWith(expect.objectContaining({ surfaces: ['postgame'], gameId: '640', write: true }));
  });

  it('pregame runs the pregame surface alone, never scoped to a game', async () => {
    runEngine.mockResolvedValue({ context: {}, upserted: 4 });
    expect(await pregameAtStart()).toEqual({ status: 'ok', upserted: 4, message: '4 pregame insights' });
    const opts = runEngine.mock.calls[0][0];
    expect(opts.surfaces).toEqual(['pregame']);
    expect(opts.gameId).toBeUndefined();
    expect(opts.write).toBe(true);
  });

  it('reports skipped when there is nothing to talk about', async () => {
    runEngine.mockResolvedValue({ context: null, upserted: 0 });
    expect(await pregameAtStart()).toMatchObject({ status: 'skipped', upserted: 0 });
    expect(await postgameAtFinal('640')).toMatchObject({ status: 'skipped', upserted: 0 });
  });

  it('never throws into the live runner', async () => {
    runEngine.mockRejectedValue(new Error('connection reset'));
    expect(await postgameAtFinal('640')).toEqual({ status: 'failed', upserted: 0, message: 'postgame insights failed: connection reset' });
    expect(await pregameAtStart()).toEqual({ status: 'failed', upserted: 0, message: 'pregame insights failed: connection reset' });
  });

  it('a HARDEN throw from the engine is a failed result, not an exception', async () => {
    runEngine.mockRejectedValue(new Error('gameId runs cover the postgame surface only'));
    expect(await postgameAtFinal('640')).toEqual({
      status: 'failed', upserted: 0, message: 'postgame insights failed: gameId runs cover the postgame surface only',
    });
  });

  it('a synchronous throw from the engine is also a failed result', async () => {
    runEngine.mockImplementation(() => { throw new Error('boom'); });
    expect(await pregameAtStart()).toMatchObject({ status: 'failed', message: 'pregame insights failed: boom' });
  });

  it('a hung engine times out as failed and the caller carries on', async () => {
    vi.useFakeTimers();
    runEngine.mockReturnValue(new Promise(() => {}));
    let carriedOn = false;
    const run = (async () => {
      const post = await postgameAtFinal('640');
      const pre = await pregameAtStart();
      carriedOn = true; // the runner's own exit path
      return [post, pre];
    })();
    await vi.advanceTimersByTimeAsync(HOOK_TIMEOUT_MS - 1);
    expect(carriedOn).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(HOOK_TIMEOUT_MS);
    const [post, pre] = await run;
    expect(carriedOn).toBe(true);
    expect(post).toEqual({ status: 'failed', upserted: 0, message: 'postgame insights failed: timed out after 5 min' });
    expect(pre).toEqual({ status: 'failed', upserted: 0, message: 'pregame insights failed: timed out after 5 min' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears the timeout timer when the engine finishes', async () => {
    vi.useFakeTimers();
    runEngine.mockResolvedValue({ context: {}, upserted: 1 });
    await postgameAtFinal('640');
    expect(vi.getTimerCount()).toBe(0);
  });
});
