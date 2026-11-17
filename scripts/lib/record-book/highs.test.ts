import { describe, it, expect } from 'vitest';
import { buildHighsSql, highsParams, HIGH_SPECS, STAT_FIRST_SEASON } from './highs';

describe('HIGH_SPECS', () => {
  it('has unique stat keys per scope', () => {
    const keys = HIGH_SPECS.map((s) => `${s.scope}:${s.statKey}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
  it('ranks the opponent-points low ascending and everything else descending', () => {
    for (const s of HIGH_SPECS) expect(s.order).toBe(s.statKey === 'opp_pts_low' ? 'asc' : 'desc');
  });
  it('passes exactly the parameters each query references', () => {
    for (const s of HIGH_SPECS) {
      const sqlText = buildHighsSql(s);
      const params = highsParams(s, '13', 2024);
      const maxRef = Math.max(0, ...[...sqlText.matchAll(/\$(\d+)/g)].map((m) => Number(m[1])));
      expect(params.length, `${s.scope}:${s.statKey}`).toBe(maxRef);
    }
  });
  it('limits quarter highs to regulation quarters (periods 1-4)', () => {
    const team = HIGH_SPECS.find((x) => x.scope === 'lac_team' && x.statKey === 'team_q_pts')!;
    const player = HIGH_SPECS.find((x) => x.scope === 'lac_player' && x.statKey === 'q_pts')!;
    expect(team.source).toContain('pt.period <= 4');
    expect(player.source).toContain('pp.period <= 4');
  });
  it('builds an INSERT that keeps the top N per scope id', () => {
    const s = HIGH_SPECS.find((x) => x.scope === 'player_season' && x.statKey === 'pts')!;
    const text = buildHighsSql(s);
    expect(text).toContain('INSERT INTO rb_game_highs');
    expect(text).toContain('PARTITION BY s.scope_id');
    expect(text).toContain(`rn <= ${s.limit}`);
  });
  it('starts steals and blocks at 1983-84 and points at 1970-71', () => {
    const stl = HIGH_SPECS.find((s) => s.scope === 'lac_player' && s.statKey === 'stl')!;
    const pts = HIGH_SPECS.find((s) => s.scope === 'lac_player' && s.statKey === 'pts')!;
    expect(buildHighsSql(stl)).toContain(`s.game_date >= '1983-08-01'`);
    expect(buildHighsSql(pts)).toContain(`s.game_date >= '1970-08-01'`);
  });
  it('builds league-season highs only from complete league seasons', () => {
    const specs = HIGH_SPECS.filter((x) => x.scope === 'league_season');
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(s.source).toContain('HAVING COUNT(*) >= 700');
  });
  it('gives every spec a first season from the stat table', () => {
    for (const s of HIGH_SPECS) {
      expect(STAT_FIRST_SEASON[s.statKey], `${s.scope}:${s.statKey}`).toBeTypeOf('number');
      expect(s.firstSeason, `${s.scope}:${s.statKey}`).toBe(STAT_FIRST_SEASON[s.statKey]);
    }
  });
  it('starts play-by-play highs at 1996', () => {
    for (const k of ['team_q_pts', 'q_pts', 'half_pts']) expect(STAT_FIRST_SEASON[k]).toBe(1996);
  });
});
