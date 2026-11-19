// Integration test of the game page loaders against a LOCAL Postgres.
// Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED, then
// left seeded (so `next dev` can be pointed at it for a visual check).
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55499/fixture npx vitest run scripts/lib/game-pages
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

vi.mock('@/src/lib/espn/fetch', () => ({ fetchEspnJson: async () => null }));

const url = process.env.FIXTURE_DATABASE_URL;
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

const SEED = `
INSERT INTO seasons (season_id, label) VALUES (2026, '2026-27');
INSERT INTO teams (team_id, nba_team_id, abbreviation, name, city) VALUES
  (1, 13, 'LAC', 'Clippers', 'LA'), (2, 27, 'SAS', 'Spurs', 'San Antonio');
INSERT INTO players (player_id, first_name, last_name, display_name) VALUES (10, 'Kawhi', 'Leonard', 'Kawhi Leonard');
INSERT INTO all_games (game_id, nba_game_id, season_id, game_date, start_time_utc, status, home_team_id, away_team_id, home_score, away_score, arena) VALUES
  (100, 22600001, 2026, '2026-11-01', '2026-11-02T03:30:00Z', 'final', 1, 2, 110, 100, 'Intuit Dome'),
  (101, 22600002, 2026, '2026-11-20', '2026-11-21T01:00:00Z', 'scheduled', 2, 1, NULL, NULL, 'Frost Bank Center');
INSERT INTO odds_snapshots (game_id, provider, captured_at, spread_home, spread_away, moneyline_home, moneyline_away, total_points) VALUES
  (101, 'theoddsapi', '2026-11-18T12:00:00Z', -2.5, 2.5, -130, 110, 224.5),
  (101, 'theoddsapi', '2026-11-19T12:00:00Z', -1.5, 1.5, -120, 100, 225.5),
  (100, 'theoddsapi', '2026-11-01T12:00:00Z', -6, 6, -250, 200, 221);
INSERT INTO game_flow (game_id, lac_largest_lead, lac_largest_deficit, lead_changes, times_tied, lac_best_run, opp_best_run, comeback_margin, margin_series, source)
  VALUES (100, 12, 3, 2, 1, 9, 6, NULL, '[[0,0],[30,2],[60,4],[2870,10]]'::jsonb, 'espn');
INSERT INTO period_team_stats (game_id, team_id, period, pts, fgm, fga, fg3m, fg3a, ftm, fta, reb, ast, tov) VALUES
  (100, 1, 1, 30, 11, 22, 3, 8, 5, 6, 10, 7, 2), (100, 2, 1, 25, 10, 24, 2, 9, 3, 4, 12, 5, 3);
INSERT INTO period_player_stats (game_id, player_id, team_id, period, pts, reb, ast, fg3m, fgm, fga, stl, blk) VALUES
  (100, 10, 1, 1, 12, 2, 1, 1, 5, 8, 1, 0);
INSERT INTO clutch_stats (game_id, team_id, player_id, pts, fgm, fga, fg3m, ftm, fta, tov) VALUES
  (100, 1, NULL, 8, 3, 5, 1, 1, 2, 0), (100, 2, NULL, 4, 2, 6, 0, 0, 0, 1), (100, 1, 10, 6, 2, 3, 1, 1, 2, 0);
INSERT INTO pbp_events (game_id, event_num, action_number, period, clock_sec, elapsed_sec, team_id, player_id, kind, made, shot_value, points, score_home, score_away, description, shot_x, shot_y)
  SELECT 100, n, n * 2, 1, 700 - n, 20 + n, 1, 10, 'fg', n % 2 = 0, 2, CASE WHEN n % 2 = 0 THEN 2 ELSE 0 END, 0, 0, 'Kawhi Leonard shot', 25, n
  FROM generate_series(1, 12) AS n;
INSERT INTO rb_game_highs (scope, scope_id, stat_key, rank, value, game_id, game_date, player_id, team_id) VALUES
  ('player_career', '10', 'pts', 1, 41, 100, '2026-11-01', 10, 1);
INSERT INTO app_kv (key, value) VALUES ('insights.records_start', '{"season_id":2020,"label":"2020-21"}'::jsonb), ('insights.pbp_records_start', '{"season_id":2019,"label":"2019-20"}'::jsonb);
INSERT INTO rolling_team_stats (team_id, season_id, window_games, as_of_game_date, net_rating, record_wins, record_losses) VALUES
  (1, 2026, 10, '2026-11-15', 4.2, 7, 3), (2, 2026, 10, '2026-11-15', -1.1, 4, 6);
INSERT INTO insights (scope, team_id, game_id, category, headline, proof_sql, proof_result) VALUES
  ('between_games', 1, 101, 'opponent_context', 'Up next: a test insight', 'SELECT 1', '[]'::jsonb);
`;

describe.skipIf(!url)('game page loaders (fixture DB)', () => {
  let admin: postgres.Sql;

  beforeAll(async () => {
    admin = postgres(url!, { max: 1, onnotice: () => {} });
    await admin.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await admin.unsafe(read('Docs/DB_SCHEMA.sql'));
    await admin.unsafe(SEED);
    process.env.DATABASE_URL = url;
  }, 60_000);
  afterAll(async () => { await admin?.end(); });

  it('loads a preview', async () => {
    const { loadGamePreview } = await import('@/src/lib/data/game-preview');
    const res = await loadGamePreview('101');
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = res.body as any;
    expect(body.game).toMatchObject({ home_away: 'away', opponent_abbr: 'SAS', status: 'scheduled' });
    expect(body.line.current.spread).toBe(1.5);
    expect(body.line.movement).toHaveLength(2);
    expect(body.matchup.lac.record).toEqual({ wins: 1, losses: 0 });
    expect(body.matchup.lac.last10).toEqual({ wins: 7, losses: 3, net_rating: 4.2 });
    expect(body.matchup.meetings).toHaveLength(1);
    expect(body.matchup.meetings[0]).toMatchObject({ won: true, lac_score: 110, opp_score: 100 });
    expect(body.matchup.lac.ranks).toBeNull(); // fewer than 5 games of advanced stats
    expect(body.insights).toHaveLength(1);
    expect(body.broadcasts).toBeNull();
  });

  it('loads a story', async () => {
    const { loadGameStory } = await import('@/src/lib/data/game-story');
    const res = await loadGameStory('100');
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = res.body as any;
    expect(body.flow.expected_source).toBe('spread');
    expect(body.flow.flow.points.at(-1)).toMatchObject({ t: 2880, m: 10, wp: 1 });
    expect(body.quarters[0].lac.pts).toBe(30);
    expect(body.quarters[0].lac_top).toEqual({ name: 'Kawhi Leonard', pts: 12 });
    expect(body.clutch.lac.pts).toBe(8);
    expect(body.shots.located).toBe(12);
    expect(body.records[0].text).toBe('Kawhi Leonard: 41 points — career high');
  });

  it('player season highs include threes from the box rows (fix wave B #10)', async () => {
    // Two final regular-season games for player 10: threes peak in the later one, points in the earlier one.
    await admin.unsafe(`
      INSERT INTO all_games (game_id, nba_game_id, season_id, game_date, start_time_utc, status, home_team_id, away_team_id, home_score, away_score, arena) VALUES
        (102, 22600003, 2026, '2026-11-17', '2026-11-18T03:30:00Z', 'final', 1, 2, 120, 100, 'Intuit Dome');
      INSERT INTO game_player_box_scores (game_id, team_id, player_id, starter, minutes, points, rebounds, assists, fg3_made, fg3_attempted) VALUES
        (100, 1, 10, true, '30:00', 26, 6, 3, 1, 4),
        (102, 1, 10, true, '28:00', 18, 9, 2, 4, 7);
    `);
    const { loadPlayer } = await import('@/src/lib/data/player');
    const res = await loadPlayer('10', new URL('http://ccc.local/api/players/10?lac_only=true'));
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const highs = (res.body as any).season_highs as { stat: string; value: number; game_id: string; opp: string }[];
    expect(highs.map((h) => h.stat)).toEqual(['pts', 'reb', 'ast', 'fg3m']);
    expect(highs.find((h) => h.stat === 'fg3m')).toMatchObject({ value: 4, game_id: '102', opp: 'SAS' });
    expect(highs.find((h) => h.stat === 'pts')).toMatchObject({ value: 26, game_id: '100' });
  });

  it('404s an unknown game', async () => {
    const { loadGamePreview } = await import('@/src/lib/data/game-preview');
    expect((await loadGamePreview('999')).status).toBe(404);
  });
});
