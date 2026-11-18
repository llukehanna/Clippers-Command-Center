import { describe, it, expect } from 'vitest';
import { formatReplay, parseReplayArgs, toComposable } from './replay';
import type { InsightDraft } from './types';

const draft = (key: string, over: Partial<InsightDraft> = {}): InsightDraft => ({
  key, detector: 'season.streaks', surface: 'season', scope: 'between_games', category: 'streak',
  team_id: '1', game_id: null, player_id: '1', season_id: 2025, headline: `Headline ${key}`, detail: `Context ${key}`,
  importance: 70, proof_sql: 'SELECT 1', proof_params: {}, proof_result: [{ part: 'fact', data: {} }],
  frame: { type: 'records_best', strength: 0.9, who: 'group', text: `Context ${key}`, proof_rows: [] },
  evidence: null, entities: [],
  score_parts: {
    p: 0.0004, k: 1, n: 100, p_ref: 0.01, power: 5, rarity: 1, frame_strength: 0.9, base: 0.96, salience: 1,
    salience_class: 'roster_core', age_days: 0, half_life_days: 14, recency: 1, polarity: 1, novelty: 0.1,
    unchanged_since: '2026-02-25', importance: 70,
  },
  ...over,
});

describe('parseReplayArgs', () => {
  it('needs --as-of, never writes, and replays whole surfaces', () => {
    expect(() => parseReplayArgs([], '2026-11-18')).toThrow(/--as-of/);
    expect(parseReplayArgs(['--as-of=2026-02-25', '--surface=season'], '2026-11-18'))
      .toMatchObject({ asOf: '2026-02-25', surfaces: ['season'], write: false });
    expect(() => parseReplayArgs(['--as-of=2026-02-25', '--surface=postgame', '--game=5'], '2026-11-18')).toThrow(/whole surfaces/);
  });
});

describe('formatReplay', () => {
  it('prints each placement with its score parts and the drop counts', () => {
    const out = formatReplay({
      drafts: [draft('aaaaaaaaaaaaaaaa'), draft('bbbbbbbbbbbbbbbb', { surface: 'pregame', category: 'h2h', player_id: null, importance: 20 })],
      dropped: [{ key: 'c', detector: 'season.streaks', reason: 'trivial', kind: 'streak', stat: 'scoring_20', subject: 'Star Clipper' }],
    }, ['season', 'pregame']);
    expect(out).toContain('── season_feed ──');
    expect(out).toContain('── up_next ──');
    expect(out).not.toContain('── last_game ──');
    expect(out).toContain('[ 70] Headline aaaaaaaaaaaaaaaa');
    expect(out).toContain('frame=records_best(0.9) p=4.0e-4');
    expect(out).toContain('2 insights; dropped trivial 1');
  });
  it('maps a draft to a composable insight', () => {
    expect(toComposable(draft('abcdef0123456789'))).toMatchObject({ insight_id: 'abcdef012345', surface: 'season', player_id: '1' });
  });
});
