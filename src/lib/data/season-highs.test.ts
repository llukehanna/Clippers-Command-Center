import { describe, it, expect } from 'vitest';
import { seasonHighTags, rareTags, mergeTags, playerSeasonHighs, tagTonesPresent, type BoxCol } from './season-highs';
import { meetsSeasonHighFloor, SEASON_HIGH_FLOORS } from '@/src/lib/insights/season-highs';
import type { InsightCardData } from '@/src/lib/insights/card';

const line = (o: Partial<Record<'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'fg3m', number | null>> = {}) =>
  ({ pts: null, reb: null, ast: null, stl: null, blk: null, fg3m: null, ...o });

describe('seasonHighTags', () => {
  const player = (o = {}) => ({ player_id: '7', team_is_lac: true, ...line({ pts: 26 }), ...o });
  const prior = (o = {}) => ({ player_id: '7', games: 12, ...line({ pts: 24 }), ...o });
  it('tags a value above the prior max', () => {
    expect(seasonHighTags([player()], [prior()])).toEqual({ '7': { PTS: { tone: 'season_high', label: 'Season high' } } });
  });
  it('floors: 1 block over a prior max of 0 is no tag, 4 blocks is', () => {
    expect(seasonHighTags([player({ pts: null, blk: 1 })], [prior({ pts: null, blk: 0 })])).toEqual({});
    expect(seasonHighTags([player({ pts: null, blk: 4 })], [prior({ pts: null, blk: 0 })])).toEqual({ '7': { BLK: { tone: 'season_high', label: 'Season high' } } });
  });
  it('floors: 4 assists no tag, 26 points tag', () => {
    expect(seasonHighTags([player({ pts: null, ast: 4 })], [prior({ pts: null, ast: 2 })])).toEqual({});
    expect(seasonHighTags([player()], [prior()])).toHaveProperty('7.PTS');
  });
  it('ties are not a season high', () => expect(seasonHighTags([player({ pts: 24 })], [prior()])).toEqual({}));
  it('needs 3 earlier games', () => expect(seasonHighTags([player()], [prior({ games: 2 })])).toEqual({}));
  it('null prior max, no tag', () => expect(seasonHighTags([player()], [prior({ pts: null })])).toEqual({}));
  it('no prior row, no tag', () => expect(seasonHighTags([player()], [])).toEqual({}));
  it('opponents get no tag', () => expect(seasonHighTags([player({ team_is_lac: false })], [prior()])).toEqual({}));
});

describe('rareTags', () => {
  const card = (frame: Record<string, unknown> | null): InsightCardData => ({
    insight_id: 'c', surface: 'postgame', category: 'player_game_stat', headline: 'h', detail: null, importance: 50,
    player_id: '7', game_id: '1', season_id: 2026, subject: { kind: 'team', abbr: 'LAC', name: 'Clippers' },
    context_label: '', fact_date: '2026-11-17', href: null, evidence: null, proof: [], updated_at: '', merged_ids: [],
    frame: frame as never,
  });
  const fs = { type: 'first_since', strength: 0.5, who: 'subject', text: '', since_date: '2021-12-04', proof_rows: [] };
  const box = (blk: number) => new Map<string, Partial<Record<BoxCol, number | null>>>([['7', { BLK: blk }]]);
  it('tags a matching stat and value', () => {
    expect(rareTags([card({ ...fs, stat: 'blk', value: 4 })], box(4))).toEqual({ '7': { BLK: { tone: 'rare', label: "1st since '21" } } });
  });
  it('no tag when the box disagrees', () => expect(rareTags([card({ ...fs, stat: 'blk', value: 4 })], box(5))).toEqual({}));
  it('unmapped stat, no tag', () => expect(rareTags([card({ ...fs, stat: 'q_pts', value: 4 })], box(4))).toEqual({}));
  it('legacy rows without stat, no tag', () => expect(rareTags([card(fs), card(null)], box(4))).toEqual({}));
});

describe('mergeTags', () => {
  it('blue replaces grey in the same cell', () => {
    const grey = { '7': { PTS: { tone: 'season_high' as const, label: 'Season high' }, REB: { tone: 'season_high' as const, label: 'Season high' } } };
    const blue = { '7': { PTS: { tone: 'rare' as const, label: 'Career high' } } };
    expect(mergeTags(grey, blue)).toEqual({ '7': { PTS: blue['7'].PTS, REB: grey['7'].REB } });
  });
});

describe('playerSeasonHighs', () => {
  const g = (o: Record<string, unknown>) => ({
    game_id: '1', game_date: '2026-11-01', opp_abbreviation: 'SAS', home: true,
    points: null, rebounds: null, assists: null, fg3_made: null, ...o,
  });
  it('the earliest game wins a tie', () => {
    const out = playerSeasonHighs([
      g({ game_id: '3', game_date: '2026-11-17', points: 26 }),
      g({ game_id: '2', game_date: '2026-11-13', points: 26, home: false, opp_abbreviation: 'DEN' }),
    ]);
    expect(out).toEqual([{ stat: 'pts', label: 'Points', value: 26, game_id: '2', game_date: '2026-11-13', opp: 'DEN', home: false }]);
  });
  it('leaves out a stat with no values', () => {
    const out = playerSeasonHighs([g({ points: 10, rebounds: 4, assists: 2 })]);
    expect(out.map((h) => h.stat)).toEqual(['pts', 'reb', 'ast']);
  });
  it('orders pts, reb, ast, fg3m', () => {
    const out = playerSeasonHighs([g({ points: 10, rebounds: 4, assists: 2, fg3_made: 3 })]);
    expect(out.map((h) => h.stat)).toEqual(['pts', 'reb', 'ast', 'fg3m']);
    expect(out.map((h) => h.label)).toEqual(['Points', 'Rebounds', 'Assists', 'Threes']);
  });
  it('is empty with no rows', () => { expect(playerSeasonHighs([])).toEqual([]); });
});

describe('tagTonesPresent', () => {
  const tags = {
    '7': { PTS: { tone: 'rare' as const, label: 'Career high' } },
    '8': { REB: { tone: 'season_high' as const, label: 'Season high' } },
  };
  it('reports only the tones on the given players', () => {
    expect(tagTonesPresent(tags, ['7'])).toEqual({ rare: true, season_high: false });
    expect(tagTonesPresent(tags, ['8', '9'])).toEqual({ rare: false, season_high: true });
    expect(tagTonesPresent(tags, ['7', '8'])).toEqual({ rare: true, season_high: true });
    expect(tagTonesPresent(tags, ['9'])).toEqual({ rare: false, season_high: false });
    expect(tagTonesPresent(undefined, ['7'])).toEqual({ rare: false, season_high: false });
  });
});

describe('season-high floors (shared)', () => {
  it('the box score re-exports the shared floors', async () => {
    const data = await import('./season-highs');
    expect(data.SEASON_HIGH_FLOORS).toBe(SEASON_HIGH_FLOORS);
  });
  it('meetsSeasonHighFloor', () => {
    expect(meetsSeasonHighFloor('blk', 1)).toBe(false);
    expect(meetsSeasonHighFloor('blk', 3)).toBe(true);
    expect(meetsSeasonHighFloor('pts', 14)).toBe(false);
    expect(meetsSeasonHighFloor('fgm', 1)).toBe(true);
    expect(meetsSeasonHighFloor('constructor', 0)).toBe(true);
  });
});
