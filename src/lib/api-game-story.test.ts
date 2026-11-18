import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
vi.mock('./db.js', () => ({
  sql: new Proxy(mockSql, {
    apply: (target, thisArg, args) => Reflect.apply(target, thisArg, args),
    get: (target, prop) => (prop === 'unsafe' ? (s: string) => s : (target as unknown as Record<string | symbol, unknown>)[prop]),
  }),
  LAC_NBA_TEAM_ID: 1610612746,
}));

const GAME = { game_id: '100', status: 'final', home_team_id: '1', away_team_id: '2', home_abbr: 'LAC', away_abbr: 'SAS', home_is_lac: true, away_is_lac: false };
const shot = (i: number) => ({ x: 25, y: i, made: i % 2 === 0, shot_value: 2, player_id: '10', player: 'Kawhi Leonard' });

type Responder = () => unknown;
function respond(overrides: Record<string, Responder> = {}) {
  const base: Record<string, Responder> = {
    'FROM all_games g': () => [GAME],
    'FROM game_flow': () => [{ margin_series: [[0, 0], [30, 2], [2870, 5]], lac_largest_lead: 9, lac_largest_deficit: 1, lead_changes: 2, times_tied: 1, lac_best_run: 9, opp_best_run: 6 }],
    '-- story:spread': () => [{ lac_spread: -6 }],
    "key = 'wp:model'": () => [],
    '-- story:descriptions': () => [{ elapsed_sec: 30, description: 'Kawhi Leonard makes layup' }],
    'FROM period_team_stats': () => [
      { team_id: '1', period: 1, pts: 30, fgm: 11, fga: 22, fg3m: 3, fg3a: 8, ftm: 5, fta: 6 },
      { team_id: '2', period: 1, pts: 25, fgm: 10, fga: 24, fg3m: 2, fg3a: 9, ftm: 3, fta: 4 },
    ],
    'FROM period_player_stats': () => [{ period: 1, name: 'Kawhi Leonard', pts: 12 }],
    'FROM clutch_stats': () => [
      { team_id: '1', player_id: null, name: null, pts: 8, fgm: 3, fga: 5, fg3m: 1, ftm: 1, fta: 2, tov: 0 },
      { team_id: '2', player_id: null, name: null, pts: 4, fgm: 2, fga: 6, fg3m: 0, ftm: 0, fta: 0, tov: 1 },
      { team_id: '1', player_id: '10', name: 'Kawhi Leonard', pts: 6, fgm: 2, fga: 3, fg3m: 1, ftm: 1, fta: 2, tov: 0 },
    ],
    '-- story:shots': () => Array.from({ length: 12 }, (_, i) => shot(i + 1)),
    'FROM rb_game_highs': () => [{ scope: 'player_career', stat_key: 'pts', rank: 1, value: '41', player_id: '10', player: 'Kawhi Leonard' }],
    '-- story:starts': () => [{ key: 'insights.records_start', value: 2020 }, { key: 'insights.pbp_records_start', value: 2019 }],
  };
  const table = { ...base, ...overrides };
  mockSql.mockImplementation(async (strings: readonly string[]) => {
    const q = strings.join('?');
    for (const [needle, fn] of Object.entries(table)) if (q.includes(needle)) return fn();
    return [];
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function load(id = '100'): Promise<{ status: number; body: any }> {
  const { loadGameStory } = await import('./data/game-story');
  return loadGameStory(id);
}

describe('loadGameStory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    respond();
  });

  it('404s bad and unknown ids', async () => {
    expect((await load('x')).status).toBe(404);
    respond({ 'FROM all_games g': () => [] });
    expect((await load()).status).toBe(404);
  });

  it('rebuilds the flow from the series with the closing spread', async () => {
    const { body } = await load();
    expect(body.flow.expected_source).toBe('spread');
    expect(body.flow.flow.points.at(-1)).toMatchObject({ t: 2880, m: 5, wp: 1 });
    expect(body.flow.flow.points.find((p: { t: number }) => p.t === 30).d).toBe('Kawhi Leonard makes layup');
    expect(body.flow.summary).toEqual({ largest_lead: 9, largest_deficit: 1, lead_changes: 2, times_tied: 1, lac_best_run: 9, opp_best_run: 6 });
  });

  it('builds quarters, clutch, shots and record notes', async () => {
    const { body } = await load();
    expect(body.quarters).toEqual([{
      period: 1,
      lac: { pts: 30, fgm: 11, fga: 22, fg3m: 3, fg3a: 8, ftm: 5, fta: 6 },
      opp: { pts: 25, fgm: 10, fga: 24, fg3m: 2, fg3a: 9, ftm: 3, fta: 4 },
      lac_top: { name: 'Kawhi Leonard', pts: 12 },
    }]);
    expect(body.clutch.lac.pts).toBe(8);
    expect(body.clutch.opp.pts).toBe(4);
    expect(body.clutch.players).toEqual([{ name: 'Kawhi Leonard', pts: 6, fgm: 2, fga: 3 }]);
    expect(body.shots.located).toBe(12);
    expect(body.shots.shots[0]).toEqual({ x: 25, y: 1, made: false, value: 2, player_id: '10', player: 'Kawhi Leonard' });
    expect(body.records[0].text).toBe('Kawhi Leonard: 41 points — career high');
  });

  it('nulls each section without data', async () => {
    respond({
      'FROM game_flow': () => [],
      'FROM period_team_stats': () => [],
      'FROM clutch_stats': () => [],
      '-- story:shots': () => [shot(1)],
      'FROM rb_game_highs': () => [],
    });
    const { status, body } = await load();
    expect(status).toBe(200);
    expect([body.flow, body.quarters, body.clutch, body.shots, body.records]).toEqual([null, null, null, null, null]);
  });

  it('nulls a section whose query throws', async () => {
    respond({ 'FROM clutch_stats': () => { throw new Error('boom'); } });
    const { status, body } = await load();
    expect(status).toBe(200);
    expect(body.clutch).toBeNull();
    expect(body.quarters).not.toBeNull();
  });
});
