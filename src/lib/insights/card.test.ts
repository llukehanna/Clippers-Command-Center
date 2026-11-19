import { describe, expect, it } from 'vitest';
import { toCardData, toMatchupNote, type CardSourceRow } from './card';

function row(over: Partial<CardSourceRow> = {}): CardSourceRow {
  return {
    insight_id: 'i1', surface: 'postgame', category: 'player_game_stat', player_id: '9', game_id: '4531',
    season_id: 2026, game_date: '2026-11-15', detail: null, frame: null, evidence: null,
    proof_result: [{ part: 'fact', data: { game_date: '2026-11-15' } }],
    headline: 'Kawhi Leonard scored 30', importance: 70, entities: null, updated_at: '2026-11-16T00:00:00Z',
    nba_person_id: 202695, player_name: 'Kawhi Leonard', opp_abbr: 'CHA', lac_home: true,
    lac_score: 113, opp_score: 105,
    ...over,
  };
}

describe('toCardData', () => {
  it('postgame row: context label, game href, player subject', () => {
    const c = toCardData(row());
    expect(c.context_label).toBe('Nov 15 · W 113-105 vs CHA');
    expect(c.href).toBe('/history/4531');
    expect(c.subject.kind).toBe('player');
    expect(c.proof).toHaveLength(1);
  });

  it('away loss reads "at" and L', () => {
    const c = toCardData(row({ lac_home: false, lac_score: 99, opp_score: 101 }));
    expect(c.context_label).toBe('Nov 15 · L 99-101 at CHA');
  });

  it('season row about the team: team subject, no href', () => {
    const c = toCardData(row({
      surface: 'season', category: 'league_rank', player_id: null, game_id: null, game_date: null,
      player_name: null, nba_person_id: null, opp_abbr: null, lac_home: null, lac_score: null, opp_score: null,
      proof_result: [],
    }));
    expect(c.subject).toEqual({ kind: 'team', abbr: 'LAC', name: 'Clippers' });
    expect(c.href).toBeNull();
    expect(c.context_label).toBe('League rank');
  });

  it('player surface links to the player page', () => {
    const c = toCardData(row({ surface: 'player', player_id: '283', game_id: null, game_date: null, category: 'season_best' }));
    expect(c.href).toBe('/players/283');
    expect(c.context_label).toBe('Season high');
  });

  it('pregame row with a game links to the schedule page', () => {
    const c = toCardData(row({ surface: 'pregame', game_id: '4533', game_date: '2026-11-17', lac_score: null, opp_score: null }));
    expect(c.href).toBe('/schedule/4533');
    expect(c.context_label).toBe('Nov 17 · vs CHA');
  });

  it('unmapped category is humanized', () => {
    const c = toCardData(row({ surface: 'season', game_id: null, game_date: null, category: 'team_run', proof_result: [] }));
    expect(c.context_label).toBe('Team run');
  });

  it('legacy: frame null and proof_result not an array never throws', () => {
    const c = toCardData(row({ frame: null, proof_result: { a: 1 } }));
    expect(c.proof).toEqual([]);
    expect(c.frame).toBeNull();
    expect(c.merged_ids).toEqual([]);
  });

  it('live row with null surface renders plainly', () => {
    expect(() => toCardData(row({ surface: null, game_id: null, game_date: null, proof_result: null }))).not.toThrow();
  });
});

describe('toMatchupNote', () => {
  const note = (category: string) => toMatchupNote(row({ surface: 'pregame', category, headline: 'H' }));

  it('maps categories to icon and aside; text is the headline', () => {
    expect(note('opp_form')).toMatchObject({ text: 'H', icon: 'L10', aside: 'form', player: null });
    expect(note('last_meeting')).toMatchObject({ icon: 'H2H', aside: 'last meeting' });
    expect(note('rest')).toMatchObject({ icon: 'RST', aside: 'rest' });
    expect(note('line')).toMatchObject({ icon: 'ODDS', aside: 'line' });
    expect(note('h2h').icon).toBe('H2H');
  });

  it('vs_opponent carries the player', () => {
    expect(note('vs_opponent')).toMatchObject({
      icon: null, player: { name: 'Kawhi Leonard', nba_person_id: 202695 },
    });
  });
});
