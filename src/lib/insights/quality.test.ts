import { describe, expect, it } from 'vitest';
import {
  CAREER_BEST_MARGIN, MIN_FIRST_SINCE_GAMES, MIN_SEASON_AVG_GAMES, MIN_SEASON_HIGH_TEAM_GAMES,
  MIN_STREAK_GAMES, NOTE_CATEGORIES, YOY_JUMP,
  applyBar, careerBestHolds, contextNeeds, factDate, normalizeRow, untilDate, verdict,
  type BarRow,
} from './quality';
import type { Frame } from './types';

function frame(over: Partial<Frame> = {}): Frame {
  return { type: 'first_since', strength: 0.5, who: 'subject', text: '', since_date: '2026-11-13', proof_rows: [], ...over };
}
function row(over: Partial<BarRow> = {}): BarRow {
  return {
    insight_id: 'i1', surface: 'postgame', category: 'player_game_stat', player_id: '9', game_id: '100',
    season_id: 2026, game_date: '2026-11-17', detail: null, frame: frame(), evidence: null, proof_result: [],
    ...over,
  };
}
const ctx = (games_since: number | null, team_game_number: number | null = null) => ({ games_since, team_game_number });

describe('quality bar', () => {
  it('exports the spec constants', () => {
    expect(MIN_FIRST_SINCE_GAMES).toBe(41);
    expect(MIN_SEASON_HIGH_TEAM_GAMES).toBe(20);
    expect(MIN_STREAK_GAMES).toBe(5);
    expect(MIN_SEASON_AVG_GAMES).toBe(20);
    expect(CAREER_BEST_MARGIN).toBe(0.05);
    expect(YOY_JUMP).toBe(0.25);
    expect([...NOTE_CATEGORIES].sort()).toEqual(
      ['h2h', 'last_meeting', 'line', 'opp_form', 'opp_hot_player', 'rest', 'vs_opponent'],
    );
  });

  it.each(['first_since', 'longest_since'] as const)('Q1 %s needs 41 games between', (type) => {
    const r = row({ frame: frame({ type }) });
    expect(verdict(r, ctx(40))).toBe('cut');
    expect(verdict(r, ctx(41))).toBe('card');
    expect(verdict(row({ frame: frame({ type, games_since: 41 }) }))).toBe('card');
  });

  it('Q1 exempts season-level first_since', () => {
    const f = frame({ since_label: '2022-23' });
    delete f.since_date;
    expect(verdict(row({ frame: f }))).toBe('card');
  });

  it('verdict: unknown context fails closed', () => {
    expect(verdict(row())).toBe('cut');
  });

  it('Q2 group season_high waits for game 20', () => {
    const r = row({ frame: frame({ type: 'season_high', who: 'group' }) });
    expect(verdict(r, ctx(null, 19))).toBe('cut');
    expect(verdict(r, ctx(null, 20))).toBe('card');
    expect(verdict(r)).toBe('cut');
  });

  it('Q3 subject season_high is a tag', () => {
    expect(verdict(row({ frame: frame({ type: 'season_high', who: 'subject' }) }))).toBe('tag');
  });

  it('Q5 none is cut', () => {
    expect(verdict(row({ frame: frame({ type: 'none' }) }))).toBe('cut');
    expect(verdict(row({ frame: null }))).toBe('cut');
  });

  it('live and legacy rows pass through', () => {
    expect(verdict(row({ surface: 'live', frame: null }))).toBe('card');
    expect(verdict(row({ surface: null, frame: null }))).toBe('card');
  });

  it('Q6 streaks need 5 games', () => {
    const base = { category: 'streak', frame: frame({ type: 'records_best', who: 'group' }) };
    expect(verdict(row({ ...base, proof_result: [{ part: 'fact', data: { streak: 4 } }] }))).toBe('cut');
    expect(verdict(row({ ...base, proof_result: [{ part: 'fact', data: { streak: 5 } }] }))).toBe('card');
  });

  it('Q7 career-best gate', () => {
    expect(careerBestHolds(11, 5.91, 5.88)).toBe(false);
    expect(careerBestHolds(20, 5.91, 5.88)).toBe(true);
    expect(careerBestHolds(11, 6.2, 5.88)).toBe(true);
    expect(careerBestHolds(5, 1, 0)).toBe(true);
  });

  it('Q7 normalizeRow withholds a fragile career best and keeps the jump', () => {
    const mk = (before: number) => row({
      surface: 'season', category: 'yoy_change', player_id: '7',
      frame: frame({ type: 'career_high', who: 'subject', prior_value: 5.88 }),
      evidence: {
        type: 'delta', before: { value: before, label: '2025-26' }, after: { value: 5.91, label: '2026-27' },
        betterIsHigher: true,
      },
      proof_result: [{ part: 'fact', data: { games: 11 } }],
      detail: 'A career-best season',
    });
    const n = normalizeRow(mk(3.32));
    expect(n.frame?.type).toBe('none');
    expect(n.detail).toBe('Through 11 games');
    expect(verdict(n)).toBe('card');
    expect(verdict(mk(5.0))).toBe('cut');
  });

  it.each(['opp_form', 'last_meeting', 'vs_opponent', 'rest', 'line', 'h2h', 'opp_hot_player'])(
    'Q8 pregame %s is a note', (category) => {
      expect(verdict(row({ surface: 'pregame', category, frame: frame({ type: 'none' }) }))).toBe('note');
    });
  it('Q8 other pregame none is cut', () => {
    expect(verdict(row({ surface: 'pregame', category: 'opp_rank', frame: frame({ type: 'none' }) }))).toBe('cut');
  });

  it('Q8 team yoy merges only without a frame', () => {
    const base = { category: 'yoy_change', player_id: null, surface: 'season' as const };
    expect(verdict(row({ ...base, frame: frame({ type: 'none' }) }))).toBe('merge');
    expect(verdict(row({ ...base, frame: frame({ type: 'league_rank', who: 'league', rank: 3, total: 30 }) }))).toBe('card');
  });

  it('factDate and untilDate', () => {
    expect(factDate(row())).toBe('2026-11-17');
    const sb = row({ game_date: null, proof_result: [{ part: 'fact', data: { game_date: '2026-11-15' } }] });
    expect(factDate(sb)).toBe('2026-11-15');
    const st = row({
      game_date: null, category: 'streak',
      proof_result: [{ part: 'fact', data: { streak_start: '2026-11-01', streak_end: '2026-11-12' } }],
    });
    expect(factDate(st)).toBe('2026-11-12');
    expect(untilDate(st)).toBe('2026-11-01');
  });

  it('contextNeeds asks only for what a row lacks', () => {
    expect(contextNeeds([row()])).toMatchObject([
      { player_id: '9', since_date: '2026-11-13', until_date: '2026-11-17', at_date: null },
    ]);
    expect(contextNeeds([row({ frame: frame({ who: 'group' }) })])[0].player_id).toBeNull();
    expect(contextNeeds([row({ frame: frame({ games_since: 50 }) })])).toEqual([]);
    expect(contextNeeds([row({ frame: frame({ type: 'season_high', who: 'group' }) })])).toMatchObject([
      { since_date: null, at_date: '2026-11-17', season_id: 2026 },
    ]);
    expect(contextNeeds([row({ frame: frame({ type: 'career_high' }) })])).toEqual([]);
  });

  it('applyBar sorts verdicts and keeps order', () => {
    const card = row({ insight_id: 'card', frame: frame({ type: 'career_high' }) });
    const tag = row({ insight_id: 'tag', frame: frame({ type: 'season_high' }) });
    const note = row({ insight_id: 'note', surface: 'pregame', category: 'rest', frame: frame({ type: 'none' }) });
    const merge = row({ insight_id: 'merge', category: 'yoy_change', player_id: null, frame: frame({ type: 'none' }) });
    const cut = row({ insight_id: 'cut', frame: frame({ type: 'none' }) });
    const out = applyBar([card, tag, note, merge, cut], new Map());
    expect(out.cards.map((r) => r.insight_id)).toEqual(['card']);
    expect(out.tags.map((r) => r.insight_id)).toEqual(['tag']);
    expect(out.notes.map((r) => r.insight_id)).toEqual(['note']);
    expect(out.merged.map((r) => r.insight_id)).toEqual(['merge']);
  });
});
