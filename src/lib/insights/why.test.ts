import { describe, expect, it } from 'vitest';
import { boxTagLabel, whyChip, type WhyInput } from './why';
import type { Evidence, Frame } from './types';

function frame(over: Partial<Frame> = {}): Frame {
  return { type: 'first_since', strength: 0.5, who: 'subject', text: '', proof_rows: [], ...over };
}
function input(over: Partial<WhyInput> = {}): WhyInput {
  return {
    category: 'player_game_stat', surface: 'postgame', player_id: '9', frame: frame(),
    evidence: null, fact_date: '2026-11-15', ...over,
  };
}
const chip = (f: Partial<Frame>, over: Partial<WhyInput> = {}) => whyChip(input({ frame: frame(f), ...over }));

describe('whyChip', () => {
  it('first_since phrases years from the dates', () => {
    expect(chip({ since_date: '2018-03-26' })).toEqual({ label: 'First in 8½ yrs', tone: 'rare' });
    expect(chip({ since_date: '2023-12-29' }, { fact_date: '2026-11-13' })).toEqual({ label: 'First in 3 yrs', tone: 'rare' });
  });

  it('first_since under a year reads months; just over a year reads 1 yr', () => {
    expect(chip({ years: 0.4 }, { fact_date: null })?.label).toBe('First in 5 mo');
    expect(chip({ years: 1.1 }, { fact_date: null })?.label).toBe('First in 1 yr');
  });

  it('never uses games_since for time phrasing', () => {
    const c = chip({ since_date: '2018-03-26', games_since: 3 });
    expect(c?.label).toBe('First in 8½ yrs');
    expect(c?.label).not.toMatch(/game/i);
  });

  it('season-level first_since reads seasons', () => {
    expect(chip({ years: 4, since_label: '2022-23' }, { category: 'yoy_change' }))
      .toEqual({ label: 'Best in 4 seasons', tone: 'rare' });
  });

  it('longest_since, career_high, milestone, only_one', () => {
    expect(chip({ type: 'longest_since', since_date: '2024-03-02' })?.label).toBe("Longest since '24");
    expect(chip({ type: 'career_high' })).toEqual({ label: 'Career high', tone: 'career' });
    expect(chip({ type: 'milestone' })).toEqual({ label: 'Milestone', tone: 'gold' });
    expect(chip({ type: 'only_one' })).toEqual({ label: 'Only Clipper', tone: 'rare' });
  });

  it('joins_company counts the subject among the names', () => {
    expect(chip({ type: 'joins_company', names: ['A', 'B'] })).toEqual({ label: '3rd Clipper', tone: 'rare' });
  });

  it('league_rank: top, bottom, tied', () => {
    expect(chip({ type: 'league_rank', rank: 3, total: 30 })).toEqual({ label: '3rd in NBA', tone: 'rare' });
    expect(chip({ type: 'league_rank', rank: 29, total: 30, who: 'league' }, { player_id: null }))
      .toEqual({ label: '29th of 30', tone: 'low' });
    expect(chip({ type: 'league_rank', rank: 13, total: 30, tied: 1 })).toEqual({ label: 'Tied for 13th', tone: 'ctx' });
  });

  it('a tied rank 1 never reads best or 1st alone', () => {
    const c = chip({ type: 'league_rank', rank: 1, total: 30, tied: 2 });
    expect(c?.label).toBe('Tied for 1st');
  });

  it('opp_rank is a strong opponent', () => {
    expect(chip({ type: 'league_rank', rank: 3, total: 30 }, { category: 'opp_rank', surface: 'pregame', player_id: null }))
      .toEqual({ label: '3rd in NBA', tone: 'low' });
  });

  it('standings read the rank_track evidence', () => {
    const evidence: Evidence = { type: 'rank_track', rank: 13, total: 15, betterIsHigher: false, label: 'the West' };
    expect(chip({ type: 'league_rank', rank: 13, total: 15 }, { category: 'standings', evidence, player_id: null }))
      .toEqual({ label: '13th in West', tone: 'low' });
    const tied: Evidence = { ...evidence, tied: 1 };
    expect(chip({ type: 'league_rank' }, { category: 'standings', evidence: tied, player_id: null })?.label)
      .toBe('Tied for 13th');
  });

  it('records_best and season_high', () => {
    expect(chip({ type: 'records_best', records_seasons: 30 })).toEqual({ label: 'Best in 30 seasons', tone: 'rare' });
    expect(chip({ type: 'season_high', who: 'group' })).toEqual({ label: 'Most this season', tone: 'rare' });
  });

  it('player yoy none with a rise reads Up N%', () => {
    const evidence: Evidence = {
      type: 'delta', before: { value: 3.32, label: '24-25' }, after: { value: 5.91, label: '25-26' }, betterIsHigher: true,
    };
    expect(chip({ type: 'none' }, { category: 'yoy_change', evidence }))
      .toEqual({ label: 'Up 78%', tone: 'career' });
  });

  it('other none frames, null frames and nth_time give no chip', () => {
    expect(chip({ type: 'none' })).toBeNull();
    expect(chip({ type: 'none' }, { category: 'h2h', surface: 'pregame', player_id: null })).toBeNull();
    expect(chip({ type: 'none' }, { category: 'yoy_change', player_id: null })).toBeNull();
    expect(whyChip(input({ frame: null }))).toBeNull();
    expect(chip({ type: 'nth_time', count: 3 })).toBeNull();
  });
});

describe('boxTagLabel', () => {
  it('first_since reads 1st since', () => {
    expect(boxTagLabel(input({ frame: frame({ since_date: '2021-12-04' }) }))).toBe("1st since '21");
  });
  it('career_high', () => {
    expect(boxTagLabel(input({ frame: frame({ type: 'career_high' }) }))).toBe('Career high');
  });
  it('other frames give no tag', () => {
    expect(boxTagLabel(input({ frame: frame({ type: 'milestone' }) }))).toBeNull();
    expect(boxTagLabel(input({ frame: null }))).toBeNull();
  });
});
