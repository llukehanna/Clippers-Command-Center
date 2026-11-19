import { describe, expect, it } from 'vitest';
import type { InsightCardData } from './card';
import { compactMeta, headerLines, isPlainCard, tileParts } from './tile';
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
const fact = { part: 'fact' as const, data: { game_date: '2026-11-13', value: 4 } };

describe('tileParts', () => {
  it('a legacy or live card (no frame) is plain even when it carries evidence and proof', () => {
    const p = tileParts(card({ evidence: rankTrack, proof: [fact] }));
    expect(p).toEqual({ plain: true, chip: null, visual: null, receipts: null, sample: null, big: null });
  });

  it('a live card with null surface and no proof never throws', () => {
    expect(() => tileParts(card({ surface: null, game_id: null, fact_date: null }))).not.toThrow();
  });

  it('a first_since card gets a chip, a gap visual, a big figure and receipts', () => {
    const p = tileParts(card({ frame: frame({ type: 'first_since', since_date: '2021-12-04' }), proof: [fact] }));
    expect(p.plain).toBe(false);
    expect(p.chip).toEqual({ label: 'First in 5 yrs', tone: 'rare' });
    expect(p.visual?.kind).toBe('gap');
    expect(p.big).toEqual({ n: '5', unit: 'years since the last one' });
    expect(p.receipts?.rows[0].me).toBe(true);
  });

  it('a framed card with nothing to draw has null parts, not a throw', () => {
    const p = tileParts(card({ frame: frame({ type: 'none' }) }));
    expect(p).toMatchObject({ plain: false, chip: null, visual: null, receipts: null, big: null });
  });

  it('a merged team-yoy card (frame null) keeps its mini-delta visual and gets the ratings chip', () => {
    const c = card({
      subject: { kind: 'team', abbr: 'LAC', name: 'Clippers' },
      team_yoy: [{ label: 'Offense', from: 10, to: 22, total: 30 }, { label: 'Defense', from: 18, to: 25, total: 30 }, { label: 'Net', from: 15, to: 22, total: 30 }],
    });
    expect(isPlainCard(c)).toBe(false);
    const p = tileParts(c);
    expect(p.visual?.kind).toBe('team_yoy');
    expect(p.receipts).toBeNull();
    expect(p.chip).toEqual({ label: 'Down in all 3', tone: 'low' });
  });

  it('a visual the kit cannot draw is dropped, and so is the big figure', () => {
    const p = tileParts(card({
      frame: frame({ type: 'league_rank', rank: 1, total: 1 }),
      evidence: { type: 'rank_track', rank: 1, total: 1, betterIsHigher: true, label: 'x' },
    }));
    expect(p.visual).toBeNull();
    expect(p.big).toBeNull();
  });
});

describe('headerLines', () => {
  it('with the subject: name over context', () => {
    expect(headerLines(card({ context_label: 'Nov 13 · W 113-112 vs OKC' }), true))
      .toEqual({ name: 'Kawhi Leonard', sub: 'Nov 13 · W 113-112 vs OKC' });
  });

  it('without the subject: context over the category topic', () => {
    expect(headerLines(card({ context_label: 'Nov 15 · W 113-105 vs CHA' }), false))
      .toEqual({ name: 'Nov 15 · W 113-105 vs CHA', sub: 'Big Night' });
  });

  it('drops a topic that repeats the context label', () => {
    expect(headerLines(card({ category: 'milestone', context_label: 'Milestone' }), false))
      .toEqual({ name: 'Milestone', sub: null });
  });
});

describe('compactMeta', () => {
  it('a game context that already leads with the date is used as is', () => {
    expect(compactMeta(card({ fact_date: '2026-11-13', context_label: 'Nov 13 · vs OKC' }))).toBe('Nov 13 · vs OKC');
  });

  it('a topic context gets the date in front', () => {
    expect(compactMeta(card({ fact_date: '2026-11-13', context_label: 'League rank' }))).toBe('Nov 13 · League rank');
  });

  it('no fact date leaves the context alone', () => {
    expect(compactMeta(card({ fact_date: null, context_label: 'Standings' }))).toBe('Standings');
  });
});
