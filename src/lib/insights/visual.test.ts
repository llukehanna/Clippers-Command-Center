import { describe, expect, it } from 'vitest';
import type { InsightCardData } from './card';
import { evidenceAria } from './evidence-aria';
import { fmtDate } from './time';
import { bigFigure, pickVisual } from './visual';
import type { Evidence, Frame } from './types';

function frame(over: Partial<Frame> = {}): Frame {
  return { type: 'none', strength: 0.5, who: 'subject', text: '', proof_rows: [], ...over };
}

function card(over: Partial<InsightCardData> = {}): InsightCardData {
  return {
    insight_id: 'i1', surface: 'postgame', category: 'player_game_stat', headline: 'h', detail: null, importance: 70,
    player_id: '9', game_id: '1', season_id: 2026,
    subject: { kind: 'player', name: 'Kawhi Leonard', nba_person_id: 1 },
    context_label: 'x', fact_date: '2026-11-13', href: null, frame: null, evidence: null, proof: [],
    updated_at: '2026-11-14T00:00:00Z', merged_ids: [],
    ...over,
  };
}

const rankTrack: Evidence = { type: 'rank_track', rank: 3, total: 30, betterIsHigher: true, label: 'PPG' };
const ladder: Evidence = { type: 'history_ladder', current: { value: 5, label: 'now' }, others: [] };

describe('pickVisual', () => {
  it('first_since becomes a gap', () => {
    const v = pickVisual(card({ fact_date: '2026-11-13', frame: frame({ type: 'first_since', since_date: '2021-12-04' }) }));
    expect(v?.kind).toBe('gap');
    if (v?.kind !== 'gap') throw new Error('x');
    expect(v.span).toBe('5 years');
    expect(v.ticks).toHaveLength(5);
    for (const t of v.ticks) { expect(t).toBeGreaterThan(0); expect(t).toBeLessThan(1); }
    expect(v.aria).toBe('Last time Dec 4, 2021; this time Nov 13, 2026: 5 years apart');
  });

  it('first_since with since_date >= fact_date or no fact_date is not a gap', () => {
    expect(pickVisual(card({ frame: frame({ type: 'first_since', since_date: '2026-11-13' }) }))).toBeNull();
    expect(pickVisual(card({ frame: frame({ type: 'first_since', since_date: '2027-01-01' }) }))).toBeNull();
    expect(pickVisual(card({ fact_date: null, frame: frame({ type: 'first_since', since_date: '2021-12-04' }) }))).toBeNull();
    const v = pickVisual(card({ fact_date: null, evidence: rankTrack, frame: frame({ type: 'first_since', since_date: '2021-12-04' }) }));
    expect(v?.kind).toBe('evidence');
  });

  it('career_high with prior_value and value becomes best', () => {
    expect(pickVisual(card({ frame: frame({ type: 'career_high', prior_value: 20, value: 26 }) })))
      .toMatchObject({ kind: 'best', prev: 20, now: 26 });
  });

  it('career_high without frame.value falls back to evidence or null', () => {
    const f = frame({ type: 'career_high', prior_value: 20 });
    expect(pickVisual(card({ frame: f }))).toBeNull();
    expect(pickVisual(card({ frame: f, evidence: rankTrack }))?.kind).toBe('evidence');
  });

  it('joins_company becomes company with the subject last', () => {
    const f = frame({
      type: 'joins_company', names: ['James Harden', 'Kawhi Leonard'],
      proof_rows: [
        { subject_name: 'James Harden', game_date: '2019-02-01' },
        { subject_name: 'Kawhi Leonard', game_date: '2022-01-05' },
      ],
    });
    const v = pickVisual(card({ subject: { kind: 'player', name: 'Paul George', nba_person_id: 2 }, frame: f }));
    expect(v?.kind).toBe('company');
    if (v?.kind !== 'company') throw new Error('x');
    expect(v.members).toHaveLength(3);
    expect(v.members[2]).toEqual({ name: 'Paul George', date: fmtDate('2026-11-13'), me: true });
    expect(v.members[0]).toEqual({ name: 'James Harden', date: 'Feb 1, 2019', me: false });
  });

  it('company with an undated member is null', () => {
    const f = frame({ type: 'joins_company', names: ['A'], proof_rows: [] });
    expect(pickVisual(card({ frame: f }))).toBeNull();
  });

  it('a team_yoy card gets team_yoy', () => {
    const rows = [{ label: 'Offense' as const, from: 10, to: 22, total: 30 }];
    expect(pickVisual(card({ team_yoy: rows }))?.kind).toBe('team_yoy');
  });

  it('rank_track evidence passes through with its aria', () => {
    const v = pickVisual(card({ evidence: rankTrack }));
    expect(v).toEqual({ kind: 'evidence', evidence: rankTrack, aria: evidenceAria(rankTrack) });
  });

  it('history_ladder on a non-company card is null', () => {
    expect(pickVisual(card({ evidence: ladder }))).toBeNull();
  });

  it('legacy card with no frame or evidence is null', () => {
    expect(pickVisual(card())).toBeNull();
  });
});

describe('bigFigure', () => {
  const gap = (from: string, to: string) => pickVisual(card({ fact_date: to, frame: frame({ type: 'first_since', since_date: from }) }))!;
  it('8.64 years reads 8½', () => {
    expect(bigFigure(gap('2018-03-26', '2026-11-15'))).toEqual({ n: '8½', unit: 'years since the last one' });
  });
  it('half a year reads 6 months', () => {
    expect(bigFigure(gap('2026-05-14', '2026-11-13'))).toEqual({ n: '6', unit: 'months since the last one' });
  });
  it('non-gap visuals have none', () => {
    expect(bigFigure({ kind: 'best', prev: 1, now: 2, aria: '' })).toBeNull();
  });
});
