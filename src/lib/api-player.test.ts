// src/lib/api-player.test.ts
// GET /api/players/{id}: player-surface insights, milestones and season highs (Task B7).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSql = vi.fn();
vi.mock('@/src/lib/db', () => ({
  sql: new Proxy(mockSql, {
    apply: (target, thisArg, args) => Reflect.apply(target, thisArg, args),
    get: (target, prop) => (prop === 'unsafe' ? (s: string) => s : (target as unknown as Record<string | symbol, unknown>)[prop]),
  }),
  LAC_NBA_TEAM_ID: 1610612746,
}));
vi.mock('@/src/lib/season', async (orig) => ({
  ...(await orig<typeof import('@/src/lib/season')>()),
  getDisplaySeasonId: async () => 2026,
}));

const BOX = (o: Record<string, unknown>) => ({
  game_id: '1', game_date: '2026-11-01', home_team_id: '1', away_team_id: '2', home_score: 100, away_score: 90,
  player_team_id: '1', team_abbreviation: 'LAC', opp_abbreviation: 'SAS', game_type: 'regular', minutes: null,
  points: 10, rebounds: 4, assists: 2, steals: 0, blocks: 0, turnovers: 0, fg_made: 4, fg_attempted: 9,
  fg3_made: null, fg3_attempted: 0, ft_made: 2, ft_attempted: 2, plus_minus: 1, ...o,
});
const base = { scope: 'between_games', surface: 'player', player_id: '7', game_id: null, season_id: 2026, game_date: null, detail: 'd', proof_result: {}, entities: null, score_parts: null, updated_at: '2026-11-19T00:00:00Z', nba_person_id: 1, player_name: 'A', opp_abbr: null, lac_home: null, lac_score: null, opp_score: null };
const frame = { type: 'first_since', strength: 0.6, who: 'subject', text: '', since_label: '2019', proof_rows: [] };

function respond(insights: unknown[]) {
  mockSql.mockImplementation(async (strings: readonly string[]) => {
    const q = strings.join('?');
    if (q.includes('FROM players')) return [{ player_id: '7', display_name: 'A', position: 'G' }];
    if (q.includes('MAX(g.season_id)')) return [{ season_id: 2026 }];
    if (q.includes('FROM game_player_box_scores')) {
      return [BOX({ game_id: '3', game_date: '2026-11-17', points: 26 }), BOX({ game_id: '2', game_date: '2026-11-13', points: 26, away_team_id: '1', home_team_id: '2' })];
    }
    if (q.includes("i.surface = 'player'")) return insights;
    return [];
  });
}
const insightQueries = () => mockSql.mock.calls.map((c) => (c[0] as readonly string[]).join('?')).filter((q) => q.includes("i.surface = 'player'"));
async function load(qs = '') {
  const { loadPlayer } = await import('./data/player');
  return loadPlayer('7', new URL(`http://x/api/players/7${qs}`));
}

describe('loadPlayer insights', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('display season: queries player-surface rows for this player; milestones split from cards', async () => {
    respond([
      { ...base, insight_id: 'fs', category: 'season_best', importance: 70, headline: 'first since', frame, evidence: null },
      { ...base, insight_id: 'ms', category: 'milestone_progress', importance: 50, headline: '20 to go', frame: null, evidence: { type: 'milestone_progress', current: 980, target: 1000, label: 'points' } },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await load('?season_id=2026')).body as any;
    expect(insightQueries()).toHaveLength(1);
    expect(insightQueries()[0]).toContain('i.player_id = ?::bigint');
    expect(body.insights.map((c: { insight_id: string }) => c.insight_id)).toEqual(['fs']);
    expect(body.milestones).toEqual([{ insight_id: 'ms', headline: '20 to go', current: 980, target: 1000, label: 'points' }]);
  });

  it('another season: no insight query, empty insights and milestones', async () => {
    respond([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await load('?season_id=2025')).body as any;
    expect(insightQueries()).toHaveLength(0);
    expect(body.insights).toEqual([]);
    expect(body.milestones).toEqual([]);
  });

  it('season_highs come from the box rows (earliest wins a tie; home from team ids)', async () => {
    respond([]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await load('?season_id=2026')).body as any;
    expect(body.season_highs[0]).toEqual({ stat: 'pts', label: 'Points', value: 26, game_id: '2', game_date: '2026-11-13', opp: 'SAS', home: false });
  });

  it('a failed insight query still serves the page', async () => {
    respond([]);
    const impl = mockSql.getMockImplementation()!;
    mockSql.mockImplementation((strings: readonly string[], ...r: unknown[]) =>
      strings.join('?').includes("i.surface = 'player'") ? Promise.reject(new Error('boom')) : impl(strings, ...r));
    const res = await load('?season_id=2026');
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((res.body as any).insights).toEqual([]);
  });
});
