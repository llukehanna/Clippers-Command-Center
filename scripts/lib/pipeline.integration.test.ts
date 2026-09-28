// scripts/lib/pipeline.integration.test.ts
// End-to-end test of the stats + insight pipeline against a LOCAL Postgres
// seeded with a synthetic league (scripts/dev/seed-fixture-league.ts).
//
// Skipped unless FIXTURE_DATABASE_URL is set. The database is wiped.
//   FIXTURE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { NBABoxscoreResponse, BoxscorePlayer, BoxscoreTeam } from '../../src/lib/types/live';

const url = process.env.FIXTURE_DATABASE_URL;
const TIMEOUT = 180_000;

function run(script: string, env: Record<string, string> = {}, args: string[] = []): string {
  return execFileSync('npx', ['tsx', script, ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url, FIXTURE_DATABASE_URL: url, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

// ── Synthetic NBA box score ──────────────────────────────────────────────────

function player(personId: number, name: string, points: number, played = true): BoxscorePlayer {
  const fgm = Math.floor(points / 2);
  return {
    status: played ? 'ACTIVE' : 'INACTIVE', order: 1, personId, jerseyNum: '1', name, nameI: name,
    position: 'G', starter: '1', oncourt: '0', played: played ? '1' : '0',
    statistics: {
      assists: 3, blocks: 1, fieldGoalsAttempted: fgm * 2, fieldGoalsMade: fgm, fieldGoalsPercentage: 0.5,
      foulsPersonal: 2, freeThrowsAttempted: points % 2, freeThrowsMade: points % 2, freeThrowsPercentage: 1,
      minutes: played ? 'PT30M00.00S' : '', minutesCalculated: 'PT30M', plus: 0, minus: 0, plusMinusPoints: 0,
      points, reboundsDefensive: 4, reboundsOffensive: 1, reboundsTotal: 5, steals: 1,
      threePointersAttempted: 0, threePointersMade: 0, threePointersPercentage: 0, turnovers: 2,
    },
  };
}

function team(tricode: string, players: BoxscorePlayer[]): BoxscoreTeam {
  const played = players.filter((p) => p.played === '1');
  const sum = (k: keyof BoxscorePlayer['statistics']) =>
    played.reduce((acc, p) => acc + (p.statistics[k] as number), 0);
  const points = sum('points');
  return {
    teamId: 0, teamName: tricode, teamCity: tricode, teamTricode: tricode, score: points, periods: [],
    players,
    statistics: {
      assists: sum('assists'), blocks: sum('blocks'), fieldGoalsAttempted: sum('fieldGoalsAttempted'),
      fieldGoalsMade: sum('fieldGoalsMade'), fieldGoalsPercentage: 0.5, foulsPersonal: sum('foulsPersonal'),
      freeThrowsAttempted: sum('freeThrowsAttempted'), freeThrowsMade: sum('freeThrowsMade'), freeThrowsPercentage: 1,
      points, reboundsDefensive: sum('reboundsDefensive'), reboundsOffensive: sum('reboundsOffensive'),
      reboundsTotal: sum('reboundsTotal'), steals: sum('steals'), threePointersAttempted: 0,
      threePointersMade: 0, threePointersPercentage: 0, turnovers: sum('turnovers'),
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe.skipIf(!url)('stats + insight pipeline (fixture DB)', () => {
  // Imported lazily: scripts/lib/db.ts exits the process without DATABASE_URL.
  let sql: typeof import('./db').sql;

  beforeAll(async () => {
    run('scripts/dev/seed-fixture-league.ts');
    process.env.DATABASE_URL = url;
    ({ sql } = await import('./db'));
  }, TIMEOUT);

  afterAll(async () => {
    await sql?.end();
  });

  it('schema has the play-by-play and record-book tables', async () => {
    const tables = ['game_flow', 'period_team_stats', 'period_player_stats', 'clutch_stats', 'pbp_events', 'rb_game_highs', 'rb_streaks'];
    const rows = await sql<{ name: string; exists: boolean }[]>`
      SELECT t AS name, to_regclass('public.' || t) IS NOT NULL AS exists
      FROM unnest(${tables}::text[]) AS t
    `;
    expect(rows.filter((r) => !r.exists).map((r) => r.name)).toEqual([]);
  });

  it('schema has media_items', async () => {
    const [row] = await sql<{ ok: boolean }[]>`SELECT to_regclass('public.media_items') IS NOT NULL AS ok`;
    expect(row.ok).toBe(true);
  });

  it('stores media items: priority wins duplicates, engagement refreshes, old items pruned', async () => {
    const { upsertMediaItems, pruneMedia } = await import('./media/store');
    const base = { kind: 'article' as const, author: null, engagement: null, comments: null, thumbnailUrl: null, embedUrl: null };
    const now = new Date();
    await upsertMediaItems([
      { ...base, source: 'Google News', url: 'https://g/1', dedupKey: 'article:clippers win', title: 'Clippers win', publishedAt: now.toISOString(), priority: 2 },
      { ...base, source: 'Old', url: 'https://old', dedupKey: 'article:old', title: 'Old', publishedAt: new Date(now.getTime() - 9 * 86_400_000).toISOString(), priority: 1 },
    ]);
    await upsertMediaItems([
      { ...base, source: 'LA Times', url: 'https://latimes/1', dedupKey: 'article:clippers win', title: 'Clippers win', publishedAt: now.toISOString(), priority: 1 },
      { ...base, kind: 'reddit', source: 'r/LAClippers', url: 'https://reddit/1', dedupKey: 'reddit:1', title: 'Post', publishedAt: now.toISOString(), priority: 1, engagement: 5 },
    ]);
    await upsertMediaItems([
      { ...base, kind: 'reddit', source: 'r/LAClippers', url: 'https://reddit/1', dedupKey: 'reddit:1', title: 'Post', publishedAt: now.toISOString(), priority: 1, engagement: 50 },
      { ...base, source: 'Google News', url: 'https://g/1', dedupKey: 'article:clippers win', title: 'Clippers win', publishedAt: now.toISOString(), priority: 2 },
    ]);
    const rows = await sql<{ dedup_key: string; source: string; engagement: number | null }[]>`
      SELECT dedup_key, source, engagement FROM media_items ORDER BY dedup_key`;
    expect(rows).toEqual([
      { dedup_key: 'article:clippers win', source: 'LA Times', engagement: null },
      { dedup_key: 'article:old', source: 'Old', engagement: null },
      { dedup_key: 'reddit:1', source: 'r/LAClippers', engagement: 50 },
    ]);
    expect(await pruneMedia()).toBe(1);
  });

  async function activeInsights() {
    return sql<{ category: string; scope: string; headline: string; importance: number }[]>`
      SELECT category, scope, headline, importance FROM insights WHERE is_active ORDER BY importance DESC
    `;
  }

  it('computes advanced stats and rolling windows for every game', () => {
    const out = run('scripts/compute-stats.ts');
    expect(out).toContain('for 1801 game(s)'); // 2024-25 + 2025-26 (+ play-in)
    // Incremental: a second run has nothing to do.
    expect(run('scripts/compute-stats.ts')).toContain('Nothing new to compute');
  }, TIMEOUT);

  it('parses NBA ISO minutes into player advanced stats', async () => {
    const [row] = await sql<{ nonzero: number }[]>`
      SELECT COUNT(*) FILTER (WHERE minutes > 0)::int AS nonzero FROM rolling_player_stats
    `;
    expect(row.nonzero).toBeGreaterThan(0);
  });

  it('generates every category for a completed season, all provable', async () => {
    run('scripts/generate-insights.ts');
    const rows = await activeInsights();
    const categories = new Set(rows.map((r) => r.category));
    expect([...categories].sort()).toEqual(
      ['league_comparison', 'milestone', 'opponent_context', 'rare_event', 'streak', 'year_over_year']
    );
    const headlines = rows.map((r) => r.headline);
    expect(headlines).toContainEqual(expect.stringMatching(/^Clippers finished 2025-26 at \d+-\d+, \d+(st|nd|rd|th) in the West$/));
    expect(headlines).toContain('Star Clipper closed 2025-26 with 30+ points in 5 straight games');
    expect(headlines).toContain('Big Clipper closed 2025-26 with 10+ rebounds in 6 straight games');
    expect(headlines).toContain("Star Clipper's 55-point game was the best scoring night in the NBA in 2025-26");
    expect(headlines).toContainEqual(expect.stringMatching(/^Up next: the Golden State Warriors had the \d+(st|nd|rd|th)-ranked defense in 2025-26$/));
    expect(headlines.some((h) => h.includes('this season'))).toBe(false);

    // Year over year vs 2024-25 (the fixture's Clippers and Star Clipper improve).
    expect(headlines).toContainEqual(expect.stringMatching(/^Clippers won \d+ games in 2025-26, up from \d+ in 2024-25$/));
    expect(headlines).toContainEqual(
      expect.stringMatching(/^Star Clipper's scoring rose from \d+\.\d PPG in 2024-25 to \d+\.\d PPG in 2025-26$/)
    );
    expect(headlines).toContainEqual(expect.stringMatching(/^Clippers' net rating improved from \d+(st|nd|rd|th) in 2024-25 to \d+(st|nd|rd|th) in 2025-26$/));

    // Traded away before season's end → not a Clippers player for season insights.
    const seasonCats = new Set(['streak', 'milestone', 'league_comparison']);
    expect(rows.filter((r) => seasonCats.has(r.category) && r.headline.includes('LAC Player 3'))).toEqual([]);

    // Milestones count the regular season only (60 games, not the play-in).
    const [pts] = await sql<{ detail: string }[]>`
      SELECT detail FROM insights WHERE is_active AND headline LIKE 'Star Clipper reached % points in 2025-26'
    `;
    expect(pts.detail).toMatch(/ in 60 games$/);

    // Play-in excluded from the standings: 60 regular-season games.
    const [standing] = await sql<{ proof_result: { wins: number; losses: number }[] }[]>`
      SELECT proof_result FROM insights WHERE is_active AND headline LIKE 'Clippers finished%'
    `;
    expect(standing.proof_result[0].wins + standing.proof_result[0].losses).toBe(60);

    expect(run('scripts/verify-insights.ts')).toMatch(/\d+ checked, 0 legacy skipped, 0 failed/);
  }, TIMEOUT);

  it('is idempotent: a re-run updates rows instead of adding them', async () => {
    const [before] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM insights`;
    run('scripts/generate-insights.ts');
    const [after] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM insights`;
    expect(after.n).toBe(before.n);
  }, TIMEOUT);

  it('uses in-season wording and in-season insights when the season is current', async () => {
    run('scripts/generate-insights.ts', { INSIGHTS_NOW: '2026-02-25' });
    const headlines = (await activeInsights()).map((r) => r.headline);
    expect(headlines).toContainEqual(expect.stringMatching(/^Clippers are \d+-\d+, \d+(st|nd|rd|th) in the West$/));
    expect(headlines).toContainEqual(expect.stringMatching(/^Clippers have (won|lost) \d+ straight$/));
    expect(headlines).toContain('Star Clipper has scored 30+ in 5 straight games');
    expect(headlines).toContainEqual(expect.stringMatching(/^Star Clipper ranks \d+(st|nd|rd|th) in the NBA in scoring this season$/));
    expect(headlines).toContainEqual(expect.stringMatching(/^Clippers are winning \d+% of their games, up from \d+% last season$/));
    expect(headlines).toContainEqual(
      expect.stringMatching(/^Star Clipper's scoring rose from \d+\.\d PPG last season to \d+\.\d PPG this season$/)
    );
    // Completed-season phrasings were replaced, not left active alongside.
    expect(headlines.some((h) => h.startsWith('Clippers finished'))).toBe(false);
    expect(run('scripts/verify-insights.ts')).toMatch(/0 failed/);
  }, TIMEOUT);

  it('ingests a league box score: game row, box scores, players, stints; re-ingest is idempotent', async () => {
    const { ingestBoxscore } = await import('./league-ingest');

    // A player without an NBA personId yet, who should be matched by name.
    await sql`
      INSERT INTO players (nba_player_id, first_name, last_name, display_name)
      VALUES (999001, 'Nikola', 'Jokic', 'Nikola Jokic')
    `;
    const box: NBABoxscoreResponse = {
      meta: { version: 1, code: 200, request: '', time: '' },
      game: {
        gameId: '0022600077', gameStatus: 3, gameStatusText: 'Final', period: 4, gameClock: '',
        gameTimeUTC: '2026-10-25T02:30:00Z', // 10:30pm ET Oct 24
        regulationPeriods: 4,
        homeTeam: team('DEN', [
          player(203999, 'Nikola Jokić', 31),          // name match (diacritics)
          player(1_000_000 + 49, 'DEN Player 1', 20),  // fixture player with personId
          player(1642999, 'Brand New Rookie', 8),      // unknown → inserted
          player(1643000, 'Bench Guy', 0, false),      // DNP → no rows
        ]),
        awayTeam: team('LAC', [
          player(1_000_001, 'Star Clipper', 35),
          player(1_000_002, 'Big Clipper', 14),
          player(1_000_003, 'LAC Player 3', 0, false), // LAC DNP → stint only
        ]),
      },
    };

    const gameId = await ingestBoxscore(2026, box);
    const [game] = await sql<{ nba_game_id: string; game_date: string; status: string; home_score: number; away_score: number }[]>`
      SELECT nba_game_id::text, game_date::text, status, home_score, away_score FROM games WHERE game_id = ${gameId}::bigint
    `;
    expect(game).toEqual({ nba_game_id: '22600077', game_date: '2026-10-24', status: 'final', home_score: 59, away_score: 49 });

    const counts = async () => (await sql<{ teams: number; players: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM game_team_box_scores WHERE game_id = ${gameId}::bigint) AS teams,
             (SELECT COUNT(*)::int FROM game_player_box_scores WHERE game_id = ${gameId}::bigint) AS players
    `)[0];
    expect(await counts()).toEqual({ teams: 2, players: 5 });

    const [jokic] = await sql<{ nba_person_id: number }[]>`SELECT nba_person_id FROM players WHERE nba_player_id = 999001`;
    expect(jokic.nba_person_id).toBe(203999);
    const [rookie] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM players WHERE nba_person_id = 1642999`;
    expect(rookie.n).toBe(1);

    // Stints for every team's players who played, plus LAC's DNP; not the DEN DNP.
    const [stints] = await sql<{ den: number; lac: number }[]>`
      SELECT COUNT(*) FILTER (WHERE t.abbreviation = 'DEN')::int AS den,
             COUNT(*) FILTER (WHERE t.abbreviation = 'LAC')::int AS lac
      FROM player_team_stints s JOIN teams t ON t.team_id = s.team_id
      WHERE s.season_id = 2026
    `;
    expect(stints).toEqual({ den: 3, lac: 3 });

    // Incremental compute-stats picks up exactly the new game.
    expect(run('scripts/compute-stats.ts')).toContain('for 1 game(s)');

    // Re-ingest: same rows, and the game's advanced stats are queued for recompute.
    await ingestBoxscore(2026, box);
    expect(await counts()).toEqual({ teams: 2, players: 5 });
    const [dupes] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM games WHERE nba_game_id = 22600077`;
    expect(dupes.n).toBe(1);
    expect(run('scripts/compute-stats.ts')).toContain('for 1 game(s)');
  }, TIMEOUT);

  it('pre-2019 seasons: advanced player stats for Clippers players only', async () => {
    const { ingestBoxscore } = await import('./league-ingest');
    await sql`INSERT INTO seasons (season_id, label) VALUES (2015, '2015-16') ON CONFLICT DO NOTHING`;
    const box: NBABoxscoreResponse = {
      meta: { version: 1, code: 200, request: '', time: '' },
      game: {
        gameId: '0021500077', gameStatus: 3, gameStatusText: 'Final', period: 4, gameClock: '',
        gameTimeUTC: '2015-11-01T02:30:00Z',
        regulationPeriods: 4,
        homeTeam: team('DEN', [player(1_000_000 + 49, 'DEN Player 1', 18)]),
        awayTeam: team('LAC', [player(1_000_001, 'Star Clipper', 12), player(1_000_002, 'Big Clipper', 10)]),
      },
    };
    const gameId = await ingestBoxscore(2015, box);
    expect(run('scripts/compute-stats.ts')).toContain('for 1 game(s)');

    const [derived] = await sql<{ team_adv: number; lac_player_adv: number; other_player_adv: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM advanced_team_game_stats WHERE game_id = ${gameId}::bigint) AS team_adv,
             (SELECT COUNT(*)::int FROM advanced_player_game_stats a JOIN teams t ON t.team_id = a.team_id
               WHERE a.game_id = ${gameId}::bigint AND t.abbreviation = 'LAC') AS lac_player_adv,
             (SELECT COUNT(*)::int FROM advanced_player_game_stats a JOIN teams t ON t.team_id = a.team_id
               WHERE a.game_id = ${gameId}::bigint AND t.abbreviation <> 'LAC') AS other_player_adv
    `;
    expect(derived).toEqual({ team_adv: 2, lac_player_adv: 2, other_player_adv: 0 });
  }, TIMEOUT);

  it('ingests play-by-play for a Clippers game: flow, periods, clutch, raw events', async () => {
    const [game] = await sql<{ game_id: string }[]>`SELECT game_id::text FROM games WHERE nba_game_id = 22600077`;
    // DEN home, LAC away. LAC 3 (0-3), DEN 2+2 (4-3), LAC FT in the clutch (4-4), LAC 2 (4-6).
    const a = (n: number, clock: string, period: number, tri: string | null, person: number, type: string, result: string | null, h: number, w: number, extra: Record<string, unknown> = {}) =>
      ({ actionNumber: n, clock, period, teamTricode: tri, personId: person, actionType: type, shotResult: result, scoreHome: String(h), scoreAway: String(w), description: '', ...extra });
    const pbp = { game: { gameId: '0022600077', actions: [
      a(1, 'PT12M00.00S', 1, null, 0, 'period', null, 0, 0),
      a(2, 'PT11M40.00S', 1, 'LAC', 1_000_001, '3pt', 'Made', 0, 3, { assistPersonId: 1_000_002 }),
      a(3, 'PT11M00.00S', 1, 'DEN', 1_000_049, '2pt', 'Made', 2, 3),
      a(4, 'PT03M20.00S', 4, 'DEN', 1_000_049, '2pt', 'Made', 4, 3),
      a(5, 'PT02M00.00S', 4, 'LAC', 1_000_001, 'freethrow', 'Made', 4, 4),
      a(6, 'PT01M00.00S', 4, 'LAC', 1_000_001, '2pt', 'Made', 4, 6),
    ] } };
    const file = path.join(os.tmpdir(), `pbp-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(pbp));

    // The game still carries the box-score final (59-49), so this 4-6 feed looks
    // truncated: nothing is written and the game is counted incomplete, not failed.
    const partial = run('scripts/ingest-pbp.ts', {}, [`--game=${game.game_id}`, `--from-file=${file}`, '--format=cdn', '--keep-raw']);
    expect(partial).toContain('0 ingested, 1 incomplete');
    const [noFlow] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM game_flow WHERE game_id = ${game.game_id}::bigint`;
    expect(noFlow.n).toBe(0);

    // Make the game's final score match the synthetic feed's last event so it is accepted.
    await sql`UPDATE games SET home_score = 4, away_score = 6 WHERE game_id = ${game.game_id}::bigint`;
    const out = run('scripts/ingest-pbp.ts', {}, [`--game=${game.game_id}`, `--from-file=${file}`, '--format=cdn', '--keep-raw']);
    expect(out).toContain('1 ingested, 0 incomplete');

    const [flow] = await sql`SELECT lac_largest_lead, lac_largest_deficit, lead_changes, times_tied, lac_best_run, opp_best_run, comeback_margin, source
                             FROM game_flow WHERE game_id = ${game.game_id}::bigint`;
    expect(flow).toEqual({ lac_largest_lead: 3, lac_largest_deficit: 1, lead_changes: 2, times_tied: 1, lac_best_run: 3, opp_best_run: 4, comeback_margin: 1, source: 'cdn' });

    const star = await sql<{ period: number; pts: number; fg3m: number }[]>`
      SELECT pp.period, pp.pts, pp.fg3m FROM period_player_stats pp JOIN players p ON p.player_id = pp.player_id
      WHERE pp.game_id = ${game.game_id}::bigint AND p.display_name = 'Star Clipper' ORDER BY pp.period`;
    expect(star).toEqual([{ period: 1, pts: 3, fg3m: 1 }, { period: 4, pts: 3, fg3m: 0 }]);

    const [clutch] = await sql`SELECT c.pts, c.ftm FROM clutch_stats c JOIN teams t ON t.team_id = c.team_id
                               WHERE c.game_id = ${game.game_id}::bigint AND t.abbreviation = 'LAC' AND c.player_id IS NULL`;
    expect(clutch).toEqual({ pts: 3, ftm: 1 });

    const counts = async () => (await sql<{ events: number; periods: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM pbp_events WHERE game_id = ${game.game_id}::bigint) AS events,
             (SELECT COUNT(*)::int FROM period_team_stats WHERE game_id = ${game.game_id}::bigint) AS periods`)[0];
    expect(await counts()).toEqual({ events: 6, periods: 4 });

    // Stable provider ids: one row per action_number, with the raw type and subtype.
    const ids = await sql<{ action_number: number; action_type: string; sub_type: string }[]>`
      SELECT action_number, action_type, sub_type FROM pbp_events WHERE game_id = ${game.game_id}::bigint ORDER BY event_num`;
    expect(new Set(ids.map((r) => r.action_number)).size).toBe(6);
    expect(ids.map((r) => r.action_number)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ids[1]).toEqual({ action_number: 2, action_type: '3pt', sub_type: '' });

    // Already ingested → skipped; --force rewrites the same rows.
    expect(run('scripts/ingest-pbp.ts', {}, [`--game=${game.game_id}`, `--from-file=${file}`, '--format=cdn'])).toContain('0 game(s) to ingest');
    run('scripts/ingest-pbp.ts', {}, [`--game=${game.game_id}`, `--from-file=${file}`, '--format=cdn', '--force']);
    expect(await counts()).toEqual({ events: 6, periods: 4 });   // rows flagged keep by --keep-raw are stored again
    const [kept] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM pbp_events WHERE game_id = ${game.game_id}::bigint AND keep`;
    expect(kept.n).toBe(6);
  }, TIMEOUT);

  it('builds the record book: highs, streaks, records start; idempotent', async () => {
    const out = run('scripts/build-record-book.ts');
    expect(out).toContain('records start 2024-25');
    expect(out).toContain('pbp records start 2026-27');

    const [top] = await sql<{ display_name: string }[]>`
      SELECT p.display_name FROM rb_game_highs h JOIN players p ON p.player_id = h.player_id
      WHERE h.scope = 'lac_player' AND h.stat_key = 'pts' AND h.rank = 1`;
    expect(top.display_name).toBe('Star Clipper');

    const [career] = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM rb_game_highs h JOIN players p ON p.player_id::text = h.scope_id
      WHERE h.scope = 'player_career' AND h.stat_key = 'pts' AND p.display_name = 'Star Clipper'`;
    expect(career.n).toBeGreaterThan(0);

    const [low] = await sql<{ r1: number; r2: number }[]>`
      SELECT MAX(value) FILTER (WHERE rank = 1)::int AS r1, MAX(value) FILTER (WHERE rank = 2)::int AS r2
      FROM rb_game_highs WHERE scope = 'lac_team' AND stat_key = 'opp_pts_low'`;
    expect(low.r1).toBeLessThanOrEqual(low.r2);

    const [quarter] = await sql<{ value: number }[]>`
      SELECT value::int FROM rb_game_highs WHERE scope = 'lac_player' AND stat_key = 'q_pts' AND rank = 1`;
    expect(quarter.value).toBe(3);

    const [streak] = await sql<{ length: number; is_active: boolean }[]>`
      SELECT s.length, s.is_active FROM rb_streaks s JOIN players p ON p.player_id = s.entity_id
      WHERE s.entity_type = 'player' AND s.streak_key = 'scoring_30' AND p.display_name = 'Star Clipper'
      ORDER BY s.end_date DESC LIMIT 1`;
    expect(streak.is_active).toBe(true);
    expect(streak.length).toBeGreaterThanOrEqual(4);

    const [kv] = await sql<{ value: { season_id: number; label: string } }[]>`SELECT value FROM app_kv WHERE key = 'insights.records_start'`;
    expect(kv.value).toEqual({ season_id: 2024, label: '2024-25' });

    // Only the one 2026 Clippers game has play-by-play, so play-by-play records start in 2026-27.
    const [pbpKv] = await sql<{ value: { season_id: number; label: string } }[]>`SELECT value FROM app_kv WHERE key = 'insights.pbp_records_start'`;
    expect(pbpKv.value).toEqual({ season_id: 2026, label: '2026-27' });

    const counts = async () => (await sql<{ highs: number; streaks: number }[]>`
      SELECT (SELECT COUNT(*)::int FROM rb_game_highs) AS highs, (SELECT COUNT(*)::int FROM rb_streaks) AS streaks`)[0];
    const before = await counts();
    run('scripts/build-record-book.ts');
    expect(await counts()).toEqual(before);
  }, TIMEOUT);

  it('finds stale duplicate rows and removes only the safe ones', async () => {
    const { findLikelyDuplicates, removeStaleDuplicate } = await import('./league-ingest');
    // Two older-provider rows dated a day after real fixture games (like 2022-23 in production).
    const real = await sql<{ game_id: string; game_date: string; home_team_id: string; away_team_id: string }[]>`
      SELECT game_id::text, game_date::text, home_team_id::text, away_team_id::text
      FROM games WHERE season_id = 2024 ORDER BY game_id LIMIT 2
    `;
    const stale = await sql<{ game_id: string }[]>`
      INSERT INTO games ${sql(real.map((g, i) => ({
        nba_game_id: 15_000_001 + i, season_id: 2024, status: 'final',
        game_date: new Date(new Date(g.game_date).getTime() + 86_400_000).toISOString().slice(0, 10),
        home_team_id: g.home_team_id, away_team_id: g.away_team_id,
      })))}
      RETURNING game_id::text
    `;
    // The second one is referenced elsewhere, so it must be kept.
    await sql`
      INSERT INTO odds_snapshots (game_id, provider, captured_at, raw_payload)
      VALUES (${stale[1].game_id}::bigint, 'test', now(), '{}')
    `;

    const dupes = await findLikelyDuplicates(2024);
    expect(dupes.map((d) => d.stale_id).sort()).toEqual(stale.map((s) => s.game_id).sort());

    const reasons = await Promise.all(dupes.map((d) => removeStaleDuplicate(d, 2024)));
    const byId = Object.fromEntries(dupes.map((d, i) => [d.stale_id, reasons[i]]));
    expect(byId[stale[0].game_id]).toBeNull();
    expect(byId[stale[1].game_id]).toBe('referenced by odds_snapshots.game_id');
    expect((await findLikelyDuplicates(2024)).map((d) => d.stale_id)).toEqual([stale[1].game_id]);
  }, TIMEOUT);
});
