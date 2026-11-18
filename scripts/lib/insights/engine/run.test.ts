import { describe, it, expect, vi } from 'vitest';
import { makeCtx, makeFact } from './__fixtures__/facts';
import type { Row } from './types';

// run.ts imports the DB-backed modules; buildDraft itself needs no database (the runner is injected).
vi.mock('../../db', () => ({ sql: {} }));

const { buildDraft } = await import('./run');

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
