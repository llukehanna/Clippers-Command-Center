import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
vi.mock('./db.js', () => ({
  sql: new Proxy(mockSql, {
    apply: (target, thisArg, args) => Reflect.apply(target, thisArg, args),
    get: (target, prop) => (target as unknown as Record<string | symbol, unknown>)[prop],
  }),
  LAC_NBA_TEAM_ID: 1610612746,
}));
vi.mock('./espn/fetch.js', () => ({ fetchEspnJson: async () => null }));

const ROW = { game_id: '101', game_date: '2026-11-20', season_id: 2026, start_time_utc: '2026-11-21T01:00:00Z', status: 'scheduled', arena: null, lac_home: false, opponent_abbr: 'SAS', lac_score: null, opp_score: null };

describe('calendar routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSql.mockImplementation(async () => [ROW]);
  });

  it('serves one game as a downloadable calendar', async () => {
    const { GET } = await import('../../app/schedule/[game_id]/ics/route');
    const res = await GET(new Request('http://x/schedule/101/ics'), { params: Promise.resolve({ game_id: '101' }) });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/calendar');
    expect(res.headers.get('content-disposition')).toContain('lac-at-sas-2026-11-20.ics');
    const body = await res.text();
    expect(body).toContain('SUMMARY:LAC @ SAS');
    expect(body).toContain('UID:ccc-101@clippers.lukeghanna.com');
  });

  it('404s an unknown or invalid game', async () => {
    mockSql.mockImplementation(async () => []);
    const { GET } = await import('../../app/schedule/[game_id]/ics/route');
    expect((await GET(new Request('http://x'), { params: Promise.resolve({ game_id: '999' }) })).status).toBe(404);
    expect((await GET(new Request('http://x'), { params: Promise.resolve({ game_id: 'abc' }) })).status).toBe(404);
  });

  it('serves the season feed', async () => {
    const { GET } = await import('../../app/schedule.ics/route');
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toBeNull();
    expect(await res.text()).toContain('X-WR-CALNAME:Clippers');
  });
});
