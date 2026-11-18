import { describe, it, expect } from 'vitest';
import type { Frame } from '../../../../src/lib/insights/types';
import { MAX_HEADLINE, phrasingsFor, renderInsight } from './render';
import { TEMPLATES } from './templates/index';
import { FACT_KINDS } from './types';
import type { RenderContext } from './templates/shared';
import { COMPLETED_SEASON, CURRENT_SEASON, makeCtx, makeFact } from './__fixtures__/facts';
import type { Fact } from './types';

const teams = makeCtx().teams;
const rcNow: RenderContext = { surface: 'season', season: CURRENT_SEASON, teams };
const rcDone: RenderContext = { surface: 'season', season: COMPLETED_SEASON, teams };
const fr = (type: Frame['type'], extra: Partial<Frame> = {}): Frame => ({ type, strength: 0.5, who: 'group', text: '', proof_rows: [], ...extra });
const records = fr('records_best', { records_label: '2020-21', records_seasons: 6 });
const none = fr('none');
const say = (f: Fact, frame: Frame, rc: RenderContext, i = 0) => phrasingsFor(f, frame)[i](f, frame, rc);

const FIXTURES: Record<string, Fact> = {
  streak: makeFact(),
  team_streak: makeFact({ subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'wins', value: 6, data: { thing: 'winning streak', best: 'longest winning streak', by: 'by the Clippers', streak_games: [] } }),
  milestone: makeFact({ kind: 'milestone', stat: 'season_points', value: 1500, data: { threshold: 1500, step: 2, label: '1,500 points', formatted: '1,612 points', games: 60, thing: '1,500-point season', best: 'first 1,500-point season', by: 'by a Clipper', unit: 'points' } }),
  team_rank: makeFact({ kind: 'league_rank', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'team_off_rating', value: 3, data: { rank: 3, total: 30, label: 'offensive rating', formatted: '118.4', higherIsBetter: true } }),
  player_rank: makeFact({ kind: 'league_rank', stat: 'player_ppg', value: 4, data: { rank: 4, total: 150, label: 'scoring', formatted: '27.1 PPG', higherIsBetter: true, min_games: 30 } }),
  standings: makeFact({ kind: 'standings', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'conf_rank', value: 1, data: { rank: 1, total: 15, wins: 45, losses: 15, conference: 'West', league_rank: 2, league_teams: 30 } }),
  recent: makeFact({ kind: 'recent_form', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'last10_net_rating', value: 2, data: { rank: 2, total: 30, label: 'net rating', formatted: '+9.8' } }),
  yoy_team: makeFact({ kind: 'yoy_change', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'team_rank_net_rating', value: 3, data: { yoy: 'team_rank', rank: 3, total: 30, prev_rank: 18, label: 'net rating', formatted: '+8.4', prev_formatted: '-1.2', higherIsBetter: true } }),
  yoy_record: makeFact({ kind: 'yoy_change', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'record', value: 0.75, data: { yoy: 'record', wins: 45, losses: 15, prev_wins: 33, prev_losses: 27, prev_value: 0.55, cur_value: 0.75 } }),
  yoy_player: makeFact({ kind: 'yoy_change', stat: 'player_ppg', value: 27.1, data: { yoy: 'player', label: 'scoring', formatted: '27.1 PPG', prev_formatted: '21.4 PPG', games: 60, prev_games: 58 } }),
  opp_rank: makeFact({ kind: 'opp_rank', surface: 'pregame', subject: { type: 'team', id: '2', name: 'Golden State Warriors' }, stat: 'opp_def_rating', value: 3, context: { date: '2026-03-01', opponent_id: '2' }, data: { rank: 3, total: 30, side: 'defense', formatted: '108.2' } }),
  h2h: makeFact({ kind: 'h2h', surface: 'pregame', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'h2h', value: 2, context: { date: '2026-03-01', opponent_id: '2' }, data: { wins: 2, opp_wins: 1, meetings: 3 } }),
  last_meeting: makeFact({ kind: 'last_meeting', surface: 'pregame', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'last_meeting', value: 14, context: { date: '2026-03-01', opponent_id: '2' }, data: { lac_score: 118, opp_score: 104, meeting_date: '2026-02-01', meeting_home: true } }),
  night: makeFact({ kind: 'league_night', surface: 'postgame', stat: 'pts', value: 55, window: { type: 'game', game_id: '500', season_id: 2025 }, context: { date: '2025-11-28', opponent_id: '2', home: true, result: 'W' }, gameId: '500', data: { thing: '55-point game', best: 'most points in a game', by: 'by a Clipper', label: 'scoring', unit: 'points', rank: 1, total: 18000 } }),
};

describe('templates (exact copy)', () => {
  it('streaks', () => {
    expect(say(FIXTURES.streak, records, rcDone)).toEqual({
      headline: 'Star Clipper closed 2025-26 with 30+ points in 5 straight games',
      context: 'Longest streak of 30+ points by a Clipper since 2020-21',
    });
    expect(say(FIXTURES.streak, records, rcNow, 1)).toEqual({
      headline: 'Star Clipper has 5 straight games with 30+ points',
      context: 'Longest streak of 30+ points by a Clipper in 6 seasons of records',
    });
    expect(say(FIXTURES.team_streak, fr('longest_since', { since_date: '2024-01-12' }), rcNow)).toEqual({
      headline: 'Clippers have won 6 straight', context: 'Longest winning streak by the Clippers since Jan 2024',
    });
  });
  it('milestones and ranks', () => {
    expect(say(FIXTURES.milestone, fr('milestone', { step: 2 }), rcDone))
      .toEqual({ headline: 'Star Clipper reached 1,500 points in 2025-26', context: '1,612 points in 60 games' });
    expect(say(FIXTURES.milestone, fr('first_since', { since_label: '2021-22' }), rcDone).context)
      .toBe('First 1,500-point season by a Clipper since 2021-22');
    expect(say(FIXTURES.team_rank, fr('league_rank', { rank: 3, total: 30 }), rcDone))
      .toEqual({ headline: 'Clippers ranked 3rd in the NBA in offensive rating in 2025-26', context: '118.4 — 3rd of 30 teams' });
    expect(say(FIXTURES.player_rank, none, rcNow))
      .toEqual({ headline: 'Star Clipper ranks 4th in the NBA in scoring this season', context: '27.1 PPG — 4th of 150 qualified players (min 30 games)' });
    expect(say(FIXTURES.standings, fr('league_rank'), rcNow))
      .toEqual({ headline: 'Clippers are 45-15, 1st in the West', context: '2nd of 30 teams league-wide by win percentage' });
    expect(say(FIXTURES.recent, fr('league_rank'), rcNow))
      .toEqual({ headline: 'Clippers rank 2nd in net rating over their last 10 games', context: '+9.8 — 2nd of 30 teams (as of Feb 21, 2026)' });
  });
  it('year over year', () => {
    expect(say(FIXTURES.yoy_team, fr('league_rank'), rcDone))
      .toEqual({ headline: "Clippers' net rating improved from 18th in 2024-25 to 3rd in 2025-26", context: '-1.2 → +8.4' });
    expect(say(FIXTURES.yoy_record, none, rcDone))
      .toEqual({ headline: 'Clippers won 45 games in 2025-26, up from 33 in 2024-25', context: '45-15 vs 33-27 (regular season)' });
    expect(say(FIXTURES.yoy_record, fr('first_since', { since_label: '2021-22' }), rcDone).context).toBe('Their best win percentage since 2021-22');
    expect(say(FIXTURES.yoy_player, fr('career_high'), rcNow))
      .toEqual({ headline: "Star Clipper's scoring rose from 21.4 PPG last season to 27.1 PPG this season", context: 'A career-best season' });
  });
  it('pregame and postgame', () => {
    const pre: RenderContext = { ...rcNow, surface: 'pregame' };
    expect(say(FIXTURES.opp_rank, fr('league_rank'), pre))
      .toEqual({ headline: 'Up next: the Golden State Warriors have the 3rd-ranked defense this season', context: 'Defensive rating 108.2 — 3rd of 30 (lower is better)' });
    expect(say(FIXTURES.h2h, none, { ...pre, season: COMPLETED_SEASON }))
      .toEqual({ headline: 'Clippers went 2-1 vs the Golden State Warriors in 2025-26', context: '3 meetings (incl. postseason)' });
    expect(say(FIXTURES.last_meeting, none, pre))
      .toEqual({ headline: 'Last meeting: Clippers won 118-104 vs the Golden State Warriors', context: 'Home, Feb 1, 2026' });
    const post: RenderContext = { ...rcDone, surface: 'postgame' };
    expect(say(FIXTURES.night, records, post))
      .toEqual({ headline: 'Star Clipper scored 55 vs the Warriors', context: 'Most points in a game by a Clipper since 2020-21' });
    expect(say(FIXTURES.night, fr('league_rank', { rank: 1 }), post).context).toBe('The best scoring night in the NBA in 2025-26');
  });
});

describe('every template renders clean and fits', () => {
  const FRAMES: Frame[] = [
    records, none, fr('career_high', { prior_value: 48 }), fr('only_one', { records_label: '2020-21' }),
    fr('joins_company', { names: ['Paul George', 'Kawhi Leonard'], records_label: '2020-21' }),
    fr('first_since', { since_date: '2021-03-01' }), fr('first_since', { since_label: '2021-22', who: 'subject' }),
    fr('longest_since', { since_date: '2021-03-01' }), fr('clippers_rank', { rank: 3, records_label: '2020-21' }),
    fr('season_high'), fr('season_high', { who: 'subject' }), fr('nth_time', { count: 3 }), fr('league_rank', { rank: 7, total: 30 }),
    fr('milestone', { step: 1 }),
  ];
  const LONG_NAME = 'Shai Gilgeous-Alexander';
  it('has no undefined/NaN/null and stays within 90 characters', () => {
    for (const [name, base] of Object.entries(FIXTURES)) {
      const long = base.subject.type === 'player' ? { ...base, subject: { ...base.subject, name: LONG_NAME } } : base;
      for (const f of [base, long]) for (const frame of FRAMES) for (const rc of [rcNow, rcDone]) {
        const list = phrasingsFor(f, frame);
        expect(list.length, name).toBeGreaterThanOrEqual(1);
        for (const p of list) {
          const out = p(f, frame, { ...rc, surface: f.surface });
          expect(`${out.headline} | ${out.context}`, `${name}/${frame.type}`).not.toMatch(/undefined|NaN|\bnull\b|\[object/);
          expect(out.headline.length, out.headline).toBeLessThanOrEqual(MAX_HEADLINE);
        }
      }
    }
  });
  it('covers every fact kind', () => {
    expect(Object.keys(TEMPLATES).sort()).toEqual([...FACT_KINDS].sort());
  });
});

describe('review fixes: yoy context only claims what the fact supports', () => {
  const player = FIXTURES.yoy_player;
  const team = FIXTURES.yoy_team;
  const recordsFrame = fr('records_best', { records_label: '2020-21', records_seasons: 6 });
  it('player records_best and first_since use player wording and pronoun', () => {
    expect(say(player, recordsFrame, rcNow).context).toBe('His best scoring in 6 seasons of records');
    expect(say(player, fr('first_since', { since_label: '2021-22' }), rcNow).context).toBe('His best scoring since 2021-22');
  });
  it('team_rank yoy falls back to the rank move for records, first_since and career_high', () => {
    for (const frame of [recordsFrame, fr('first_since', { since_label: '2021-22' }), fr('career_high')]) {
      expect(say(team, frame, rcDone).context).toBe('-1.2 → +8.4');
    }
  });
  it('win-percentage wording appears only on record yoy, and career-best only on player yoy', () => {
    for (const f of [player, team]) for (const frame of [recordsFrame, fr('first_since', { since_label: '2021-22' }), fr('career_high')]) {
      const ctx = say(f, frame, rcDone).context;
      expect(ctx, `${f.stat}/${frame.type}`).not.toMatch(/win percentage/);
      if (f.subject.type === 'team') expect(ctx, `${f.stat}/${frame.type}`).not.toMatch(/career/i);
    }
    expect(say(FIXTURES.yoy_record, recordsFrame, rcDone).context).toBe('Their best win percentage in 6 seasons of records');
    expect(say(player, fr('career_high'), rcNow).context).toBe('A career-best season');
  });
});

describe('review fixes: frame lines drop when their fields are missing', () => {
  it('never leaves a dangling since or an empty records span', () => {
    const bare: Frame[] = [
      fr('first_since'), fr('longest_since'), fr('records_best'), fr('only_one'),
      fr('joins_company'), fr('clippers_rank'), fr('nth_time'), fr('career_high'),
    ];
    const facts = [FIXTURES.streak, FIXTURES.team_streak, FIXTURES.night, FIXTURES.yoy_player, FIXTURES.yoy_record, FIXTURES.yoy_team, FIXTURES.milestone];
    for (const f of facts) for (const frame of bare) for (const p of phrasingsFor(f, frame)) {
      const ctx = p(f, frame, rcDone).context;
      expect(ctx, `${f.kind}/${frame.type}: ${ctx}`).not.toMatch(/since\s*$|\s{2}|\bin\s+seasons|\bin\s*$|of records/);
    }
  });
});

describe('review fixes: direction words and team streak tense', () => {
  it('a player who fell is not described as having risen', () => {
    const fell = makeFact({
      kind: 'yoy_change', stat: 'player_ppg', value: 27.1,
      data: { yoy: 'player', label: 'scoring', formatted: '27.1 PPG', prev_formatted: '30.2 PPG', games: 60, prev_games: 58 },
    });
    expect(say(fell, none, rcNow).headline)
      .toBe("Star Clipper's scoring fell from 30.2 PPG last season to 27.1 PPG this season");
  });
  it('a team rank that holds is not described as slipping', () => {
    const held = makeFact({
      kind: 'yoy_change', subject: { type: 'team', id: '1', name: 'Clippers' }, stat: 'team_rank_net_rating', value: 3,
      data: { yoy: 'team_rank', rank: 3, total: 30, prev_rank: 3, label: 'net rating', formatted: '+8.4', prev_formatted: '+8.4', higherIsBetter: true },
    });
    const out = say(held, none, rcNow).headline;
    expect(out).toBe("Clippers' net rating held at 3rd this season");
    expect(out).not.toMatch(/slipped|improved/);
  });
  it('team streaks use past tense once the season is complete', () => {
    expect(say(FIXTURES.team_streak, none, rcDone).headline).toBe('Clippers won 6 straight in 2025-26');
    expect(say(FIXTURES.team_streak, none, rcDone, 1).headline).toBe('Clippers: 6 straight wins in 2025-26');
    expect(say(FIXTURES.team_streak, none, rcNow).headline).toBe('Clippers have won 6 straight');
  });
});

describe('renderInsight', () => {
  it('chooses a stable phrasing by key', () => {
    const f = FIXTURES.streak;
    const a = renderInsight(f, records, rcDone, '00000000aaaa');
    const b = renderInsight(f, records, rcDone, '00000001aaaa');
    expect(a!.headline).toBe(say(f, records, rcDone, 0).headline);
    expect(b!.headline).toBe(say(f, records, rcDone, 1).headline);
  });
  it('falls back to the shortest phrasing when the chosen one overflows', () => {
    // A 40-character name pushes the chosen phrasing (index 0) to 91 characters,
    // while the shortest (index 1) is 85: the fallback path must run and win.
    const name = 'A'.repeat(40);
    const f = { ...FIXTURES.streak, subject: { ...FIXTURES.streak.subject, name } };
    const chosen = say(f, records, rcDone, 0);
    const shortest = say(f, records, rcDone, 1);
    expect(chosen.headline.length).toBeGreaterThan(MAX_HEADLINE);
    expect(shortest.headline.length).toBeLessThanOrEqual(MAX_HEADLINE);
    const out = renderInsight(f, records, rcDone, '00000000');
    expect(out).not.toBeNull();
    expect(out!.headline).toBe(shortest.headline);
    expect(out!.headline.length).toBe(85);
    expect(out!.context).toBe(shortest.context);
  });
  it('drops the insight when even the shortest phrasing overflows', () => {
    const huge = { ...FIXTURES.streak, subject: { ...FIXTURES.streak.subject, name: 'A'.repeat(120) } };
    expect(renderInsight(huge, records, rcDone, '00000000')).toBeNull();
  });
});
