// Shared template sweep for engine template tests (not a test file).
import { expect } from 'vitest';
import type { Frame, Surface } from '../../../../../src/lib/insights/types';
import { MAX_HEADLINE, phrasingsFor } from '../render';
import type { RenderContext, Rendered } from '../templates/shared';
import type { Fact } from '../types';
import { COMPLETED_SEASON, CURRENT_SEASON, makeCtx } from './facts';

export const fr = (type: Frame['type'], extra: Partial<Frame> = {}): Frame =>
  ({ type, strength: 0.5, who: 'group', text: '', proof_rows: [], ...extra });

export const SWEEP_FRAMES: Frame[] = [
  fr('records_best', { records_label: '2020-21', records_seasons: 6 }), fr('none'), fr('career_high', { prior_value: 48 }),
  fr('only_one', { records_label: '2020-21' }), fr('joins_company', { names: ['Paul George', 'Kawhi Leonard'], records_label: '2020-21' }),
  fr('first_since', { since_date: '2021-03-01' }), fr('first_since', { since_date: '2021-03-01', who: 'subject' }),
  fr('first_since', { since_label: '2021-22' }), fr('longest_since', { since_date: '2021-03-01' }),
  fr('clippers_rank', { rank: 3, records_label: '2020-21' }), fr('season_high'), fr('season_high', { who: 'subject' }),
  fr('nth_time', { count: 3 }), fr('league_rank', { rank: 1, total: 2400 }), fr('league_rank', { rank: 7, total: 30 }),
  fr('milestone', { step: 1 }),
];

/** Postgame rows are frozen, so buildDraft words their season "so far in {label}" whatever the date (run.ts). */
export const rcFor = (surface: Surface, current = true): RenderContext => {
  const season = current ? CURRENT_SEASON : COMPLETED_SEASON;
  return {
    surface, teams: makeCtx().teams,
    season: surface === 'postgame' ? { ...season, isCurrent: false, phrase: `so far in ${season.label}` } : season,
  };
};

export const say = (f: Fact, frame: Frame, rc: RenderContext, i = 0): Rendered => phrasingsFor(f, frame)[i](f, frame, rc);

/** Every phrasing for every sweep frame, in and after the season: clean text, headline <= 90. */
export function expectCleanPhrasings(f: Fact): void {
  for (const frame of SWEEP_FRAMES) for (const current of [true, false]) {
    for (const p of phrasingsFor(f, frame)) {
      const out = p(f, frame, rcFor(f.surface, current));
      expect(`${out.headline} | ${out.context}`, `${f.kind}/${f.stat}/${frame.type}`).not.toMatch(/undefined|NaN|\bnull\b|\[object/);
      expect(out.headline.length, out.headline).toBeLessThanOrEqual(MAX_HEADLINE);
    }
  }
}
