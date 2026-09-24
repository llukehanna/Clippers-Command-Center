// scripts/lib/pipeline.integration.test.ts
// End-to-end test of the stats + insight pipeline against a LOCAL Postgres
// seeded with a synthetic league (scripts/dev/seed-fixture-league.ts).
//
// Skipped unless FIXTURE_DATABASE_URL is set. The database is wiped.
//   FIXTURE_DATABASE_URL=postgres://postgres@127.0.0.1:5432/fixture npx vitest run scripts/lib/pipeline
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
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
});
