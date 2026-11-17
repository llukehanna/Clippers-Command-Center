// scripts/lib/history/import.integration.test.ts
// End-to-end test of scripts/import-kaggle-history.ts against a LOCAL Postgres.
//
// Skipped unless FIXTURE_DATABASE_URL is set. The database is WIPED.
//   FIXTURE_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55499/fixture npx vitest run scripts/lib/history/import
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import postgres from 'postgres';
import { periodsBackfillCandidates } from '../periods-candidates.js';

const url = process.env.FIXTURE_DATABASE_URL;
const TIMEOUT = 180_000;
const FX = path.join(process.cwd(), 'scripts/lib/__fixtures__/kaggle-import');
const LAC = 13, BOS = 2, PHX = 24, WAS = 30, OLD_WAS = 45;

const COUNTED_TABLES = [
  'all_games', 'game_team_box_scores', 'game_player_box_scores', 'players', 'seasons',
  'team_era_names', 'team_seasons', 'player_seasons', 'league_season_averages', 'app_kv',
] as const;

function runImport(args: string[] = []): string {
  return execFileSync('npx', ['tsx', 'scripts/import-kaggle-history.ts', `--dir=${FX}`, '--skip-derived', ...args], {
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

describe.skipIf(!url)('Kaggle history import (fixture DB)', () => {
  let sql: postgres.Sql;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kaggle-import-'));
  const reportPath = path.join(tmp, 'import-report.json');
  const dryReportPath = path.join(tmp, 'dry-run-report.json');
  let seededCounts: Record<string, number>;
  let afterDryRunCounts: Record<string, number>;
  let legacyGameId: string;
  const seeded: Record<string, string> = {}; // label -> game_id of the 1998 matching cases

  async function counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const t of COUNTED_TABLES) {
      const [r] = await sql<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM ${sql(t)}`;
      out[t] = r.n;
    }
    return out;
  }

  beforeAll(async () => {
    sql = postgres(url!, { max: 1, onnotice: () => {} }); // max 1: DB_SCHEMA.sql has BEGIN/COMMIT
    await sql.unsafe('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
    await sql.unsafe(fs.readFileSync(path.join(process.cwd(), 'Docs/DB_SCHEMA.sql'), 'utf8'));

    await sql`
      INSERT INTO teams (team_id, nba_team_id, abbreviation, name, city) VALUES
        (${BOS}, 2, 'BOS', 'Celtics', 'Boston'),
        (${LAC}, 13, 'LAC', 'Clippers', 'Los Angeles'),
        (${PHX}, 24, 'PHX', 'Suns', 'Phoenix'),
        (${WAS}, 30, 'WAS', 'Wizards', 'Washington'),
        (${OLD_WAS}, 45, 'WAS', 'Capitols', 'Washington')`;
    await sql`INSERT INTO seasons (season_id, label) VALUES (2019, '2019-20'), (2025, '2025-26') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO players (first_name, last_name, display_name, nba_person_id, birthdate) VALUES
        ('Bob', 'McAdoo', 'Bob McAdoo', NULL, '1951-09-25'),
        ('John', 'Smith', 'John Smith', NULL, NULL),
        ('John', 'Smith', 'John Smith', NULL, NULL),
        ('Devin', 'Booker', 'Devin Booker', 1626164, '1996-10-30')`;
    // The 1985 Clippers game, stored under a legacy balldontlie id.
    [{ game_id: legacyGameId }] = await sql<{ game_id: string }[]>`
      INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score)
      VALUES (17195500, 1985, '1985-12-10', 'final', ${LAC}, ${BOS}, 98, 104)
      RETURNING game_id::text`;
    // 700 synthetic 2015 regular-season games with box scores, so coverage
    // makes 2015 a complete season.
    await sql`
      INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score)
      SELECT 91500000 + i, 2015, DATE '2003-01-01' + i, 'final', ${PHX}, ${BOS}, 100, 90
      FROM generate_series(1, 700) AS i`;
    await sql`INSERT INTO seasons (season_id, label) VALUES (2015, '2015-16') ON CONFLICT DO NOTHING`;
    await sql`
      INSERT INTO game_player_box_scores (game_id, team_id, player_id, points)
      SELECT g.game_id, ${PHX}, (SELECT player_id FROM players WHERE nba_person_id = 1626164), 20
      FROM all_games g WHERE g.nba_game_id > 91500000`;

    // 1998 matching cases (Kaggle games 29800101-29800105), all season 1998.
    const [{ player_id: legacyPlayer }] = await sql<{ player_id: string }[]>`
      INSERT INTO players (first_name, last_name, display_name) VALUES ('Legacy', 'Guy', 'Legacy Guy')
      RETURNING player_id::text`;
    const seedGame = async (label: string, nbaGameId: number, date: string, home: number, away: number, boxPoints: number | null) => {
      const [{ game_id }] = await sql<{ game_id: string }[]>`
        INSERT INTO all_games (nba_game_id, season_id, game_date, status, home_team_id, away_team_id, home_score, away_score)
        VALUES (${nbaGameId}, 1998, ${date}, 'final', ${home}, ${away}, 90, 80) RETURNING game_id::text`;
      if (boxPoints !== null) {
        await sql`INSERT INTO game_player_box_scores (game_id, team_id, player_id, points)
                  VALUES (${game_id}, ${home}, ${legacyPlayer}, ${boxPoints})`;
      }
      seeded[label] = game_id;
    };
    await seedGame('a', 17000001, '1998-11-10', LAC, PHX, 11); // same date, legacy id, has box scores
    await seedGame('b', 29800102, '1998-11-12', PHX, LAC, 99); // already under its NBA id, has box scores
    await seedGame('c', 17000003, '1998-11-15', LAC, BOS, null); // a day off, no box scores
    await seedGame('d', 17000004, '1998-11-19', BOS, LAC, 7); // a day off, has box scores
    await seedGame('e1', 17000005, '1998-11-24', PHX, LAC, null); // two candidates within ±1 day
    await seedGame('e2', 17000006, '1998-11-26', PHX, LAC, null);

    seededCounts = await counts();
    runImport(['--dry-run', `--report=${dryReportPath}`]);
    afterDryRunCounts = await counts();
    runImport([`--report=${reportPath}`]);
  }, TIMEOUT);

  afterAll(async () => {
    await sql?.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('dry run writes nothing to the database and writes the report', () => {
    expect(afterDryRunCounts).toEqual(seededCounts);
    const report = JSON.parse(fs.readFileSync(dryReportPath, 'utf8'));
    expect(report.players.ambiguous.map((a: { name: string }) => a.name)).toEqual(['John Smith']);
    expect(report.rowErrors['PlayerStatistics.csv'].count).toBe(1);
    // The dry run runs the same matching: day-off reuse, day-off row left alone, ambiguous match.
    expect(report.gameMatches).toMatchObject({ reused: 1, nearReused: 1, nearSkipped: 1 });
    expect(report.gameMatches.ambiguous.map((m: { nbaGameId: number }) => m.nbaGameId)).toEqual([29800105]);
    const stage1998 = report.perSeason.find((p: { stage: string }) => p.stage === '1998 clippers');
    expect(stage1998).toMatchObject({ games: 1, reused: 0, nearReused: 1, alreadyLoaded: 3, nearSkipped: 1, skipped: 4 });
  });

  it('imports a 1972 Braves game with nulls preserved', async () => {
    const [g] = await sql<{ game_id: string; status: string; season_id: number; is_playoffs: boolean; home_team_id: string }[]>`
      SELECT game_id::text, status, season_id, is_playoffs, home_team_id::text FROM all_games WHERE nba_game_id = 27200123`;
    expect(g).toMatchObject({ status: 'final', season_id: 1972, is_playoffs: false, home_team_id: String(LAC) });

    const [mcadoo] = await sql<{ steals: number | null; turnovers: number | null; blocks: number | null; points: number; minutes: string; raw_payload: unknown; nba_person_id: number }[]>`
      SELECT pb.steals, pb.turnovers, pb.blocks, pb.points, pb.minutes, pb.raw_payload, p.nba_person_id
      FROM game_player_box_scores pb JOIN players p USING (player_id)
      WHERE pb.game_id = ${g.game_id} AND p.display_name = 'Bob McAdoo'`;
    expect(mcadoo).toEqual({ steals: null, turnovers: null, blocks: null, points: 25, minutes: '34:30', raw_payload: null, nba_person_id: 76001 });

    const [team] = await sql<{ points: number; steals: number | null; rebounds: number; source: string; payload: string }[]>`
      SELECT points, steals, rebounds, raw_payload->>'source' AS source, raw_payload::text AS payload
      FROM game_team_box_scores WHERE game_id = ${g.game_id} AND team_id = ${LAC}`;
    expect(team).toEqual({ points: 45, steals: null, rebounds: 14, source: 'kaggle', payload: '{"source": "kaggle"}' });
  });

  it('backfills nba_person_id on a name match and does not duplicate the player', async () => {
    const rows = await sql<{ nba_person_id: number | null }[]>`SELECT nba_person_id FROM players WHERE display_name = 'Bob McAdoo'`;
    expect(rows).toEqual([{ nba_person_id: 76001 }]);
  });

  it('creates unmatched players as inactive', async () => {
    const [walker] = await sql<{ first_name: string; last_name: string; is_active: boolean; birthdate: string | null }[]>`
      SELECT first_name, last_name, is_active, birthdate::text FROM players WHERE nba_person_id = 77011`;
    expect(walker).toEqual({ first_name: 'Antoine', last_name: 'Walker', is_active: false, birthdate: null });
    const [cowens] = await sql<{ display_name: string; birthdate: string }[]>`
      SELECT display_name, birthdate::text FROM players WHERE nba_person_id = 600001`;
    expect(cowens).toEqual({ display_name: 'Dave Cowens', birthdate: '1948-10-25' });
  });

  it('skips ambiguous players but still loads their game', async () => {
    const [g] = await sql<{ game_id: string; home_team_id: string }[]>`
      SELECT game_id::text, home_team_id::text FROM all_games WHERE nba_game_id = 29700500`;
    // R12: WAS maps to the current franchise row, not the defunct 'WAS'.
    expect(g.home_team_id).toBe(String(WAS));
    const names = await sql<{ display_name: string }[]>`
      SELECT p.display_name FROM game_player_box_scores pb JOIN players p USING (player_id)
      WHERE pb.game_id = ${g.game_id} ORDER BY 1`;
    expect(names.map((r) => r.display_name)).toEqual(['Antoine Walker', 'Chris Webber']);
    const smiths = await sql`SELECT 1 FROM players WHERE display_name = 'John Smith'`;
    expect(smiths).toHaveLength(2);
    // Team totals still include the skipped player's line.
    const [team] = await sql<{ points: number }[]>`
      SELECT points FROM game_team_box_scores WHERE game_id = ${g.game_id} AND team_id = ${WAS}`;
    expect(team.points).toBe(32);
  });

  it('reuses a game stored under a legacy id', async () => {
    const rows = await sql<{ game_id: string; nba_game_id: string }[]>`
      SELECT game_id::text, nba_game_id::text FROM all_games
      WHERE game_date = '1985-12-10' AND home_team_id = ${LAC} AND away_team_id = ${BOS}`;
    expect(rows).toEqual([{ game_id: legacyGameId, nba_game_id: '28500300' }]);
    const box = await sql`SELECT 1 FROM game_player_box_scores WHERE game_id = ${legacyGameId}`;
    // Derek Smith, Marques Johnson, Larry Bird, Kevin McHale; the DNP and the malformed row are not written.
    expect(box).toHaveLength(4);
  });

  type Row = { game_id: string; nba_game_id: string; game_date: string };
  const rowsFor = (from: string, to: string, home: number, away: number) => sql<Row[]>`
    SELECT game_id::text, nba_game_id::text, game_date::text FROM all_games
    WHERE game_date BETWEEN ${from} AND ${to} AND home_team_id = ${home} AND away_team_id = ${away} ORDER BY game_date`;
  const boxPoints = (gameId: string) => sql<{ points: number }[]>`
    SELECT points FROM game_player_box_scores WHERE game_id = ${gameId} ORDER BY points`;

  it('leaves a same-date legacy row with box scores untouched, keeping its legacy id', async () => {
    expect(await rowsFor('1998-11-09', '1998-11-11', LAC, PHX)).toEqual([
      { game_id: seeded.a, nba_game_id: '17000001', game_date: '1998-11-10' },
    ]);
    expect(await boxPoints(seeded.a)).toEqual([{ points: 11 }]);
    expect(await sql`SELECT 1 FROM game_team_box_scores WHERE game_id = ${seeded.a}`).toHaveLength(0);
  });

  it('skips a game already stored under its NBA id with box scores', async () => {
    expect(await rowsFor('1998-11-11', '1998-11-13', PHX, LAC)).toEqual([
      { game_id: seeded.b, nba_game_id: '29800102', game_date: '1998-11-12' },
    ]);
    expect(await boxPoints(seeded.b)).toEqual([{ points: 99 }]);
    expect(await sql`SELECT 1 FROM game_team_box_scores WHERE game_id = ${seeded.b}`).toHaveLength(0);
  });

  it('reuses and re-keys a legacy row a day off with no box scores', async () => {
    expect(await rowsFor('1998-11-13', '1998-11-16', LAC, BOS)).toEqual([
      { game_id: seeded.c, nba_game_id: '29800103', game_date: '1998-11-14' },
    ]);
    expect(await boxPoints(seeded.c)).toEqual([{ points: 18 }, { points: 20 }]);
  });

  it('leaves a legacy row a day off with box scores untouched and creates no duplicate', async () => {
    expect(await rowsFor('1998-11-18', '1998-11-21', BOS, LAC)).toEqual([
      { game_id: seeded.d, nba_game_id: '17000004', game_date: '1998-11-19' },
    ]);
    expect(await boxPoints(seeded.d)).toEqual([{ points: 7 }]);
    expect(await sql`SELECT 1 FROM all_games WHERE nba_game_id = 29800104`).toHaveLength(0);
  });

  it('skips and reports a game with two candidate rows within a day', async () => {
    expect(await rowsFor('1998-11-23', '1998-11-27', PHX, LAC)).toEqual([
      { game_id: seeded.e1, nba_game_id: '17000005', game_date: '1998-11-24' },
      { game_id: seeded.e2, nba_game_id: '17000006', game_date: '1998-11-26' },
    ]);
    expect(await sql`SELECT 1 FROM game_player_box_scores WHERE game_id IN (${seeded.e1}, ${seeded.e2})`).toHaveLength(0);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.gameMatches.ambiguous).toEqual([{
      nbaGameId: 29800105, gameDate: '1998-11-25',
      candidates: [
        { game_id: seeded.e1, nba_game_id: '17000005', game_date: '1998-11-24' },
        { game_id: seeded.e2, nba_game_id: '17000006', game_date: '1998-11-26' },
      ],
    }]);
  });

  it('fills the 2019 gap', async () => {
    const [g] = await sql<{ season_id: number; n: number }[]>`
      SELECT g.season_id, (SELECT COUNT(*)::int FROM game_player_box_scores pb WHERE pb.game_id = g.game_id) AS n
      FROM all_games g WHERE nba_game_id = 21900100`;
    expect(g).toEqual({ season_id: 2019, n: 2 });
  });

  it('never writes preseason or All-Star games', async () => {
    const rows = await sql`SELECT 1 FROM all_games WHERE nba_game_id IN (10500012, 30500001)`;
    expect(rows).toHaveLength(0);
    const people = await sql`SELECT 1 FROM players WHERE nba_person_id IN (88001, 88002)`;
    expect(people).toHaveLength(0);
  });

  it('never writes games from 2020 or later', async () => {
    // season_id, not a date bound: the 2019-20 bubble ran July-October 2020.
    const rows = await sql`SELECT 1 FROM all_games WHERE nba_game_id IN (22000100, 22500010) OR season_id >= 2020`;
    expect(rows).toHaveLength(0);
    const kawhi = await sql`SELECT 1 FROM players WHERE nba_person_id = 202695`;
    expect(kawhi).toHaveLength(0);
  });

  it('builds season tables through the last finished season', async () => {
    const seasons = await sql<{ season_id: number }[]>`SELECT DISTINCT season_id FROM team_seasons ORDER BY 1`;
    expect(seasons.map((s) => s.season_id)).toEqual([1946, 1972, 1985, 1997, 1998, 2019, 2020]);
    const [braves] = await sql<{ team_id: string | null; wins: number; losses: number; steals: number | null; abbreviation: string }[]>`
      SELECT team_id::text, wins, losses, steals, abbreviation FROM team_seasons
      WHERE season_id = 1972 AND nba_franchise_id = 1610612746`;
    expect(braves).toEqual({ team_id: String(LAC), wins: 1, losses: 0, steals: null, abbreviation: 'BUF' });
    const [pitt] = await sql<{ team_id: string | null }[]>`
      SELECT team_id::text FROM team_seasons WHERE season_id = 1946 AND nba_franchise_id = 1610610031`;
    expect(pitt.team_id).toBeNull();
    const [mcadoo] = await sql<{ player_id: string | null; points: number; steals: number | null }[]>`
      SELECT player_id::text, points, steals FROM player_seasons WHERE season_id = 1972 AND nba_person_id = 76001`;
    expect(mcadoo.player_id).not.toBeNull();
    expect(mcadoo).toMatchObject({ points: 25, steals: null });
    const [avg] = await sql`SELECT COUNT(*)::int AS n FROM league_season_averages`;
    expect(avg.n).toBe(7);
  });

  it('upserts era names against the current franchise rows', async () => {
    const eras = await sql<{ first_season_id: number; abbreviation: string; city: string }[]>`
      SELECT first_season_id, abbreviation, city FROM team_era_names WHERE team_id = ${LAC} ORDER BY 1`;
    expect(eras.map((e) => e.abbreviation)).toEqual(['BUF', 'SDC', 'LAC']);
    const old = await sql`SELECT 1 FROM team_era_names WHERE team_id = ${OLD_WAS}`;
    expect(old).toHaveLength(0);
  });

  it('records history:backfilled_through from coverage', async () => {
    const [kv] = await sql<{ value: number }[]>`SELECT value::int AS value FROM app_kv WHERE key = 'history:backfilled_through'`;
    expect(kv.value).toBe(2015);
  });

  it('is idempotent across a re-run', async () => {
    const before = await counts();
    const snapshot = await sql`SELECT nba_game_id::text, home_score, away_score, status FROM all_games ORDER BY nba_game_id`;
    runImport([`--report=${reportPath}`]);
    expect(await counts()).toEqual(before);
    expect(await sql`SELECT nba_game_id::text, home_score, away_score, status FROM all_games ORDER BY nba_game_id`).toEqual(snapshot);
  }, TIMEOUT);
  it('computes advanced stats only for Clippers games before 2019', async () => {
    execFileSync('npx', ['tsx', 'scripts/compute-stats.ts'], {
      encoding: 'utf8',
      env: { ...process.env, DATABASE_URL: url },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const advancedRows = (nbaGameId: number) => sql`
      SELECT 1 FROM advanced_team_game_stats a JOIN all_games g USING (game_id) WHERE g.nba_game_id = ${nbaGameId}`;
    // 1997 Wizards-Celtics: two box-scored teams, neither the Clippers.
    expect(await sql`SELECT 1 FROM game_team_box_scores b JOIN all_games g USING (game_id) WHERE g.nba_game_id = 29700500`).not.toHaveLength(0);
    expect(await advancedRows(29700500)).toHaveLength(0);
    // 1972 Braves (Clippers franchise) game.
    expect(await advancedRows(27200123)).not.toHaveLength(0);
  }, TIMEOUT);

  it('keeps Kaggle games out of the periods backfill', async () => {
    const kaggle = await sql<{ n: number }[]>`
      SELECT COUNT(*)::int AS n FROM game_team_box_scores WHERE raw_payload->>'source' = 'kaggle'`;
    expect(kaggle[0].n).toBeGreaterThan(0);
    const candidates = await periodsBackfillCandidates(sql, 1000);
    const kaggleGames = await sql<{ game_id: string }[]>`
      SELECT DISTINCT game_id::text FROM game_team_box_scores WHERE raw_payload->>'source' = 'kaggle'`;
    const ids = new Set(kaggleGames.map((r) => r.game_id));
    expect(candidates.filter((c) => ids.has(c.game_id))).toEqual([]);
  });
});
