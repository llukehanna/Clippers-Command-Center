import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../../src/lib/insights/types';
import { buildEntities, buildEvidence } from './evidence';
import { makeCtx, makeFact } from './__fixtures__/facts';

const fr = (type: Frame['type'], extra: Partial<Frame> = {}): Frame => ({ type, strength: 0.5, who: 'group', text: '', proof_rows: [], ...extra });
const night = makeFact({
  kind: 'player_game_stat', surface: 'postgame', stat: 'pts', value: 55,
  window: { type: 'game', game_id: '500', season_id: 2025 },
  context: { date: '2025-11-28', opponent_id: '2', home: true, result: 'W' }, gameId: '500',
  data: { rank: 1, total: 18000, label: 'scoring' },
});

describe('buildEvidence', () => {
  it('streak strip from the streak games; none without games', () => {
    const e = buildEvidence(makeFact(), fr('records_best'));
    expect(e).toMatchObject({ type: 'streak_strip', threshold: 30 });
    expect(e && e.type === 'streak_strip' && e.games).toHaveLength(5);
    expect(buildEvidence(makeFact({ stat: 'wins', data: { streak_games: [] } }), fr('none'))).toBeNull();
  });
  it('milestone progress, rank tracks and standings', () => {
    expect(buildEvidence(makeFact({ kind: 'milestone', value: 1500, data: { total_value: 1612, threshold: 1500, unit: 'points' } }), fr('milestone')))
      .toEqual({ type: 'milestone_progress', current: 1612, target: 1500, label: 'points' });
    expect(buildEvidence(makeFact({ kind: 'league_rank', data: { rank: 3, total: 30, label: 'defensive rating', higherIsBetter: false } }), fr('league_rank')))
      .toEqual({ type: 'rank_track', rank: 3, total: 30, betterIsHigher: false, label: 'defensive rating' });
    expect(buildEvidence(makeFact({ kind: 'standings', data: { rank: 1, total: 15, conference: 'West' } }), fr('league_rank')))
      .toEqual({ type: 'rank_track', rank: 1, total: 15, betterIsHigher: true, label: 'the West' });
  });
  it('YoY delta between the two seasons', () => {
    expect(buildEvidence(makeFact({ kind: 'yoy_change', value: 27.1, data: { yoy: 'player', prev_value: 21.4, cur_value: 27.1 } }), fr('none')))
      .toEqual({ type: 'delta', before: { value: 21.4, label: '2024-25' }, after: { value: 27.1, label: '2025-26' }, betterIsHigher: true });
  });
  it('big nights: a ladder when joining company, a rank track otherwise', () => {
    const company = fr('joins_company', { proof_rows: [{ value: 56, subject_name: 'Paul George', game_date: '2021-03-01' }] });
    expect(buildEvidence(night, company)).toEqual({
      type: 'history_ladder',
      current: { value: 55, label: 'Star Clipper, Nov 28, 2025' },
      others: [{ value: 56, label: 'Paul George', date: 'Mar 1, 2021' }],
    });
    expect(buildEvidence(night, fr('league_rank', { rank: 1, total: 18000 })))
      .toEqual({ type: 'rank_track', rank: 1, total: 18000, betterIsHigher: true, label: 'NBA player games in 2025-26' });
    expect(buildEvidence(makeFact({ kind: 'h2h', data: {} }), fr('none'))).toBeNull();
  });
});

describe('buildEntities', () => {
  it('lists the subject, the opponent and the game', () => {
    expect(buildEntities(night, makeCtx())).toEqual([
      { type: 'player', id: '1', name: 'Star Clipper' },
      { type: 'team', id: '2', name: 'Golden State Warriors' },
      { type: 'game', id: '500', name: 'Nov 28, 2025 vs Warriors' },
    ]);
  });
  it('names the team in full and does not repeat an opponent subject', () => {
    expect(buildEntities(makeFact({ subject: { type: 'team', id: '1', name: 'Clippers' } }), makeCtx()))
      .toEqual([{ type: 'team', id: '1', name: 'LA Clippers' }]);
    const opp = makeFact({ kind: 'opp_rank', subject: { type: 'team', id: '2', name: 'Golden State Warriors' }, context: { date: '2026-03-01', opponent_id: '2' }, gameId: '1802', data: {} });
    expect(buildEntities(opp, makeCtx())).toEqual([
      { type: 'team', id: '2', name: 'Golden State Warriors' },
      { type: 'game', id: '1802', name: 'Mar 1, 2026 vs Warriors' },
    ]);
  });
});
