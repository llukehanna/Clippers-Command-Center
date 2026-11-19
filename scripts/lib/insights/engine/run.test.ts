import { describe, it, expect, vi } from 'vitest';
import { makeCtx, makeFact } from './__fixtures__/facts';
import type { Row } from './types';

// run.ts imports the DB-backed modules; buildDraft itself needs no database (the runner is injected).
vi.mock('../../db', () => ({ sql: {} }));

const { buildDraft, loadLateJoiners } = await import('./run');
const { refsFor } = await import('./references');

describe('late joiners load before framing (FW-6)', () => {
  const night = makeFact({
    kind: 'player_game_stat', surface: 'postgame', stat: 'pts', value: 41, gameId: '500',
    window: { type: 'game', game_id: '500', season_id: 2025 }, context: { date: '2025-11-28', opponent_id: '2', result: 'W' },
    data: { thing: '41-point game', best: 'most points in a game', by: 'by a Clipper' },
  });
  it('loads the set once per season and date through the runner, and the subject set follows it', async () => {
    const ctx = makeCtx({ league: { complete: false, reason: 'x' } });
    const seen: { sql: string; params: unknown[] }[] = [];
    const lateRun = async (q: { sql: string; params: unknown[] }): Promise<Row[]> => {
      seen.push(q);
      return [{ player_id: night.subject.id }];
    };
    await loadLateJoiners(night, ctx, lateRun);
    await loadLateJoiners({ ...night, stat: 'reb' }, ctx, lateRun);
    expect(seen).toHaveLength(1);
    expect(seen[0].params).toEqual(['1', 2025, '2025-11-28']);
    expect(refsFor(night, ctx)!.subject).toBeNull();
    expect(refsFor({ ...night, subject: { type: 'player', id: '2', name: 'Big Clipper' } }, ctx)!.subject).not.toBeNull();
  });
  it('runs no query while the league is complete', async () => {
    const ctx = makeCtx();
    const none = vi.fn(async () => [] as Row[]);
    await loadLateJoiners(night, ctx, none);
    expect(none).not.toHaveBeenCalled();
    expect(refsFor(night, ctx)!.subject).not.toBeNull();
  });
  it('buildDraft loads them before framing', async () => {
    const ctx = makeCtx({ league: { complete: false, reason: 'x' } });
    await buildDraft(night, 'b'.repeat(64), 'postgame.test', ctx, run);
    expect(ctx.lateJoiners?.get('2025:2025-11-28')).toEqual(new Set());
  });
});

const factRow: Row = { part: 'fact', data: { player_id: '1' } };
/** Answers only the combined proof; every frame question gets no rows. */
const run = async (q: { sql: string }): Promise<Row[]> => (q.sql.startsWith('WITH fact_rows') ? [factRow] : []);

describe('buildDraft season wording (R2)', () => {
  const fact = makeFact({ gameId: '500', window: { type: 'game', game_id: '500', season_id: 2025 } });
  const key = 'a'.repeat(64);

  it('words a postgame claim by the season label, so it stays true after the claim freezes', async () => {
    const post = await buildDraft({ ...fact, surface: 'postgame' }, key, 'postgame.test', makeCtx(), run);
    if ('reason' in post) throw new Error(post.reason);
    expect(post.headline).toContain('2025-26');
  });

  it('keeps "this season" on the season surface while the season is current', async () => {
    const ctx = makeCtx();
    const season = await buildDraft(fact, key, 'season.test', ctx, run);
    const post = await buildDraft({ ...fact, surface: 'postgame' }, key, 'postgame.test', ctx, run);
    if ('reason' in season || 'reason' in post) throw new Error('dropped');
    // The streak template words a current season in the present perfect and a labelled one by its label.
    expect(season.headline).toMatch(/ has /);
    expect(season.headline).not.toContain('2025-26');
    expect(post.headline).toContain('2025-26');
  });
});
