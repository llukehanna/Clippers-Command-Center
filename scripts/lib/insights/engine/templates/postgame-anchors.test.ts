// Postgame rows are frozen once written, so their copy must stay true later (FW-3, FW-4, FW-5).
// Sweeps every postgame kind × frame × phrasing variant.
import { describe, it, expect, vi } from 'vitest';
import type { Frame } from '../../../../../src/lib/insights/types';
import { makeFact } from '../__fixtures__/facts';
import { fr, rcFor } from '../__fixtures__/sweep';
import { FLOW_STATS, TEAM_GAME_STATS } from '../references';
import { phrasingsFor } from '../render';
import type { Fact, FactKind } from '../types';

// The detector registry imports the DB-backed modules; only its categories are read here.
vi.mock('../../../db', () => ({ sql: {} }));
const { DETECTORS } = await import('../detectors/index');

const base = {
  surface: 'postgame' as const, gameId: '500', window: { type: 'game' as const, game_id: '500', season_id: 2025 },
  context: { date: '2025-11-28', opponent_id: '2', home: true, result: 'W' as const },
};
const clippers = { type: 'team' as const, id: '1', name: 'Clippers' };

/** One or more representative facts per postgame kind. */
const FACTS: Fact[] = [
  makeFact({ ...base, kind: 'player_game_stat', stat: 'pts', value: 55,
    data: { thing: '55-point game', best: 'most points in a game', by: 'by a Clipper', label: 'scoring', unit: 'points' } }),
  makeFact({ ...base, kind: 'player_game_stat', stat: 'fg3m', value: 4,
    data: { thing: '4-three game', best: 'most threes in a game', by: 'by a Clipper', label: 'three-point', unit: 'threes' } }),
  makeFact({ ...base, kind: 'player_combo', stat: 'triple_double', value: 1,
    data: { thing: 'triple-double', best: 'triple-double', by: 'by a Clipper', line: '24 pts, 12 reb, 11 ast' } }),
  ...(Object.keys(TEAM_GAME_STATS) as (keyof typeof TEAM_GAME_STATS)[]).map((stat) => {
    const def = TEAM_GAME_STATS[stat];
    const value = def.betterIsHigher ? (def.floor < 1 ? 0.584 : def.floor + 5) : def.floor - 7;
    return makeFact({ ...base, kind: 'team_game_stat', subject: clippers, stat, value,
      context: { ...base.context, result: def.when === 'L' ? 'L' : 'W' },
      data: { thing: def.thing(value), best: def.best, by: 'by the Clippers', formatted: def.fmt(value) } });
  }),
  ...(Object.keys(FLOW_STATS) as (keyof typeof FLOW_STATS)[]).map((stat) => {
    const s = FLOW_STATS[stat];
    return makeFact({ ...base, kind: 'game_flow', subject: clippers, stat, value: s.floor + 2,
      context: { ...base.context, result: s.when === 'L' ? 'L' : 'W' },
      data: { thing: s.thing(s.floor + 2), best: s.best, by: s.by, lead: 8, deficit: 22 } });
  }),
  makeFact({ ...base, kind: 'player_period_stat', stat: 'q_pts', value: 18, window: { ...base.window, period: 4 },
    data: { thing: '18-point quarter', best: 'most points in a quarter', by: 'by a Clipper', unit: 'points' } }),
  makeFact({ ...base, kind: 'player_period_stat', stat: 'half_pts', value: 27, window: { ...base.window, period: 2 },
    data: { thing: '27-point half', best: 'most points in a half', by: 'by a Clipper', unit: 'points' } }),
  makeFact({ ...base, kind: 'team_period_stat', subject: clippers, stat: 'team_q_pts', value: 44, window: { ...base.window, period: 3 },
    data: { thing: '44-point quarter', best: 'most points in a quarter', by: 'by the Clippers' } }),
  makeFact({ ...base, kind: 'clutch', stat: 'clutch_pts', value: 11,
    data: { thing: '11-point clutch performance', best: 'most clutch points in a game', by: 'by a Clipper', fgm: 4, fga: 6, ftm: 2, fta: 2 } }),
  ...[1000, 1012].map((through) => makeFact({ ...base, kind: 'milestone_crossed', stat: 'season_points', value: 1000, keyExtra: '1000',
    data: { threshold: 1000, step: 0, total_value: through, unit: 'points', label: '1,000 points', formatted: `${through.toLocaleString('en-US')} points`,
      thing: '1,000-point season', best: 'first 1,000-point season', by: 'by a Clipper', career: false } })),
  ...[500, 503].map((through) => makeFact({ ...base, kind: 'milestone_crossed', stat: 'career_fg3m', value: 500, keyExtra: '500',
    subject: { type: 'player', id: '8', name: 'Rui Hachimura' },
    data: { threshold: 500, step: 0, total_value: through, unit: 'threes', label: '500 threes', formatted: `${through} threes`,
      thing: '500-threes career', best: '500-threes career', by: 'by a Clipper', career: true } })),
];

/** The frames whose claim a later game can overturn, with every field their lines use. */
const ANCHORED: Frame[] = [
  fr('records_best', { records_label: '1996-97', records_seasons: 31 }),
  fr('clippers_rank', { rank: 4, records_label: '1996-97' }),
  fr('league_rank', { rank: 1, total: 18000, who: 'league' }),
  fr('league_rank', { rank: 4, total: 18000, who: 'league' }),
  fr('joins_company', { names: ['Paul George', 'Kawhi Leonard'], records_label: '1996-97' }),
  fr('only_one', { records_label: '1996-97' }),
  fr('season_high'),
  fr('season_high', { who: 'subject' }),
  fr('career_high', { prior_value: 3, who: 'subject' }),
  fr('career_high', { who: 'subject' }),
];
const ANCHOR = /at the time|so far in|previous best/;

const render = (f: Fact, frame: Frame, current: boolean) =>
  phrasingsFor(f, frame).map((p) => p(f, frame, rcFor('postgame', current)));

describe('postgame frame lines are anchored in time (FW-3)', () => {
  it('the sweep covers every postgame fact kind', () => {
    const kinds = new Set<FactKind>(DETECTORS.filter((d) => d.surface === 'postgame').flatMap((d) => [...d.categories]));
    expect([...new Set(FACTS.map((f) => f.kind))].sort()).toEqual([...kinds].sort());
  });

  it('every kind × anchored frame × variant carries an anchor, unless the kind renders that frame as no claim at all', () => {
    for (const f of FACTS) for (const frame of ANCHORED) for (const current of [true, false]) {
      const none = render(f, fr('none'), current);
      render(f, frame, current).forEach((out, i) => {
        const label = `${f.kind}/${f.stat}/${frame.type}(${frame.who}${frame.rank ?? ''}${frame.prior_value ?? ''})#${i}: ${out.context}`;
        if (out.context === none[i].context) return; // the kind's neutral line: no frame claim to anchor
        expect(out.context, label).toMatch(ANCHOR);
      });
    }
  });

  it('the production examples now carry their anchor', () => {
    const threes = FACTS[1];
    const career = render(threes, fr('career_high', { prior_value: 3, who: 'subject' }), false).map((o) => o.context);
    expect(career).toEqual(['A new career high (previous best 3)', 'A career high at the time (previous best 3)']);
    const high = render(FACTS[0], fr('season_high', { who: 'subject' }), false).map((o) => o.context);
    expect(high).toEqual(['His season high so far in 2025-26', 'His most points in a game so far in 2025-26']);
    const record = render(FACTS[0], fr('records_best', { records_label: '1996-97', records_seasons: 31 }), false).map((o) => o.context);
    expect(record).toEqual(['Most points in a game by a Clipper since 1996-97 at the time', 'Most points in a game by a Clipper in 31 seasons of records at the time']);
  });

  it('season, player and pregame surfaces are rewritten nightly, so they are not anchored', () => {
    const live = { ...FACTS[0], surface: 'season' as const };
    const rc = rcFor('season');
    const out = (frame: Frame) => phrasingsFor(live, frame).map((p) => p(live, frame, rc).context);
    expect(out(fr('records_best', { records_label: '1996-97', records_seasons: 31 })).join(' ')).not.toMatch(/at the time/);
    expect(out(fr('career_high', { prior_value: 48 }))).toContain('A career high (previous best 48)');
  });
});

describe('first_since names what is first (FW-4)', () => {
  const FIRSTS: Frame[] = [
    fr('first_since', { since_date: '2018-03-26' }), fr('first_since', { since_label: '2021-22' }),
    fr('first_since', { since_date: '2018-03-26', who: 'subject' }), fr('first_since', { since_label: '2021-22', who: 'subject' }),
  ];
  it('every postgame kind × first_since frame × variant contains the fact\'s thing', () => {
    for (const f of FACTS) for (const frame of FIRSTS) {
      render(f, frame, false).forEach((out, i) => {
        expect(out.context, `${f.kind}/${f.stat}/${frame.who}#${i}`).toContain(f.data.thing!);
      });
    }
  });
  it('the production example names the assists', () => {
    const ast = makeFact({ ...base, kind: 'player_game_stat', stat: 'ast', value: 8, subject: { type: 'player', id: '9', name: 'Brook Lopez' },
      data: { thing: '8-assist game', best: 'most assists in a game', by: 'by a Clipper', label: 'assist', unit: 'assists' } });
    const lines = render(ast, fr('first_since', { since_date: '2018-03-26', who: 'subject' }), false).map((o) => o.context);
    expect(lines).toEqual(['His first 8-assist game since Mar 2018', 'His first 8-assist game since Mar 26, 2018']);
  });
});

describe('a milestone crossing never repeats its headline (FW-5)', () => {
  const crossings = FACTS.filter((f) => f.kind === 'milestone_crossed');
  it('the detail adds the total (dated) or falls back to the date and opponent', () => {
    for (const f of crossings) for (const frame of [fr('milestone', { step: 0 }), fr('none')]) {
      render(f, frame, false).forEach((out, i) => {
        const label = `${f.stat}/${f.data.total_value}#${i}: ${out.headline} | ${out.context}`;
        expect(out.headline.toLowerCase(), label).not.toContain(out.context.toLowerCase());
        expect(out.context, label).not.toContain(f.data.label!);
      });
    }
  });
  it('the production example: exactly 500 career threes reads the date and opponent', () => {
    const exact = crossings.find((f) => f.data.career && f.data.total_value === 500)!;
    const out = render(exact, fr('milestone', { step: 0 }), false);
    expect(out[1]).toEqual({ headline: 'Rui Hachimura reached 500 threes in his career', context: 'Nov 28, 2025 vs the Golden State Warriors' });
    const past = crossings.find((f) => f.data.career && f.data.total_value === 503)!;
    expect(render(past, fr('milestone', { step: 0 }), false)[1].context).toBe('503 threes in his career through Nov 28, 2025');
  });
});
