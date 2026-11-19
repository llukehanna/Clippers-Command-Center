// src/lib/api-history-game.test.ts
// The game page's insights and cache lifetime (src/lib/data/history-game.ts). The sql tag is mocked and
// dispatches on query text, so the tests run offline.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InsightDbRow as InsightRow } from './data/insight-quality';
import { INSIGHT_ROW_COLUMNS } from './data/insight-quality';

type SqlArgs = [readonly string[], ...unknown[]];
const mockSql = vi.fn<(...args: SqlArgs) => Promise<unknown[]>>();
vi.mock('@/src/lib/db', () => ({
  sql: Object.assign((...args: SqlArgs) => mockSql(...args), { unsafe: (fragment: string, params?: unknown) => (params === undefined ? fragment : Promise.resolve([])) }),
  LAC_NBA_TEAM_ID: 1610612746,
}));

const { gamePageInsights, historyGameTtl, loadHistoryGame } = await import('./data/history-game');

const row = (id: string, over: Partial<InsightRow> = {}): InsightRow => ({
  insight_id: id, scope: 'historical', surface: 'postgame', category: 'player_game_stat', headline: `Headline ${id}`,
  detail: `Detail ${id}`, importance: 50, proof_result: [{ part: 'fact' }], game_id: '640', player_id: null,
  season_id: 2026, game_date: '2026-11-17', evidence: null, entities: null, updated_at: '2026-11-17T00:00:00Z',
  frame: { type: 'first_since', strength: 0.5, who: 'subject', text: `Detail ${id}`, proof_rows: [] },
  nba_person_id: null, player_name: null, opp_abbr: 'OKC', lac_home: true, lac_score: 112, opp_score: 104,
  score_parts: { salience_class: 'roster' }, ...over,
});

const GAME = {
  game_id: '640', game_date: '2026-11-17', season_id: 2026, home_team_id: '1', away_team_id: '2', status: 'final',
  home_score: 112, away_score: 104, home_abbr: 'LAC', away_abbr: 'OKC', home_name: 'Clippers', away_name: 'Thunder',
  home_is_lac: true, away_is_lac: false,
};
let insightRows: InsightRow[] = [];
let game = GAME;

beforeEach(() => {
  vi.clearAllMocks();
  insightRows = [];
  game = GAME;
  mockSql.mockImplementation(async (...args: SqlArgs) => {
    const q = args[0].join('?');
    if (q.includes('FROM games g')) return [game];
    // Box scores are available when the game has player rows (loaded alongside the game).
    if (q.includes('FROM game_player_box_scores pbs')) {
      return [{ player_id: '7', display_name: 'A Clipper', team_id: '1', minutes: '30:00', points: 20 }];
    }
    if (q.includes('i.is_active = true')) return insightRows;
    return [];
  });
});

describe('game page insights (FW-7, FW-8)', () => {
  it('never selects pregame rows: they carry the next game\'s id and describe a game already played', async () => {
    await loadHistoryGame('640');
    const q = mockSql.mock.calls.map((c) => c[0].join('?')).find((t) => t.includes('i.is_active = true'))!;
    expect(q).toContain("AND (i.surface IS NULL OR i.surface <> 'pregame')");
    for (const col of ['surface', 'frame', 'score_parts', 'player_id']) expect(INSIGHT_ROW_COLUMNS).toContain(`i.${col}`);
    // the loader passes the shared column fragment to sql.unsafe
    expect(mockSql.mock.calls.some((c) => c.includes(INSIGHT_ROW_COLUMNS))).toBe(true);
  });

  it('composes postgame rows: at most 8, two per player and per category, same-player rows merged', () => {
    const rows = [
      // one player's two lines merge into one item; his third is over the per-player cap
      row('a', { player_id: '7', importance: 90, category: 'player_game_stat', frame: { type: 'records_best', strength: 0.9, who: 'subject', text: 'A', proof_rows: [] } }),
      row('b', { player_id: '7', importance: 85, category: 'player_combo' }),
      ...Array.from({ length: 20 }, (_, i) => row(`p${String(i).padStart(2, '0')}`, {
        player_id: String(100 + i), importance: 80 - i, category: ['player_game_stat', 'player_period_stat', 'clutch', 'player_combo', 'milestone_crossed'][i % 5],
      })),
      ...Array.from({ length: 4 }, (_, i) => row(`t${i}`, { importance: 30 - i, category: ['team_game_stat', 'game_flow', 'team_period_stat', 'team_game_stat'][i] })),
    ];
    const out = gamePageInsights(rows, new Map());
    expect(out.length).toBeLessThanOrEqual(8);
    expect(out.find((r) => r.insight_id === 'a')!.detail).toBe('Detail a · Detail b');
    expect(out.some((r) => r.insight_id === 'b')).toBe(false);
    const perCategory = new Map<string, number>();
    for (const r of out) perCategory.set(r.category, (perCategory.get(r.category) ?? 0) + 1);
    expect(Math.max(...perCategory.values())).toBeLessThanOrEqual(2);
    // the merged item keeps its own proof
    expect(out.find((r) => r.insight_id === 'a')!.proof_result).toEqual([{ part: 'fact' }]);
  });

  it('keeps live and pre-v2 rows as they are, and drops any pregame row that reaches it', () => {
    const out = gamePageInsights([
      row('post'), row('live', { surface: 'live', scope: 'live', importance: 70 }), row('legacy', { surface: null, importance: 10 }),
      row('pre', { surface: 'pregame', importance: 99 }),
    ], new Map());
    expect(out.map((r) => r.insight_id)).toEqual(['live', 'post', 'legacy']);
  });

  it('gamePageInsights keeps postgame cards only', () => {
    const fr = (type: string, extra: Record<string, unknown> = {}) => ({ type, strength: 0.5, who: 'subject', text: 't', proof_rows: [], ...extra }) as InsightRow['frame'];
    const out = gamePageInsights([
      row('tag', { player_id: '1', importance: 90, category: 'player_game_stat', frame: fr('season_high') }),
      row('cut', { player_id: '2', importance: 80, category: 'streak_x', frame: fr('first_since', { since_date: '2026-11-10', games_since: 2 }) }),
      row('career', { player_id: '3', importance: 70, category: 'career_x', frame: fr('career_high') }),
      row('live', { surface: 'live', scope: 'live', importance: 60 }),
    ], new Map());
    expect(out.map((r) => r.insight_id)).toEqual(['career', 'live']);
  });

  it('serves the composed page from the loader', async () => {
    insightRows = Array.from({ length: 25 }, (_, i) => row(`r${String(i).padStart(2, '0')}`, { player_id: String(i % 6), importance: 90 - i, category: `c${i % 9}` }));
    const res = await loadHistoryGame('640');
    const body = res.body as { insights: { insight_id: string }[] };
    expect(body.insights.length).toBeLessThanOrEqual(8);
    expect(body.insights.length).toBeGreaterThan(0);
  });
});

describe('game story and box score tags (B6)', () => {
  const PRIOR = { player_id: '7', games: 12, pts: 18, reb: 5, ast: 3, stl: 1, blk: 1, fg3m: 2 };
  beforeEach(() => {
    const base = mockSql.getMockImplementation()!;
    mockSql.mockImplementation(async (...args: SqlArgs) => {
      const q = args[0].join('?');
      if (q.includes('GROUP BY pb.player_id')) return [PRIOR];
      if (q.includes('FROM game_player_box_scores pbs')) {
        return [{ player_id: '7', display_name: 'A Clipper', team_id: '1', minutes: '30:00', points: 20, blocks: 4, rebounds: 5 }];
      }
      return base(...args);
    });
  });

  it('season-high query is bounded by this game date and grouped per player, one extra query', async () => {
    await loadHistoryGame('640');
    const qs = mockSql.mock.calls.map((c) => c[0].join('?')).filter((t) => t.includes('GROUP BY pb.player_id'));
    expect(qs).toHaveLength(1);
    expect(qs[0]).toContain('g.game_date < (SELECT game_date FROM games WHERE game_id =');
  });

  it('game_story holds bar-passing postgame cards, composed, plus live and legacy rows', async () => {
    const fr = (type: string, extra: Record<string, unknown> = {}) => ({ type, strength: 0.5, who: 'subject', text: 't', proof_rows: [], ...extra }) as InsightRow['frame'];
    insightRows = [
      row('tag', { player_id: '1', importance: 90, frame: fr('season_high') }),
      row('keep', { player_id: '3', importance: 70, category: 'career_x', frame: fr('career_high') }),
      row('live', { surface: 'live', scope: 'live', importance: 60 }),
      row('legacy', { surface: null, frame: null, proof_result: null, importance: 10 }),
    ];
    const body = (await loadHistoryGame('640')).body as { game_story: { insight_id: string }[] };
    expect(body.game_story.map((c) => c.insight_id)).toEqual(['keep', 'live', 'legacy']);
  });

  it('tags: grey season high, blue where frame.value matches the box, none where it disagrees', async () => {
    const fr = (stat: string, value: number) => ({ type: 'career_high', strength: 0.5, who: 'subject', text: 't', proof_rows: [], stat, value }) as InsightRow['frame'];
    insightRows = [row('blue', { player_id: '7', frame: fr('blk', 4) }), row('stale', { player_id: '7', category: 'other', frame: fr('reb', 9) })];
    const body = (await loadHistoryGame('640')).body as { box_score: { tags: Record<string, Record<string, { tone: string; label: string }>> } };
    expect(body.box_score.tags['7']).toEqual({
      PTS: { tone: 'season_high', label: 'Season high' },
      BLK: { tone: 'rare', label: 'Career high' },
    });
  });
});

describe('blue tags only from cards Game story shows (fix wave B #3)', () => {
  const PRIOR = { player_id: '7', games: 12, pts: 30, reb: 12, ast: 9, stl: 4, blk: 5, fg3m: 6 };
  const ch = (stat: string, value: number, strength = 0.5) =>
    ({ type: 'career_high', strength, who: 'subject', text: 't', proof_rows: [], stat, value }) as InsightRow['frame'];
  beforeEach(() => {
    const base = mockSql.getMockImplementation()!;
    mockSql.mockImplementation(async (...args: SqlArgs) => {
      const q = args[0].join('?');
      if (q.includes('GROUP BY pb.player_id')) return [PRIOR];
      if (q.includes('FROM game_player_box_scores pbs')) {
        return [{ player_id: '7', display_name: 'A Clipper', team_id: '1', minutes: '30:00', points: 20, blocks: 4, rebounds: 5 }];
      }
      return base(...args);
    });
  });
  type Body = { game_story: { insight_id: string; merged_ids: string[] }[]; box_score: { tags: Record<string, Record<string, { tone: string }>> } };

  it('a card merged into a shown card still tags its stat', async () => {
    insightRows = [
      row('lead', { player_id: '7', importance: 90, category: 'a', frame: ch('blk', 4, 0.9) }),
      row('follow', { player_id: '7', importance: 80, category: 'b', frame: ch('pts', 20, 0.5) }),
    ];
    const body = (await loadHistoryGame('640')).body as Body;
    expect(body.game_story.map((c) => c.insight_id)).toEqual(['lead']);
    expect(body.game_story[0].merged_ids).toEqual(['follow']);
    expect(Object.keys(body.box_score.tags['7']).sort()).toEqual(['BLK', 'PTS']);
  });

  it('a bar-passing card the composer leaves out gets no blue tag', async () => {
    insightRows = [
      // eight stronger cards about other players fill Game story
      ...Array.from({ length: 8 }, (_, i) => row(`o${i}`, { player_id: String(100 + i), importance: 90 - i, category: `c${i}`, frame: ch('pts', 30) })),
      row('left-out', { player_id: '7', importance: 5, category: 'z', frame: ch('reb', 5) }),
    ];
    const body = (await loadHistoryGame('640')).body as Body;
    expect(body.game_story.some((c) => c.insight_id === 'left-out')).toBe(false);
    expect(body.box_score.tags['7']).toBeUndefined();
  });
});

describe('game page cache lifetime (FW-8)', () => {
  const at = (iso: string) => new Date(iso);
  it('caches a day only once the nightly run after the game has landed (game date before LA yesterday)', () => {
    // 2026-11-19 10:00 PT
    const now = at('2026-11-19T18:00:00Z');
    expect(historyGameTtl('final', true, '2026-11-17', now)).toBe(86400);
    expect(historyGameTtl('final', true, '2026-11-18', now)).toBe(300);
    expect(historyGameTtl('final', true, '2026-11-19', now)).toBe(300);
    expect(historyGameTtl('Final', true, '2026-11-01', now)).toBe(86400);
  });
  it('reads the date in Los Angeles: 01:00 UTC on Nov 19 is still Nov 18 there', () => {
    expect(historyGameTtl('final', true, '2026-11-17', at('2026-11-19T01:00:00Z'))).toBe(300);
    expect(historyGameTtl('final', true, '2026-11-16', at('2026-11-19T01:00:00Z'))).toBe(86400);
  });
  it('60 s for anything not final or without box scores', () => {
    expect(historyGameTtl('in_progress', true, '2026-11-01')).toBe(60);
    expect(historyGameTtl('final', false, '2026-11-01')).toBe(60);
  });
  it('the response header follows it', async () => {
    game = { ...GAME, game_date: new Date().toISOString().slice(0, 10) };
    expect((await loadHistoryGame('640')).headers).toMatchObject({ 'Cache-Control': 'public, max-age=300' });
    game = { ...GAME, game_date: '2026-01-02' };
    expect((await loadHistoryGame('640')).headers).toMatchObject({ 'Cache-Control': 'public, max-age=86400' });
  });
});
