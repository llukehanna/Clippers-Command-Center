import { describe, it, expect } from 'vitest';
import { composeFeed, mergeSameGamePlayer, type ComposableInsight } from './compose';

const item = (id: string, over: Partial<ComposableInsight> = {}): ComposableInsight => ({
  insight_id: id, surface: 'season', category: 'streak', importance: 50, headline: id, detail: `${id} detail`,
  game_id: null, player_id: null, frame: null, score_parts: { salience_class: 'roster_core' }, ...over,
});
const ids = (xs: { insight_id: string }[]) => xs.map((x) => x.insight_id);

describe('composeFeed (spec §2.7)', () => {
  it('caps two per player and two per category', () => {
    const feed = composeFeed([
      item('a', { player_id: '1', category: 'streak', importance: 90 }),
      item('b', { player_id: '1', category: 'milestone', importance: 80 }),
      item('c', { player_id: '1', category: 'league_rank', importance: 70 }),
      item('d', { player_id: '2', category: 'streak', importance: 60 }),
      item('e', { player_id: '3', category: 'streak', importance: 55 }),
      item('f', { player_id: '3', category: 'yoy_change', importance: 50 }),
    ], 'season_feed');
    expect(ids(feed)).toEqual(['a', 'b', 'd', 'f']);
  });

  it('does not cap a player page per player, but still caps categories and size (R3)', () => {
    const many = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((id, i) =>
      item(id, { surface: 'player', player_id: '1', category: `cat${Math.floor(i / 2)}`, importance: 90 - i }));
    expect(ids(composeFeed(many, 'player_page'))).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
    const sameCategory = ['x', 'y', 'z'].map((id, i) => item(id, { surface: 'player', player_id: '1', category: 'streak', importance: 80 - i }));
    expect(ids(composeFeed(sameCategory, 'player_page'))).toEqual(['x', 'y']);
    expect(ids(composeFeed(many.map((m) => ({ ...m, surface: 'season' as const })), 'season_feed'))).toEqual(['a', 'b']);
  });

  it('keeps one team item above importance 40 in feeds of three or more', () => {
    const players = [
      item('p1', { surface: 'pregame', player_id: '1', category: 'a', importance: 90 }),
      item('p2', { surface: 'pregame', player_id: '2', category: 'b', importance: 80 }),
      item('p3', { surface: 'pregame', player_id: '3', category: 'c', importance: 70 }),
    ];
    expect(ids(composeFeed([...players, item('t', { surface: 'pregame', category: 'h2h', importance: 45 })], 'up_next'))).toEqual(['p1', 'p2', 't']);
    expect(ids(composeFeed([...players, item('t', { surface: 'pregame', category: 'h2h', importance: 35 })], 'up_next'))).toEqual(['p1', 'p2', 'p3']);
  });

  it('the hero is the single top item and never a former player; game pages keep former players', () => {
    const former = item('old', { surface: 'postgame', player_id: '9', game_id: '5', importance: 99, score_parts: { salience_class: 'former' } });
    const season = item('now', { importance: 80 });
    expect(ids(composeFeed([former, season], 'home_hero'))).toEqual(['now']);
    expect(ids(composeFeed([former, season], 'game_page'))).toEqual(['old']);
  });

  it('merges two postgame items about one player in one game', () => {
    const feed = composeFeed([
      item('x', { surface: 'postgame', player_id: '1', game_id: '9', category: 'league_night', importance: 80, detail: 'Most points' }),
      item('y', { surface: 'postgame', player_id: '1', game_id: '9', category: 'league_night', importance: 70, detail: 'First 12-rebound game' }),
      item('z', { surface: 'postgame', game_id: '9', category: 'game_flow', importance: 60 }),
    ], 'game_page');
    expect(ids(feed)).toEqual(['x', 'z']);
    expect(feed[0]).toMatchObject({ detail: 'Most points · First 12-rebound game', merged_ids: ['y'] });
  });

  it('leads a same-player merge with the stronger frame, not the higher importance (F12)', () => {
    const strong = item('weak-imp', {
      surface: 'postgame', player_id: '1', game_id: '9', category: 'milestone', importance: 60,
      detail: 'Career-high 41 points', frame: { type: 'career_high', strength: 1, text: 'career high' },
    });
    const higher = item('high-imp', {
      surface: 'postgame', player_id: '1', game_id: '9', category: 'league_night', importance: 85,
      detail: 'Most rebounds in the league tonight', frame: { type: 'none', strength: 0.2, text: '' },
    });
    const [merged] = mergeSameGamePlayer([higher, strong]);
    expect(merged).toMatchObject({
      insight_id: 'weak-imp',
      detail: 'Career-high 41 points · Most rebounds in the league tonight',
      merged_ids: ['high-imp'],
    });
  });

  it('filters by placement surface; live is unlimited and unmerged', () => {
    const live = Array.from({ length: 20 }, (_, i) => item(`l${i}`, { surface: 'live', player_id: '1', importance: 100 - i }));
    expect(composeFeed(live, 'live')).toHaveLength(20);
    expect(composeFeed(live, 'season_feed')).toEqual([]);
  });
});
