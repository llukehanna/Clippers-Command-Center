// Tied ranks on nightly-rewritten cards say "tied for" (FF-1): every phrasing of the standings, league rank,
// recent form, opponent rank and YoY team-rank kinds, their context lines (the frame text), the league_rank frame
// and the rank_track evidence.
import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../../../src/lib/insights/types';
import { evidenceAria } from '../../../../../src/lib/insights/evidence-aria';
import { buildEvidence } from '../evidence';
import { MAX_HEADLINE, phrasingsFor, renderInsight } from '../render';
import { computedFrames } from '../strength';
import { COMPLETED_SEASON, CURRENT_SEASON, makeCtx, makeFact } from '../__fixtures__/facts';
import type { Fact, FactData } from '../types';
import type { RenderContext } from './shared';

const teams = makeCtx().teams;
const rcNow: RenderContext = { surface: 'season', season: CURRENT_SEASON, teams };
const rcDone: RenderContext = { surface: 'season', season: COMPLETED_SEASON, teams };
const pre: RenderContext = { ...rcNow, surface: 'pregame' };
const preDone: RenderContext = { ...rcDone, surface: 'pregame' };
const lac = { type: 'team' as const, id: '1', name: 'Clippers' };
const fr = (extra: Partial<Frame> = {}): Frame => ({ type: 'league_rank', strength: 0.7, who: 'league', text: '', proof_rows: [], ...extra });
const all = (f: Fact, rc: RenderContext) => phrasingsFor(f, fr()).map((p) => p(f, fr(), rc));
const tie = (f: Fact, data: Partial<FactData>): Fact => ({ ...f, data: { ...f.data, ...data } });

const standings = makeFact({ kind: 'standings', subject: lac, stat: 'conf_rank', value: 13, data: { rank: 13, total: 15, bottom: true, wins: 4, losses: 9, conference: 'West', league_rank: 26, league_teams: 30, tied: 0, league_tied: 0 } });
const teamRank = makeFact({ kind: 'league_rank', subject: lac, stat: 'team_reb_pct', value: 27, data: { rank: 27, total: 30, bottom: true, label: 'rebounding rate', formatted: '47.1%', higherIsBetter: true, tied: 0 } });
const playerRank = makeFact({ kind: 'league_rank', stat: 'player_fg3m', value: 8, data: { rank: 8, total: 150, label: 'made threes', formatted: '126 3PM', higherIsBetter: true, min_games: 30, tied: 0 } });
const recent = makeFact({ kind: 'recent_form', subject: lac, stat: 'last10_net_rating', value: 2, data: { rank: 2, total: 30, label: 'net rating', formatted: '+9.8', tied: 0 } });
const oppRank = makeFact({ kind: 'opp_rank', surface: 'pregame', subject: { type: 'team', id: '2', name: 'Golden State Warriors' }, stat: 'opp_def_rating', value: 3, context: { date: '2026-03-01', opponent_id: '2' }, data: { rank: 3, total: 30, side: 'defense', formatted: '108.2', tied: 0 } });
const yoyTeam = makeFact({ kind: 'yoy_change', subject: lac, stat: 'team_rank_net_rating', value: 3, data: { yoy: 'team_rank', rank: 3, total: 30, prev_rank: 18, label: 'net rating', formatted: '+8.4', prev_formatted: '-1.2', higherIsBetter: true, tied: 0, prev_tied: 0 } });

describe('tied ranks say "tied for" (FF-1)', () => {
  it('standings: every phrasing, now and in the past; the league-wide context line too', () => {
    expect(all(standings, rcNow).map((o) => o.headline)).toEqual([
      'Clippers are 4-9, 13th in the West', 'At 4-9, the Clippers are 13th in the West',
    ]);
    const tied = tie(standings, { tied: 2, league_tied: 1 });
    expect(all(tied, rcNow)).toEqual([
      { headline: 'Clippers are 4-9, tied for 13th in the West', context: 'Tied for 26th of 30 teams league-wide by win percentage' },
      { headline: 'At 4-9, the Clippers are tied for 13th in the West', context: 'Tied for 26th of 30 teams league-wide by win percentage' },
    ]);
    expect(all(tied, rcDone).map((o) => o.headline)).toEqual([
      'Clippers finished 2025-26 at 4-9, tied for 13th in the West', 'Clippers went 4-9 in 2025-26, tied for 13th in the West',
    ]);
    // Each tie count governs its own rank.
    expect(all(tie(standings, { tied: 2, league_tied: 0 }), rcNow)[0].context).toBe('26th of 30 teams league-wide by win percentage');
    expect(all(tie(standings, { tied: 0, league_tied: 3 }), rcNow)[0].headline).toBe('Clippers are 4-9, 13th in the West');
  });

  it('standings: a tie for 1st never reads as 1st alone', () => {
    const first = tie(standings, { rank: 1, bottom: false, wins: 8, losses: 2, tied: 1, league_rank: 1, league_tied: 2 });
    for (const rc of [rcNow, rcDone]) {
      for (const o of all(first, rc)) {
        expect(o.headline).toMatch(/tied for 1st in the West$/);
        expect(o.context).toBe('Tied for 1st of 30 teams league-wide by win percentage');
      }
    }
  });

  it('team and player league ranks: every phrasing, now and in the past', () => {
    expect(all(tie(teamRank, { tied: 2 }), rcNow)).toEqual([
      { headline: 'Clippers rank tied for 27th in the NBA in rebounding rate this season', context: '47.1% — tied for 27th of 30 teams' },
      { headline: 'Clippers are tied for 27th in the NBA in rebounding rate', context: '47.1% — tied for 27th of 30 teams' },
    ]);
    expect(all(tie(teamRank, { tied: 2 }), rcDone).map((o) => o.headline)).toEqual([
      'Clippers were tied for 27th in the NBA in rebounding rate in 2025-26',
      'Clippers finished tied for 27th in the NBA in rebounding rate in 2025-26',
    ]);
    expect(all(teamRank, rcNow).map((o) => o.headline)).toEqual([
      'Clippers rank 27th in the NBA in rebounding rate this season', 'Clippers are 27th in the NBA in rebounding rate',
    ]);
    expect(all(tie(playerRank, { tied: 3 }), rcNow)).toEqual([
      { headline: 'Star Clipper ranks tied for 8th in the NBA in made threes this season', context: '126 3PM — tied for 8th of 150 qualified players (min 30 games)' },
      { headline: 'Star Clipper is tied for 8th in the NBA in made threes', context: '126 3PM — tied for 8th of 150 qualified players (min 30 games)' },
    ]);
    expect(all(tie(playerRank, { tied: 3 }), rcDone).map((o) => o.headline)).toEqual([
      'Star Clipper was tied for 8th in the NBA in made threes in 2025-26',
      'Star Clipper finished tied for 8th in the NBA in made threes in 2025-26',
    ]);
    expect(all(tie(playerRank, { rank: 1, tied: 1 }), rcNow).map((o) => o.headline)).toEqual([
      'Star Clipper ranks tied for 1st in the NBA in made threes this season', 'Star Clipper is tied for 1st in the NBA in made threes',
    ]);
  });

  it('recent form: every phrasing and the context line', () => {
    expect(all(tie(recent, { tied: 2 }), rcNow)).toEqual([
      { headline: 'Clippers rank tied for 2nd in net rating over their last 10 games', context: '+9.8 — tied for 2nd of 30 teams (as of Feb 21, 2026)' },
      { headline: 'Over their last 10, the Clippers rank tied for 2nd in net rating', context: '+9.8 — tied for 2nd of 30 teams (as of Feb 21, 2026)' },
    ]);
    expect(all(recent, rcNow)[0].headline).toBe('Clippers rank 2nd in net rating over their last 10 games');
    expect(all(tie(recent, { rank: 1, tied: 2 }), rcNow).map((o) => o.headline)).toEqual([
      'Clippers rank tied for 1st in net rating over their last 10 games', 'Over their last 10, the Clippers rank tied for 1st in net rating',
    ]);
  });

  it('opponent rank: every phrasing, now and in the past', () => {
    expect(all(oppRank, pre)[0].headline).toBe('Up next: the Golden State Warriors have the 3rd-ranked defense this season');
    expect(all(tie(oppRank, { tied: 2 }), pre)).toEqual([
      { headline: 'Up next: the Golden State Warriors are tied for 3rd in defensive rating this season', context: 'Defensive rating 108.2 — tied for 3rd of 30 (lower is better)' },
      { headline: 'Next opponent: the Golden State Warriors are tied for 3rd in defensive rating', context: 'Defensive rating 108.2 — tied for 3rd of 30 (lower is better)' },
    ]);
    expect(all(tie(oppRank, { tied: 2, side: 'offense' }), preDone).map((o) => o.headline)).toEqual([
      'Up next: the Golden State Warriors were tied for 3rd in offensive rating in 2025-26',
      'Next opponent: the Golden State Warriors were tied for 3rd in offensive rating',
    ]);
    expect(all(tie(oppRank, { rank: 1, tied: 1 }), pre).map((o) => o.headline)).toEqual([
      'Up next: the Golden State Warriors are tied for 1st in defensive rating this season',
      'Next opponent: the Golden State Warriors are tied for 1st in defensive rating',
    ]);
    // The detector's metric label is used when present; a long name stays within 90 characters via the fallback.
    expect(all(tie(oppRank, { tied: 1, label: 'defensive rating' }), pre)[1].headline).toBe('Next opponent: the Golden State Warriors are tied for 3rd in defensive rating');
    const long = { ...tie(oppRank, { rank: 28, tied: 2, side: 'offense', label: 'offensive rating', bottom: true }), subject: { type: 'team' as const, id: '15', name: 'Portland Trail Blazers' } };
    for (const rc of [pre, preDone]) {
      for (const key of ['00000000', '00000001']) {
        const out = renderInsight(long, fr(), rc, key)!;
        expect(out.headline).toMatch(/^(Up next|Next opponent): the Portland Trail Blazers (are|were) tied for 28th in offensive rating/);
        expect(out.headline.length, out.headline).toBeLessThanOrEqual(MAX_HEADLINE);
      }
    }
  });

  it('YoY team rank moves: either season can be a tie', () => {
    expect(all(tie(yoyTeam, { tied: 2 }), rcDone).map((o) => o.headline)).toEqual([
      "Clippers' net rating improved from 18th in 2024-25 to tied for 3rd in 2025-26",
      "Clippers' net rating: 18th in 2024-25, tied for 3rd in 2025-26",
    ]);
    expect(all(tie(yoyTeam, { prev_tied: 1 }), rcNow).map((o) => o.headline)).toEqual([
      "Clippers' net rating improved from tied for 18th last season to 3rd this season",
      "Clippers' net rating: tied for 18th last season, 3rd this season",
    ]);
    expect(all(tie(yoyTeam, { rank: 1, tied: 1 }), rcNow)[0].headline)
      .toBe("Clippers' net rating improved from 18th last season to tied for 1st this season");
    // A rank that held, tied: never "held at tied for".
    const held = tie(yoyTeam, { rank: 3, prev_rank: 3, tied: 1 });
    for (const o of all(held, rcNow)) {
      expect(o.headline).not.toMatch(/held at tied/);
      expect(o.headline).toContain('tied for 3rd this season');
    }
  });

  it('untied ranks never say "tied"; every tied phrasing fits in 90 characters', () => {
    const LONG = 'Shai Gilgeous-Alexander';
    const cases = [standings, teamRank, playerRank, { ...playerRank, subject: { ...playerRank.subject, name: LONG } }, recent, oppRank, yoyTeam];
    for (const base of cases) {
      for (const rc of [rcNow, rcDone]) {
        const r = { ...rc, surface: base.surface };
        for (const o of all(base, r)) expect(`${o.headline} | ${o.context}`).not.toMatch(/tied/i);
        const tied = tie(base, { tied: 2, prev_tied: 2, league_tied: 2 });
        for (const o of all(tied, r)) {
          expect(o.headline, o.headline).toMatch(/tied for/);
          expect(o.headline.length, o.headline).toBeLessThanOrEqual(MAX_HEADLINE);
        }
        for (const key of ['00000000', '00000001']) expect(renderInsight(tied, fr(), r, key)?.headline).toMatch(/tied for/);
      }
    }
  });
});

describe('tied ranks: frames and evidence (FF-1)', () => {
  it('the league_rank frame keeps its type and strength and carries the tie', () => {
    const [untied] = computedFrames(teamRank);
    const [tied] = computedFrames(tie(teamRank, { tied: 2 }));
    expect(tied).toMatchObject({ type: 'league_rank', strength: untied.strength, rank: 27, total: 30, tied: 2 });
    expect(untied.tied).toBeUndefined();
    const [first] = computedFrames(tie(standings, { rank: 1, bottom: false, tied: 1 }));
    expect(first).toMatchObject({ type: 'league_rank', strength: 0.85, rank: 1, tied: 1 });
    expect(computedFrames(tie(yoyTeam, { tied: 2 }))[0]).toMatchObject({ type: 'league_rank', tied: 2 });
  });

  it('rank_track evidence and its aria caption say "tied for"', () => {
    const e = buildEvidence(tie(teamRank, { tied: 2 }), fr());
    expect(e).toEqual({ type: 'rank_track', rank: 27, total: 30, tied: 2, betterIsHigher: true, label: 'rebounding rate' });
    expect(evidenceAria(e!)).toBe('Ranked tied for 27th of 30 in rebounding rate');
    const s = buildEvidence(tie(standings, { rank: 1, tied: 1 }), fr());
    expect(s).toMatchObject({ type: 'rank_track', rank: 1, tied: 1, label: 'the West' });
    expect(evidenceAria(s!)).toBe('Ranked tied for 1st of 15 in the West');
    for (const f of [recent, oppRank]) expect(buildEvidence(tie(f, { tied: 1 }), fr())).toMatchObject({ tied: 1 });
    // Untied evidence is unchanged.
    const plain = buildEvidence(teamRank, fr());
    expect(plain).toEqual({ type: 'rank_track', rank: 27, total: 30, betterIsHigher: true, label: 'rebounding rate' });
    expect(evidenceAria(plain!)).toBe('Ranked 27th of 30 in rebounding rate');
  });
});
