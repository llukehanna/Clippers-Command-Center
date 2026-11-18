import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
vi.mock('./db.js', () => ({
  sql: new Proxy(mockSql, {
    apply: (target, thisArg, args) => Reflect.apply(target, thisArg, args),
    get: (target, prop) => (prop === 'unsafe' ? (s: string) => s : (target as unknown as Record<string | symbol, unknown>)[prop]),
  }),
  LAC_NBA_TEAM_ID: 1610612746,
}));
const fetchEspnJson = vi.fn();
vi.mock('./espn/fetch.js', () => ({ fetchEspnJson: (url: string) => fetchEspnJson(url) }));

const GAME = {
  game_id: '101', game_date: '2026-11-20', season_id: 2026, status: 'scheduled', arena: 'Frost Bank Center',
  start_time_utc: '2026-11-21T01:00:00Z', is_preseason: false, home_team_id: '2', away_team_id: '1',
  home_abbr: 'SAS', away_abbr: 'LAC', home_city: 'San Antonio', away_city: 'LA', home_name: 'Spurs', away_name: 'Clippers',
  home_is_lac: false, away_is_lac: true,
};

type Responder = (q: string) => unknown;
function respond(overrides: Record<string, Responder> = {}) {
  const base: Record<string, Responder> = {
    'FROM all_games g': () => [GAME],
    'FROM odds_snapshots': () => [
      { captured_at: '2026-11-18T12:00:00Z', spread_home: -2.5, spread_away: 2.5, moneyline_home: -130, moneyline_away: 110, total_points: 224.5 },
      { captured_at: '2026-11-19T12:00:00Z', spread_home: -1.5, spread_away: 1.5, moneyline_home: -120, moneyline_away: 100, total_points: 225.5 },
    ],
    "key = 'wp:model'": () => [],
    '-- preview:record': () => [{ team_id: '1', wins: 9, losses: 4 }, { team_id: '2', wins: 6, losses: 7 }],
    'FROM rolling_team_stats': () => [{ team_id: '1', net_rating: 4.2, record_wins: 7, record_losses: 3 }],
    '-- preview:ranks': () => [{ team_id: '2', off: 114.1, def: 112.0, net: 2.1, off_rank: 9, def_rank: 14, net_rank: 11, total: 30 }],
    '-- preview:meetings': () => [{ game_id: '50', game_date: '2026-11-01', season_id: 2026, lac_home: true, home_score: 110, away_score: 100 }],
    '-- preview:rest': () => [{ team_id: '1', prev_date: '2026-11-19' }, { team_id: '2', prev_date: '2026-11-17' }],
    'FROM insights': () => [],
  };
  const table = { ...base, ...overrides };
  mockSql.mockImplementation(async (strings: readonly string[]) => {
    const q = strings.join('?');
    for (const [needle, fn] of Object.entries(table)) if (q.includes(needle)) return fn(q);
    return [];
  });
}

async function load(id = '101') {
  const { loadGamePreview } = await import('./data/game-preview');
  return loadGamePreview(id);
}

describe('loadGamePreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fetchEspnJson.mockResolvedValue(null);
    respond();
  });

  it('404s a non-numeric or unknown id', async () => {
    expect((await load('abc')).status).toBe(404);
    respond({ 'FROM all_games g': () => [] });
    expect((await load('999')).status).toBe(404);
  });

  it('404s a game the Clippers are not in', async () => {
    respond({ 'FROM all_games g': () => [{ ...GAME, away_is_lac: false }] });
    expect((await load()).status).toBe(404);
  });

  it('builds the line from the Clippers side with movement and a model win probability', async () => {
    const res = await load();
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = res.body as any;
    expect(body.game).toMatchObject({ home_away: 'away', opponent_abbr: 'SAS', odds: { spread: 1.5, moneyline: 100, over_under: 225.5 } });
    expect(body.line.movement.map((p: { spread: number }) => p.spread)).toEqual([2.5, 1.5]);
    expect(body.line.win_prob.source).toBe('spread');
    expect(body.line.win_prob.lac).toBeLessThan(0.5);
  });

  it('fills the matchup from records, rolling form, ranks, meetings and rest', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const m = ((await load()).body as any).matchup;
    expect(m.lac.record).toEqual({ wins: 9, losses: 4 });
    expect(m.lac.last10).toEqual({ wins: 7, losses: 3, net_rating: 4.2 });
    expect(m.opp.last10).toBeNull();
    expect(m.opp.ranks.off).toEqual({ value: 114.1, rank: 9, of: 30 });
    expect(m.lac.ranks).toBeNull();
    expect(m.meetings[0]).toMatchObject({ game_id: '50', won: true, lac_score: 110, opp_score: 100 });
    expect(m.season_series).toEqual({ wins: 1, losses: 0 });
    expect(m.lac.days_since_last).toBe(1);
    expect(m.opp.days_since_last).toBe(3);
  });

  it('hides a section whose query fails and keeps the page', async () => {
    respond({ 'FROM odds_snapshots': () => { throw new Error('boom'); } });
    const res = await load();
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res.body as any).line).toBeNull();
  });

  it('shows the home-court estimate before lines post', async () => {
    respond({ 'FROM odds_snapshots': () => [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const line = ((await load()).body as any).line;
    expect(line.current).toBeNull();
    expect(line.win_prob.source).toBe('home_court');
  });

  it('reads ESPN broadcasts and injuries, and nulls them when ESPN is down', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let body = (await load()).body as any;
    expect(body.broadcasts).toBeNull();
    expect(body.injuries).toBeNull();

    fetchEspnJson.mockImplementation(async (url: string) =>
      url.includes('/injuries')
        ? { timestamp: 't', injuries: [{ injuries: [{ status: 'Out', athlete: { displayName: 'Bradley Beal', team: { abbreviation: 'LAC' } }, details: { type: 'Hip' } }] }] }
        : { events: [{ id: '1', date: '2026-11-21T01:00Z', competitions: [{ competitors: [{ homeAway: 'home', team: { abbreviation: 'SA' } }, { homeAway: 'away', team: { abbreviation: 'LAC' } }], broadcasts: [{ market: { type: 'Away' }, type: { shortName: 'TV' }, media: { shortName: 'KTLA' } }] }] }] }
    );
    body = (await load()).body;
    expect(body.broadcasts).toEqual([{ name: 'KTLA', kind: 'tv', group: 'clippers' }]);
    expect(body.injuries.lac[0]).toMatchObject({ name: 'Bradley Beal', status: 'Out', injury: 'Hip' });
    expect(body.injuries.opp).toEqual([]);
  });
});
