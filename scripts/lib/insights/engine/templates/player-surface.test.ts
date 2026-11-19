import { describe, it, expect } from 'vitest';
import { nextThreshold, withinReach } from '../crossed';
import { buildEvidence } from '../evidence';
import { isTrivial } from '../score';
import { computedFrames } from '../strength';
import { COMPLETED_SEASON, makeFact } from '../__fixtures__/facts';
import { expectCleanPhrasings, fr, rcFor, say } from '../__fixtures__/sweep';

const best = makeFact({
  kind: 'season_best', surface: 'player', stat: 'pts', value: 41, gameId: null,
  window: { type: 'game', game_id: '640', season_id: 2025 }, context: { date: '2026-01-12', opponent_id: '15', home: false, result: 'W' },
  data: { thing: '41-point game', best: 'most points in a game', by: 'by a Clipper', label: 'scoring', unit: 'points' },
});
const progress = makeFact({
  kind: 'milestone_progress', surface: 'player', stat: 'season_points', value: 1500, keyExtra: '1500',
  window: { type: 'season', season_id: 2025 },
  data: { threshold: 1500, step: 2, total_value: 1482, remaining: 18, per_game: 26.96, games: 55, unit: 'points', label: '1,500 points', formatted: '1,482 points', career: false },
});

describe('player surface', () => {
  it('finds the next threshold and whether it is within two games', () => {
    expect(nextThreshold(1482, [1000, 1250, 1500])).toBe(1500);
    expect(nextThreshold(2600, [1000, 2500])).toBeNull();
    expect(withinReach(18, 26.96)).toBe(true);
    expect(withinReach(60, 26.96)).toBe(false);
    expect(withinReach(5, 0)).toBe(false);
  });
  it('treats milestone progress as always news with a milestone frame', () => {
    // frame 'none' is not an exempt frame: this holds only because milestone_progress is an EXEMPT_KIND
    expect(isTrivial(0.6, 'none', 'milestone_progress')).toBe(false);
    expect(isTrivial(0.6, 'none', 'season_best')).toBe(true);
    expect(computedFrames(progress)[0]).toMatchObject({ type: 'milestone', strength: 0.8 });
    expect(buildEvidence(progress, fr('milestone'))).toEqual({ type: 'milestone_progress', current: 1482, target: 1500, label: 'points' });
  });
  it('words season highs and milestone progress', () => {
    const rc = rcFor('player');
    expect(say(best, fr('career_high', { prior_value: 38 }), rc)).toEqual({
      headline: "Star Clipper's season high: 41 points vs the Trail Blazers", context: 'A career high (previous best 38)',
    });
    expect(say(progress, fr('milestone', { step: 2 }), rc)).toEqual({
      headline: 'Star Clipper is 18 points from 1,500 this season', context: '1,482 points so far in 55 games (27.0 per game)',
    });
    expect(say({ ...progress, stat: 'career_points', value: 10000, data: { ...progress.data, career: true, threshold: 10000, remaining: 40 } }, fr('milestone'), rc, 1).headline)
      .toBe('Star Clipper needs 40 more points for 10,000 career');
  });
  it('names the stats season, never "season high", when it is not the current one', () => {
    const lagging = { ...rcFor('player'), season: { ...COMPLETED_SEASON, phrase: 'in 2025-26' } };
    expect(say(best, fr('none'), lagging).headline).toBe("Star Clipper's 2025-26 high: 41 points vs the Trail Blazers");
    expect(say(best, fr('none'), lagging, 1).headline).toBe('Star Clipper set his 2025-26 high with 41 points');
    expect(say(best, fr('none'), rcFor('player'), 1).headline).toBe('Star Clipper set his season high with 41 points');
  });
  it('uses the singular unit when one is left', () => {
    const one = (stat: string, unit: string, label: string) => ({ ...progress, stat, data: { ...progress.data, remaining: 1, unit, threshold: 20, label } });
    const rc = rcFor('player');
    expect(say(one('double_doubles', 'double-doubles', '20 double-doubles'), fr('milestone'), rc).headline).toBe('Star Clipper is 1 double-double from 20 this season');
    expect(say(one('season_points', 'points', '1,500 points'), fr('milestone'), rc, 1).headline).toBe('Star Clipper needs 1 more point for 20');
    expect(say(one('season_threes', 'made threes', '20 made threes'), fr('milestone'), rc).headline).toBe('Star Clipper is 1 made three from 20 this season');
    expect(say(one('career_rebounds', 'rebounds', '5,000 rebounds'), fr('milestone'), rc).headline).toMatch(/is 1 rebound from/);
    expect(say(one('career_assists', 'assists', '5,000 assists'), fr('milestone'), rc).headline).toMatch(/is 1 assist from/);
    expect(say(progress, fr('milestone'), rc).headline).toMatch(/18 points/);
  });
  it('renders clean for every frame', () => {
    expectCleanPhrasings(best);
    expectCleanPhrasings(progress);
  });
});
