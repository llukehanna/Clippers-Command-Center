import { describe, it, expect } from 'vitest';
import { buildHighsSql, highsParams, HIGH_SPECS } from './highs';

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
});
