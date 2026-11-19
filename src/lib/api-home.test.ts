// src/lib/api-home.test.ts
// Tests for GET /api/home (app/api/home/route.ts) — covers API-02 and API-07.
// The sql tag is mocked and dispatches on query text so tests run offline and
// don't depend on the order in which the route issues its queries.

import { buildMeta } from './api-utils.js';
import { REGULAR_SEASON_SQL } from './game-type';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Smoke test (passes immediately) ─────────────────────────────────────────

describe('buildMeta for home endpoint', () => {
  it('source db with ttl_seconds 300 returns correct meta', () => {
    const meta = buildMeta('db', 300);
    expect(meta.source).toBe('db');
    expect(meta.ttl_seconds).toBe(300);
    expect(meta.stale).toBe(false);
  });
});

// ─── Route handler tests ──────────────────────────────────────────────────────

type SqlArgs = [readonly string[], ...unknown[]];

const mockSqlFn = vi.fn<(...args: SqlArgs) => Promise<unknown[]>>();

vi.mock('@/src/lib/db', () => ({
  // sql.unsafe(fragment) is used for shared raw SQL fragments (game type, minutes)
  sql: Object.assign((...args: SqlArgs) => mockSqlFn(...args), { unsafe: (fragment: string) => fragment }),
  LAC_NBA_TEAM_ID: 13,
}));

const mockGetLatestOdds = vi.fn<(gameId: string) => Promise<unknown>>();

vi.mock('@/src/lib/odds', () => ({
  getLatestOdds: (gameId: string) => mockGetLatestOdds(gameId),
}));

const LAC_TEAM_ID = '42';
const DISPLAY_SEASON = 2025;

let last10Rows: unknown[] = [];
let upcomingRows: unknown[] = [];

function queryText(args: SqlArgs): string {
  return args[0].join('?');
}

/** Find the recorded call whose SQL text matches `pattern`. */
function findCall(pattern: RegExp): SqlArgs | undefined {
  return mockSqlFn.mock.calls.find((call) => pattern.test(queryText(call)));
}

beforeEach(() => {
  vi.clearAllMocks();
  last10Rows = [];
  upcomingRows = [];
  mockGetLatestOdds.mockResolvedValue(null);
  mockSqlFn.mockImplementation(async (...args: SqlArgs) => {
    const q = queryText(args);
    if (q.includes('display_season_id')) return [{ display_season_id: DISPLAY_SEASON }];
    if (/^\s*SELECT team_id::text AS team_id, abbreviation\s+FROM teams/.test(q)) {
      return [{ team_id: LAC_TEAM_ID, abbreviation: 'LAC' }];
    }
    if (q.includes('home_abbr') && q.includes("lower(g.status) = 'final'")) return last10Rows;
    if (q.includes('home_abbr') && q.includes("lower(g.status) <> 'final'")) return upcomingRows;
    return [];
  });
});

async function getHome() {
  const { GET } = await import('@/app/api/home/route');
  return GET(new Request('http://localhost:3000/api/home'));
}

describe('GET /api/home', () => {
  it('team_snapshot.conference_seed is null when standings are unavailable', async () => {
    const body = await (await getHome()).json();
    expect(body.team_snapshot.conference_seed).toBeNull();
  });

  it('team_snapshot.net_rating is null when LAC has no advanced stats for the season', async () => {
    const body = await (await getHome()).json();
    expect(body.team_snapshot.net_rating).toBeNull();
    expect(body.team_snapshot.off_rating).toBeNull();
    expect(body.team_snapshot.def_rating).toBeNull();
  });

  it('last_10 has numeric wins and losses fields', async () => {
    const body = await (await getHome()).json();
    expect(typeof body.team_snapshot.last_10.wins).toBe('number');
    expect(typeof body.team_snapshot.last_10.losses).toBe('number');
  });

  it('last_10.wins + last_10.losses <= 10 (at most 10 games considered)', async () => {
    const body = await (await getHome()).json();
    const { wins, losses } = body.team_snapshot.last_10;
    expect(wins + losses).toBeLessThanOrEqual(10);
  });

  it('player_trends is an array (empty when box score data is sparse)', async () => {
    const body = await (await getHome()).json();
    expect(Array.isArray(body.player_trends)).toBe(true);
    expect(body.player_trends.length).toBeLessThanOrEqual(8);
  });

  it('upcoming_schedule is an array and next_game is null when no future LAC games exist', async () => {
    const body = await (await getHome()).json();
    expect(Array.isArray(body.upcoming_schedule)).toBe(true);
    expect(body.next_game).toBeNull();
  });

  it('meta has all 5 required fields and ttl_seconds 300', async () => {
    const body = await (await getHome()).json();
    expect(body.meta).toHaveProperty('generated_at');
    expect(body.meta).toHaveProperty('source');
    expect(body.meta).toHaveProperty('stale');
    expect(body.meta).toHaveProperty('stale_reason');
    expect(body.meta.ttl_seconds).toBe(300);
  });

  it('response has Cache-Control: public, max-age=300 header', async () => {
    const res = await getHome();
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
  });

  it('insights is an array', async () => {
    const body = await (await getHome()).json();
    expect(Array.isArray(body.insights)).toBe(true);
  });

  const INSIGHT_QUERY = /i\.surface IN \('season', 'pregame', 'postgame'\)/;
  const base = { scope: 'between_games', surface: 'season', player_id: null as string | null, game_id: null as string | null, season_id: 2026, game_date: null as string | null, evidence: null, proof_result: {} as unknown, detail: 'd', importance: 50, headline: 'h', category: 'streak', entities: null, updated_at: '2026-11-01T00:00:00Z', nba_person_id: null, player_name: null, opp_abbr: null, lac_home: null, lac_score: null, opp_score: null, score_parts: null };
  const fr = (type: string, who = 'subject') => ({ type, strength: 0.5, who, text: 't', proof_rows: [] });
  function withInsightRows(rows: unknown[]) {
    const impl = mockSqlFn.getMockImplementation()!;
    mockSqlFn.mockImplementation(async (...args: SqlArgs) => (INSIGHT_QUERY.test(queryText(args)) ? rows : impl(...args)));
  }
  function setNext() {
    upcomingRows = [{ game_id: '555', game_date: '2026-10-22', start_time_utc: null, home_team_id: '9', away_team_id: LAC_TEAM_ID, home_abbr: 'GSW', away_abbr: 'LAC', status: 'scheduled' }];
  }
  const ids = (xs: { insight_id: string }[]) => xs.map((x) => x.insight_id);
  const yoy = (id: string, stat: string, imp: number) => ({
    ...base, insight_id: id, category: 'yoy_change', importance: imp, headline: id, frame: fr('none', 'group'),
    proof_result: [
      { part: 'fact', data: { season_id: 2025, stat, rank: 10, total_teams: 30 } },
      { part: 'fact', data: { season_id: 2026, stat, rank: 20, total_teams: 30 } },
    ],
  });

  it('the insight query limits postgame rows to the last 10 Clippers games', async () => {
    await getHome();
    const text = queryText(findCall(INSIGHT_QUERY)!).replace(/\s+/g, ' ');
    expect(text).toContain('ORDER BY g.game_date DESC, g.game_id DESC LIMIT 10');
    expect(text).toContain("i.surface IN ('season', 'pregame', 'postgame')");
    expect(text).toMatch(/i\.surface <> 'postgame' OR i\.game_id IN \(/);
  });

  it('insights hides cut and tag rows', async () => {
    withInsightRows([
      { ...base, insight_id: 'tag', player_id: '9', category: 'player_game_stat', frame: fr('season_high') },
      { ...base, insight_id: 'card', player_id: '9', category: 'player_game_stat', frame: fr('league_rank') },
    ]);
    const body = await (await getHome()).json();
    expect(ids(body.insights)).toEqual(['card']);
  });

  it('the hero is the top bar-passing card and is not repeated', async () => {
    withInsightRows([
      { ...base, insight_id: 'top', importance: 90, category: 'standings', frame: fr('league_rank', 'group') },
      { ...base, insight_id: 'next', importance: 60, category: 'standings', frame: fr('league_rank', 'group') },
    ]);
    const body = await (await getHome()).json();
    expect(body.feeds.hero.insight_id).toBe('top');
    const others = [...body.feeds.recent, ...body.feeds.season, ...body.feeds.scouting];
    expect(ids(others)).not.toContain('top');
    expect(ids(body.feeds.season)).toContain('next');
  });

  it('recent holds postgame cards only, at most 5, at most 2 per player', async () => {
    const pg = (id: string, player: string, imp: number, cat: string) => ({
      ...base, insight_id: id, surface: 'postgame', player_id: player, game_id: `g${id}`, category: cat, importance: imp, frame: fr('league_rank'),
    });
    withInsightRows([
      { ...base, insight_id: 'hero', importance: 99, frame: fr('league_rank', 'group'), category: 'standings' },
      pg('a', '1', 80, 'c1'), pg('b', '1', 79, 'c2'), pg('c', '1', 78, 'c3'),
      pg('d', '2', 70, 'c4'), pg('e', '3', 69, 'c5'), pg('f', '4', 68, 'c6'), pg('g', '5', 67, 'c7'), pg('h', '6', 66, 'c8'),
      { ...base, insight_id: 'pre', surface: 'pregame', category: 'opp_rank', frame: fr('league_rank', 'group') },
    ]);
    const body = await (await getHome()).json();
    const recent = body.feeds.recent;
    expect(recent.length).toBeLessThanOrEqual(5);
    expect(recent.every((c: { surface: string }) => c.surface === 'postgame')).toBe(true);
    expect(recent.filter((c: { player_id: string }) => c.player_id === '1').length).toBeLessThanOrEqual(2);
  });

  it('a hero postgame leader folds its followers out of every other feed', async () => {
    const pg = (id: string, strength: number, imp: number, cat: string) => ({
      ...base, insight_id: id, surface: 'postgame', player_id: '1', game_id: 'G1', category: cat, importance: imp, frame: { ...fr('league_rank'), strength },
    });
    const other = (id: string, player: string, imp: number) => ({
      ...base, insight_id: id, surface: 'postgame', player_id: player, game_id: `G${id}`, category: `c${id}`, importance: imp, frame: fr('league_rank'),
    });
    withInsightRows([
      pg('lead', 0.9, 95, 'a'), pg('follow', 0.4, 94, 'b'),
      other('o1', '2', 80), other('o2', '3', 79), other('o3', '4', 78), other('o4', '5', 77), other('o5', '6', 76), other('o6', '7', 75),
    ]);
    const body = await (await getHome()).json();
    expect(body.feeds.hero.insight_id).toBe('lead');
    expect(body.feeds.hero.merged_ids).toEqual(['follow']);
    expect(body.feeds.recent).toHaveLength(5);
    expect(ids(body.feeds.recent)).not.toContain('lead');
    expect(ids(body.feeds.recent)).not.toContain('follow');
    expect(body.feeds.recent.some((c: { player_id: string }) => c.player_id === '1')).toBe(false);
  });

  it('stale pregame rows (not the next game) are excluded; no next game means no pregame feeds', async () => {
    const stale = { ...base, insight_id: 'stale', surface: 'pregame', game_id: '111', category: 'opp_rank', importance: 99, frame: fr('league_rank', 'group') };
    const staleNote = { ...base, insight_id: 'sn', surface: 'pregame', game_id: '111', category: 'opp_form', importance: 50, frame: null };
    setNext();
    withInsightRows([stale, staleNote]);
    let body = await (await getHome()).json();
    expect(body.feeds.hero).toBeNull();
    expect(body.feeds.scouting).toEqual([]);
    expect(body.feeds.notes).toEqual([]);
    upcomingRows = [];
    withInsightRows([{ ...stale, game_id: '555' }, { ...staleNote, game_id: '555' }]);
    body = await (await getHome()).json();
    expect(body.feeds.hero).toBeNull();
    expect(body.feeds.scouting).toEqual([]);
    expect(body.feeds.notes).toEqual([]);
  });

  it('season holds season cards plus one merged ratings card', async () => {
    withInsightRows([
      { ...base, insight_id: 'hero', importance: 99, category: 'standings', frame: fr('league_rank', 'group') },
      { ...base, insight_id: 's1', importance: 55, category: 'standings', frame: fr('league_rank', 'group') },
      yoy('y1', 'team_off_rtg_rank', 40), yoy('y2', 'team_def_rtg_rank', 41), yoy('y3', 'team_net_rtg_rank', 42),
    ]);
    const body = await (await getHome()).json();
    const merged = body.feeds.season.filter((c: { team_yoy?: unknown[] }) => c.team_yoy);
    expect(merged).toHaveLength(1);
    expect(merged[0].team_yoy).toHaveLength(3);
    const all = [body.feeds.hero, ...body.feeds.recent, ...body.feeds.season, ...body.feeds.scouting].filter((c) => c && !c.team_yoy);
    for (const id of ['y1', 'y2', 'y3']) expect(ids(all)).not.toContain(id);
    expect(ids(body.feeds.season)).toContain('s1');
  });

  it('scouting holds pregame cards, at most 3; notes hold Q8 notes by importance, at most 4', async () => {
    const pre = (id: string, imp: number, cat: string) => ({
      ...base, insight_id: id, surface: 'pregame', game_id: '555', category: cat, importance: imp, frame: fr('league_rank', 'group'),
    });
    const note = (id: string, imp: number, cat: string) => ({
      ...base, insight_id: id, surface: 'pregame', game_id: '555', category: cat, importance: imp, frame: null,
    });
    setNext();
    setNext();
    withInsightRows([
      { ...base, insight_id: 'hero', importance: 99, category: 'standings', frame: fr('league_rank', 'group') },
      pre('p1', 70, 'c1'), pre('p2', 69, 'c2'), pre('p3', 68, 'c3'), pre('p4', 67, 'c4'),
      note('n1', 30, 'opp_form'), note('n2', 35, 'last_meeting'), note('n3', 32, 'rest'), note('n4', 31, 'line'),
      note('n5', 20, 'h2h'), note('n6', 36, 'opp_hot_player'),
    ]);
    const body = await (await getHome()).json();
    expect(body.feeds.scouting.length).toBeLessThanOrEqual(3);
    expect(body.feeds.scouting.every((c: { surface: string }) => c.surface === 'pregame')).toBe(true);
    expect(ids(body.feeds.notes)).toEqual(['n6', 'n2', 'n3', 'n4']);
  });

  // ── Season scoping ──────────────────────────────────────────────────────────

  it('returns the DB-derived season and scopes record, last_10 and ratings to it', async () => {
    const body = await (await getHome()).json();
    expect(body.team_snapshot.season_id).toBe(DISPLAY_SEASON);

    // Record: regular season only — the shared predicate excludes playoffs and play-in.
    const recordCall = findCall(/g\.home_score IS NOT NULL AND g\.away_score IS NOT NULL/);
    expect(recordCall).toBeDefined();
    expect(recordCall!.slice(1)).toContain(DISPLAY_SEASON);
    expect(recordCall!.slice(1)).toContain(REGULAR_SEASON_SQL);

    const last10Call = findCall(/home_abbr[\s\S]*lower\(g\.status\) = 'final'/);
    expect(last10Call!.slice(1)).toContain(DISPLAY_SEASON);

    // Ratings: possession-weighted regular-season numbers for the same season.
    const ratingsCall = findCall(/FROM advanced_team_game_stats/);
    expect(ratingsCall!.slice(1)).toContain(DISPLAY_SEASON);
    expect(ratingsCall!.slice(1)).toContain(REGULAR_SEASON_SQL);
  });

  it('compares game_date against the US Eastern date, not CURRENT_DATE', async () => {
    await getHome();
    const upcomingCall = findCall(/lower\(g\.status\) <> 'final'[\s\S]*LIMIT 10/);
    const text = queryText(upcomingCall!);
    expect(text).toContain("AT TIME ZONE 'America/New_York'");
    expect(text).not.toContain('CURRENT_DATE');
  });

  // ── last10_games (point-diff chart) ─────────────────────────────────────────

  it('team_snapshot.last10_games has game_id, opponent_abbr, game_date and LAC-perspective margin', async () => {
    last10Rows = [
      // LAC home win by 8
      { game_id: '501', home_team_id: LAC_TEAM_ID, away_team_id: '7', home_score: 110, away_score: 102,
        game_date: '2026-04-12', home_abbr: 'LAC', away_abbr: 'DEN' },
      // LAC away loss by 5
      { game_id: '500', home_team_id: '9', away_team_id: LAC_TEAM_ID, home_score: 101, away_score: 96,
        game_date: '2026-04-10', home_abbr: 'GSW', away_abbr: 'LAC' },
    ];
    const body = await (await getHome()).json();
    expect(body.team_snapshot.last10_games).toEqual([
      { game_id: 501, opponent_abbr: 'DEN', game_date: '2026-04-12', margin: 8 },
      { game_id: 500, opponent_abbr: 'GSW', game_date: '2026-04-10', margin: -5 },
    ]);
    expect(body.team_snapshot.last_10).toEqual({ wins: 1, losses: 1 });
  });

  // ── Odds shape (consumed by NextGameHero / ScheduleTable) ───────────────────

  it('next_game.odds exposes spread/moneyline/over_under from the LAC side', async () => {
    upcomingRows = [
      { game_id: '555', game_date: '2026-10-22', start_time_utc: null,
        home_team_id: '9', away_team_id: LAC_TEAM_ID, home_abbr: 'GSW', away_abbr: 'LAC',
        status: 'scheduled' },
    ];
    mockGetLatestOdds.mockResolvedValue({
      spread_home: -4.5, spread_away: 4.5,
      moneyline_home: -180, moneyline_away: 155,
      total_points: 226.5, captured_at: '2026-10-21T12:00:00Z',
    });
    const body = await (await getHome()).json();
    expect(body.next_game.home_away).toBe('away');
    expect(body.next_game.odds).toEqual({
      spread: 4.5,
      moneyline: 155,
      over_under: 226.5,
      captured_at: '2026-10-21T12:00:00Z',
    });
    expect(body.meta.source).toBe('mixed');
  });

  // ── PERF-02: Timing SLA ─────────────────────────────────────────────────────

  it('responds in under 300ms with mocked DB (PERF-02)', async () => {
    const start = Date.now();
    const res = await getHome();
    const elapsed = Date.now() - start;
    expect(res.status).toBe(200);
    expect(elapsed).toBeLessThan(300);
  });
});
