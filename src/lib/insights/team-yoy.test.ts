import { describe, expect, it } from 'vitest';
import type { CardSourceRow } from './card';
import { mergeTeamYoy, teamYoyRow } from './team-yoy';

function yoy(id: string, stat: string, importance: number, prev: number, cur: number, over: Partial<CardSourceRow> = {}): CardSourceRow {
  return {
    insight_id: id, surface: 'season', category: 'yoy_change', player_id: null, game_id: null, season_id: 2026,
    game_date: null, detail: null,
    frame: { type: 'none', strength: 0, who: 'group', text: '', proof_rows: [], stat },
    evidence: null,
    // Real proof: both seasons' fact rows, stored out of order is fine.
    proof_result: [
      { part: 'fact', data: { season_id: 2026, rank: cur, tied: 0, total_teams: 30, moved: prev - cur } },
      { part: 'fact', data: { season_id: 2025, rank: prev, tied: 0, total_teams: 30, moved: prev - cur } },
    ],
    headline: 'x', importance, entities: null, updated_at: `2026-11-1${importance % 10}T00:00:00Z`,
    nba_person_id: null, player_name: null, opp_abbr: null, lac_home: null, lac_score: null, opp_score: null,
    ...over,
  };
}
const off = (o: Partial<CardSourceRow> = {}) => yoy('off', 'team_rank_off_rating', 40, 10, 22, o);
const def = (o: Partial<CardSourceRow> = {}) => yoy('def', 'team_rank_def_rating', 55, 18, 25, o);
const net = (o: Partial<CardSourceRow> = {}) => yoy('net', 'team_rank_net_rating', 48, 15, 22, o);

describe('teamYoyRow', () => {
  it('reads from/to/total by season', () => {
    expect(teamYoyRow(off())).toEqual({ label: 'Offense', from: 10, to: 22, total: 30 });
  });
  it('record rows return null', () => {
    expect(teamYoyRow(yoy('r', 'record', 30, 0, 0, { proof_result: [{ part: 'fact', data: { season_id: 2026, wins: 3, losses: 1 } }] }))).toBeNull();
  });
  it('falls back to headline wording when frame.stat is missing', () => {
    const r = off({ frame: null, headline: "Clippers' defensive rating: 18th last season, 25th this season" });
    expect(teamYoyRow(r)?.label).toBe('Defense');
  });
  it('legacy proof returns null', () => {
    expect(teamYoyRow(off({ proof_result: { a: 1 } }))).toBeNull();
  });
});

describe('mergeTeamYoy', () => {
  it('all slipped', () => {
    const c = mergeTeamYoy([net(), off(), def()])!;
    expect(c.headline).toBe('The Clippers have slipped in offense, defense and net rating');
    expect(c.context_label).toBe('League ranks vs last season');
    expect(c.team_yoy?.map((r) => r.label)).toEqual(['Offense', 'Defense', 'Net']);
    expect(c.importance).toBe(55);
    expect(c.insight_id).toBe('def');
    expect([...c.merged_ids].sort()).toEqual(['net', 'off']);
    expect(c.subject.kind).toBe('team');
    expect(c.href).toBeNull();
  });

  it('all improved', () => {
    const better = [yoy('a', 'team_rank_off_rating', 1, 22, 10), yoy('b', 'team_rank_def_rating', 2, 25, 18), yoy('c', 'team_rank_net_rating', 3, 22, 15)];
    expect(mergeTeamYoy(better)!.headline).toBe('The Clippers have improved in offense, defense and net rating');
  });

  it('mixed', () => {
    const mixed = [yoy('a', 'team_rank_off_rating', 1, 22, 10), yoy('b', 'team_rank_def_rating', 2, 18, 25)];
    expect(mergeTeamYoy(mixed)!.headline).toBe("The Clippers' league ranks vs last season");
  });

  it('two ratings read naturally; zero usable rows is null', () => {
    expect(mergeTeamYoy([off(), net()])!.headline).toBe('The Clippers have slipped in offense and net rating');
    expect(mergeTeamYoy([])).toBeNull();
    expect(mergeTeamYoy([off({ proof_result: [] })])).toBeNull();
  });
});
