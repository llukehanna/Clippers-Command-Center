import { describe, it, expect } from 'vitest';
import { crossedThreshold } from '../crossed';
import { computedFrames } from '../strength';
import { isTrivial } from '../score';
import { makeFact } from '../__fixtures__/facts';
import { expectCleanPhrasings, fr, rcFor, say } from '../__fixtures__/sweep';

const base = { surface: 'postgame' as const, kind: 'milestone_crossed' as const, gameId: '500',
  window: { type: 'game' as const, game_id: '500', season_id: 2025 }, context: { date: '2026-01-10', opponent_id: '2', home: true, result: 'W' as const } };
const season = makeFact({ ...base, stat: 'season_points', value: 1000, keyExtra: '1000',
  data: { threshold: 1000, step: 0, total_value: 1012, unit: 'points', label: '1,000 points', formatted: '1,012 points', thing: '1,000-point season', best: 'first 1,000-point season', by: 'by a Clipper', career: false } });
const career = makeFact({ ...base, stat: 'career_points', value: 10000, keyExtra: '10000',
  data: { threshold: 10000, step: 1, total_value: 10021, unit: 'points', label: '10,000 points', formatted: '10,021 points', thing: '10,000-point career', best: '10,000-point career', by: 'by a Clipper', career: true } });

describe('milestones crossed', () => {
  it('finds the highest threshold crossed in the game', () => {
    expect(crossedThreshold(990, 1012, [1000, 1250])).toBe(1000);
    expect(crossedThreshold(1000, 1012, [1000, 1250])).toBeNull();
    expect(crossedThreshold(1240, 1510, [1000, 1250, 1500])).toBe(1500);
  });
  it('is always news and carries a milestone frame', () => {
    expect(isTrivial(0.9, 'first_since', 'milestone_crossed')).toBe(false);
    expect(computedFrames(season)[0]).toMatchObject({ type: 'milestone', strength: 0.7 });
  });
  it('words season and career crossings with the postgame season phrase', () => {
    const post = rcFor('postgame');
    expect(say(season, fr('milestone', { step: 0 }), post)).toEqual({
      headline: 'Star Clipper passed 1,000 points for the season vs the Warriors', context: '1,012 points in 2025-26 through Jan 10, 2026',
    });
    expect(say(season, fr('milestone', { step: 0 }), post, 1).headline).toBe('Star Clipper passed 1,000 points so far in 2025-26 vs the Warriors');
    expect(say(career, fr('milestone', { step: 1 }), post)).toEqual({
      headline: 'Star Clipper passed 10,000 points for his career vs the Warriors', context: '10,021 points in his career through Jan 10, 2026',
    });
  });
  it('says reached, not passed, when the total lands exactly on the threshold', () => {
    const post = rcFor('postgame');
    const exact = makeFact({ ...season, data: { ...season.data, total_value: 1000, formatted: '1,000 points' } });
    const exactCareer = makeFact({ ...career, data: { ...career.data, total_value: 10000, formatted: '10,000 points' } });
    expect(say(exact, fr('milestone', { step: 0 }), post).headline).toBe('Star Clipper reached 1,000 points for the season vs the Warriors');
    expect(say(exact, fr('milestone', { step: 0 }), post, 1).headline).toBe('Star Clipper reached 1,000 points so far in 2025-26 vs the Warriors');
    expect(say(exactCareer, fr('milestone', { step: 1 }), post).headline).toBe('Star Clipper reached 10,000 points for his career vs the Warriors');
    expect(say(season, fr('milestone', { step: 0 }), post).headline).toContain('passed');
  });
  it('renders clean for every frame', () => {
    expectCleanPhrasings(season);
    expectCleanPhrasings(career);
    expectCleanPhrasings(makeFact({ ...season, data: { ...season.data, total_value: 1000, formatted: '1,000 points' } }));
  });
});
