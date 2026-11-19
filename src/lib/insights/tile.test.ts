import { describe, expect, it } from 'vitest';
import type { InsightCardData } from './card';
import { cardHref, compactMeta, headerLines, isPlainCard, scoutHeadline, shownDetail, tileParts } from './tile';
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
    // Dec 4, 2021 -> Nov 13, 2026 is 4 years 11 months: rounded down
    expect(p.chip).toEqual({ label: 'First in 4½ yrs', tone: 'rare' });
    expect(p.visual?.kind).toBe('gap');
    expect(p.big).toEqual({ n: '4½', unit: 'years since the last one' });
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

describe('scoutHeadline', () => {
  it('strips a leading "Up next: " or "Next opponent: " and capitalizes what follows', () => {
    expect(scoutHeadline('Up next: the Jazz rank 29th in defense')).toBe('The Jazz rank 29th in defense');
    expect(scoutHeadline('Next opponent: Utah is 3-11')).toBe('Utah is 3-11');
    expect(scoutHeadline('up next:   the Jazz')).toBe('The Jazz');
  });
  it('leaves other headlines (and a mid-sentence "up next") alone', () => {
    expect(scoutHeadline('The Jazz rank 29th')).toBe('The Jazz rank 29th');
    expect(scoutHeadline('Who is up next: Utah')).toBe('Who is up next: Utah');
    expect(scoutHeadline('Up next:')).toBe('Up next:');
  });
});

describe('cardHref', () => {
  it('without a page, the card href', () => {
    expect(cardHref(card({ href: '/history/1' }))).toBe('/history/1');
  });
  it('on a game page, a card about that game is unlinked; another game stays linked', () => {
    expect(cardHref(card({ href: '/history/4530' }), { kind: 'game', game_id: '4530' })).toBeNull();
    expect(cardHref(card({ href: '/history/4529' }), { kind: 'game', game_id: '4530' })).toBe('/history/4529');
    expect(cardHref(card({ href: null }), { kind: 'game', game_id: '4530' })).toBeNull();
  });
  it('on a player page, a card opens its game, or is unlinked without one', () => {
    expect(cardHref(card({ href: '/players/283', game_id: '4530' }), { kind: 'player', player_id: '283' })).toBe('/history/4530');
    expect(cardHref(card({ href: '/players/283', game_id: null }), { kind: 'player', player_id: '283' })).toBeNull();
  });
});

describe('shownDetail', () => {
  const milestone = (detail: string, over: Partial<InsightCardData> = {}) => card({
    game_id: '4531', fact_date: '2026-11-17', context_label: 'Nov 17 · W 120-100 vs UTA', detail,
    frame: frame({ type: 'milestone' }), ...over,
  });
  it('hides a detail that only restates the game shown in the header', () => {
    expect(shownDetail(milestone('Nov 17, 2026 vs the Utah Jazz'))).toBeNull();
    expect(shownDetail(milestone('Nov 17, 2026 at the Utah Jazz'))).toBeNull();
  });
  it('keeps a detail that says more, or when no game line is shown', () => {
    expect(shownDetail(milestone('1,012 points in 2026-27 through Nov 17, 2026'))).toBe('1,012 points in 2026-27 through Nov 17, 2026');
    expect(shownDetail(milestone('Nov 17, 2026 vs the Utah Jazz · 30 points'))).toBe('Nov 17, 2026 vs the Utah Jazz · 30 points');
    expect(shownDetail(milestone('Nov 17, 2026 vs the Utah Jazz', { context_label: 'Milestone' }))).toBe('Nov 17, 2026 vs the Utah Jazz');
    expect(shownDetail(milestone('Nov 16, 2026 vs the Utah Jazz'))).toBe('Nov 16, 2026 vs the Utah Jazz');
    expect(shownDetail(card({ detail: null }))).toBeNull();
  });
});
