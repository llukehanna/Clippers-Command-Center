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
  let seededCounts: Record<string, number>;
  let afterDryRunCounts: Record<string, number>;
  let legacyGameId: string;

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

    seededCounts = await counts();
    runImport(['--dry-run', `--report=${reportPath}`]);
    afterDryRunCounts = await counts();
    runImport([`--report=${reportPath}`]);
  }, TIMEOUT);

  afterAll(async () => {
    await sql?.end();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('dry run writes nothing to the database and writes the report', () => {
    expect(afterDryRunCounts).toEqual(seededCounts);
    const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
    expect(report.players.ambiguous.map((a: { name: string }) => a.name)).toEqual(['John Smith']);
    expect(report.rowErrors['PlayerStatistics.csv'].count).toBe(1);
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
    const rows = await sql`SELECT 1 FROM all_games WHERE nba_game_id IN (22000100, 22500010) OR game_date >= '2020-07-01'`;
    expect(rows).toHaveLength(0);
    const kawhi = await sql`SELECT 1 FROM players WHERE nba_person_id = 202695`;
    expect(kawhi).toHaveLength(0);
  });

  it('builds season tables through the last finished season', async () => {
    const seasons = await sql<{ season_id: number }[]>`SELECT DISTINCT season_id FROM team_seasons ORDER BY 1`;
    expect(seasons.map((s) => s.season_id)).toEqual([1946, 1972, 1985, 1997, 2019, 2020]);
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
    expect(avg.n).toBe(6);
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
});
