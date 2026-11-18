// scripts/import-kaggle-history.ts
// One-time import of historical games from the Kaggle "Historical NBA Data and
// Player Box Scores" CSVs (CC0), run LOCALLY against the production database.
//
// Writes:
//   - per-game rows (all_games + team/player box scores) for Clippers games
//     1970-2018, every 2019-20 game (gap fill), and league games 1996-2018,
//     newest first. Never 2020-21 or later: the live pipeline owns those.
//   - team_seasons / player_seasons / league_season_averages for every finished
//     season in the file (1946 on), as a full replace.
//   - team_era_names, seasons rows, new (inactive) players and nba_person_id backfills.
// A game that already has player box scores is never touched, so re-runs are safe.
//
// Flags:
//   --dir=<path>       folder with Games.csv, PlayerStatistics.csv, Players.csv (required)
//   --dry-run          read-only: no database writes; still writes the report
//   --from=, --to=     limit seasons (1996 or 1996-97)
//   --only=games|seasons
//   --cap-mb=<n>       storage cap for the guard (default 512; stops at 85%)
//   --skip-derived     do not run compute-stats / build-record-book at the end
//   --report=<path>    report file (default data/import-report.json, relative to the cwd)
//
// Run via: npm run import-kaggle-history -- --dir=data/kaggle [--dry-run]
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { sql } from './lib/db.js';
import {
  streamCsv, assertHeaders, parseGame, parsePlayerGame, parsePerson, KaggleRowError, seasonIdOfGame, tallyRawCells,
  RAW_CELL_STATS, RAW_CELL_SEASONS, type RawCellTally, REQUIRED_GAMES_COLUMNS, REQUIRED_PLAYER_STATS_COLUMNS, REQUIRED_PLAYERS_COLUMNS, GAMES_COLUMNS,
  type KaggleGame, type KagglePlayerGame, type KagglePerson,
} from './lib/history/kaggle.js';
import { matchPlayers } from './lib/history/match-players.js';
import {
  aggregatePlayerSeasons, aggregateTeamSeasons, leagueAverages, compareFranchiseRecords, played,
} from './lib/history/season-totals.js';
import {
  planLoad, stepGames, guardAllows, estimateBytes, eraProblems, checkPointsAgainstScores, capped, GAP_FILL_SEASON, type LoadStep,
} from './lib/history/import-plan.js';
import {
  type Db, loadTeamIdByFranchise, loadDbPlayers, loadPlayerIdByPerson, databaseBytes, ambiguousMatchOf, type AmbiguousGameMatch,
  writePlayers, upsertSeasonRows, replaceEraNames, writeSeasonGames, replaceSeasonTables, loadCoverage,
  setBackfilledThrough,
} from './lib/history/write.js';
import { classifyGames } from './lib/history/match-games.js';
import { resolveRecordsStart } from './lib/record-book/records-start.js';

const log = (msg: string) => console.log(`[import-kaggle] ${msg}`);
const MB = 1024 * 1024;
const mb = (bytes: number) => `${(bytes / MB).toFixed(1)} MB`;
const tsx = (script: string) => execFileSync('npx', ['tsx', script], { stdio: 'inherit', env: process.env });

type Args = {
  dir: string; dryRun: boolean; from: number; to: number; only: 'games' | 'seasons' | null;
  capMb: number; skipDerived: boolean; report: string;
};

function parseArgs(argv: string[]): Args {
  const val = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const season = (name: string, dflt: number) => {
    const v = val(name);
    if (v === undefined) return dflt;
    const m = /^(\d{4})(-\d{2})?$/.exec(v);
    if (!m) throw new Error(`Invalid --${name}="${v}" (expected 1996 or 1996-97)`);
    return Number(m[1]);
  };
  const dir = val('dir');
  if (!dir) throw new Error('--dir=<folder with the Kaggle CSVs> is required');
  const only = val('only') ?? null;
  if (only !== null && only !== 'games' && only !== 'seasons') throw new Error(`Invalid --only="${only}" (games|seasons)`);
  const capMb = Number(val('cap-mb') ?? 512);
  if (!(capMb > 0)) throw new Error('--cap-mb must be a positive number');
  return {
    dir, dryRun: argv.includes('--dry-run'), from: season('from', 0), to: season('to', 9999), only,
    capMb, skipDerived: argv.includes('--skip-derived'), report: val('report') ?? path.join('data', 'import-report.json'),
  };
}

type RowErrors = Record<string, { count: number; samples: string[] }>;

/** Streams a CSV, checks its headers on the first row and hands each row to `each`; malformed rows are counted. */
async function readCsv(file: string, required: string[], errors: RowErrors, each: (row: Record<string, string>) => void) {
  const name = path.basename(file);
  errors[name] = { count: 0, samples: [] };
  let first = true;
  for await (const row of streamCsv(file)) {
    if (first) { assertHeaders(name, Object.keys(row), required); first = false; }
    try {
      each(row);
    } catch (err) {
      if (!(err instanceof KaggleRowError)) throw err;
      errors[name].count++;
      if (errors[name].samples.length < 20) errors[name].samples.push(err.message);
    }
  }
  if (first) throw new Error(`${name} has no rows`);
}

type LiveIdentityBackfill = {
  name: string; personId: number; birthdate: string | null;
  playerId: string; dbName: string; dbBirthdate: string | null;
  boxScoreRows: number; matchedBy: 'name + birthdate' | 'name only';
};

/** Every planned nba_person_id backfill whose player_id already has game_player_box_scores rows. */
async function liveIdentityBackfills(
  db: Db,
  backfills: Array<{ player_id: string; nba_person_id: number }>,
  people: Map<number, KagglePerson>,
  dbPlayers: Array<{ player_id: string; display_name: string; birthdate: string | null }>,
): Promise<LiveIdentityBackfill[]> {
  if (backfills.length === 0) return [];
  const boxRows = new Map<string, number>();
  for (let i = 0; i < backfills.length; i += 1000) {
    const ids = backfills.slice(i, i + 1000).map((b) => b.player_id);
    const counts = await db<{ player_id: string; n: number }[]>`
      SELECT player_id::text, COUNT(*)::int AS n FROM game_player_box_scores
      WHERE player_id = ANY(${ids}::bigint[]) GROUP BY player_id`;
    for (const c of counts) boxRows.set(c.player_id, c.n);
  }
  const dbById = new Map(dbPlayers.map((p) => [p.player_id, p]));
  const out: LiveIdentityBackfill[] = [];
  for (const b of backfills) {
    const n = boxRows.get(b.player_id);
    if (!n) continue;
    const person = people.get(b.nba_person_id);
    const row = dbById.get(b.player_id);
    const birthdate = person?.birthdate ?? null;
    const dbBirthdate = row?.birthdate ?? null;
    out.push({
      name: person ? `${person.firstName} ${person.lastName}`.trim() : '', personId: b.nba_person_id, birthdate,
      playerId: b.player_id, dbName: row?.display_name ?? '', dbBirthdate, boxScoreRows: n,
      matchedBy: birthdate && dbBirthdate && birthdate === dbBirthdate ? 'name + birthdate' : 'name only',
    });
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inRange = (s: number) => s >= args.from && s <= args.to;
  const rowErrors: RowErrors = {};
  log(`${args.dryRun ? 'DRY RUN (no database writes). ' : ''}Reading ${args.dir}`);

  // ── Read the CSVs (everything is read and checked before any write) ────────
  const allGames: KaggleGame[] = [];
  const skippedByDesign = new Set<number>();
  await readCsv(path.join(args.dir, 'Games.csv'), REQUIRED_GAMES_COLUMNS, rowErrors, (row) => {
    const g = parseGame(row);
    if (g) allGames.push(g); else skippedByDesign.add(Number(row[GAMES_COLUMNS.gameId]));
  });
  const maxSeason = allGames.reduce((m, g) => Math.max(m, g.seasonId), -Infinity);
  const tableSeasons = args.only === 'games' ? []
    : [...new Set(allGames.map((g) => g.seasonId))].filter((s) => s < maxSeason && inRange(s)).sort((a, b) => a - b);
  const steps = args.only === 'seasons' ? [] : planLoad(allGames.map((g) => g.seasonId).filter(inRange));
  const stepSeasons = new Set(steps.map((s) => s.seasonId));
  const writableGames = new Map<number, KaggleGame>();
  for (const step of steps) {
    for (const g of stepGames(step, allGames.filter((x) => x.seasonId === step.seasonId))) writableGames.set(g.nbaGameId, g);
  }
  const tableSet = new Set(tableSeasons);
  const keptGames = new Map(allGames.filter((g) => tableSet.has(g.seasonId) || writableGames.has(g.nbaGameId)).map((g) => [g.nbaGameId, g]));
  const parsedGameIds = new Set(allGames.map((g) => g.nbaGameId));
  log(`Games.csv: ${allGames.length} games; per-game seasons ${[...stepSeasons].sort().join(', ') || 'none'}; season tables ${tableSeasons[0] ?? '-'}–${tableSeasons.at(-1) ?? '-'}`);

  const people = new Map<number, KagglePerson>();
  await readCsv(path.join(args.dir, 'Players.csv'), REQUIRED_PLAYERS_COLUMNS, rowErrors, (row) => {
    const p = parsePerson(row);
    people.set(p.personId, p);
  });

  const rows: KagglePlayerGame[] = [];
  let rowsWithoutGame = 0;
  // Raw cells (before the era mask) of played rows in 1970-85 games, every team, by season.
  const rawCells: RawCellTally = {};
  await readCsv(path.join(args.dir, 'PlayerStatistics.csv'), REQUIRED_PLAYER_STATS_COLUMNS, rowErrors, (row) => {
    const r = parsePlayerGame(row);
    if (parsedGameIds.has(r.nbaGameId) && played(r)) tallyRawCells(rawCells, row, r.nbaGameId);
    if (keptGames.has(r.nbaGameId)) rows.push(r);
    else if (!parsedGameIds.has(r.nbaGameId) && !skippedByDesign.has(r.nbaGameId) && inRange(seasonIdOfGame(r.nbaGameId))) rowsWithoutGame++;
  });
  log(`PlayerStatistics.csv: kept ${rows.length} rows (${rowsWithoutGame} rows have no game in Games.csv)`);
  const rawSeasons = Object.keys(rawCells).map(Number).sort((a, b) => a - b);
  if (rawSeasons.length) {
    log(`Raw cells in played rows, ${RAW_CELL_SEASONS.from}-${RAW_CELL_SEASONS.to} (blank/zero/non-zero, before the era mask):`);
    for (const s of rawSeasons) {
      log(`  ${s}: ${RAW_CELL_STATS.map((k) => { const c = rawCells[s][k]; return `${k} ${c.blank}/${c.zero}/${c.nonZero}`; }).join(', ')}`);
    }
  }

  // ── Checks and matching (read-only) ────────────────────────────────────────
  const db = sql as unknown as Db;
  const teamIdByFranchise = await loadTeamIdByFranchise(db);
  const problems: string[] = eraProblems(allGames).map((p) =>
    `${p.seasonId}: franchise ${p.franchiseId}${p.tricode ? ` (${p.tricode})` : ''}: ${p.reason}`);
  const unmappedTeams = new Set<number>();
  for (const g of writableGames.values()) {
    for (const fid of [g.homeFranchiseId, g.awayFranchiseId]) if (!teamIdByFranchise.has(fid)) unmappedTeams.add(fid);
  }
  for (const fid of unmappedTeams) problems.push(`franchise ${fid}: no current teams row (nba_team_id 1-30)`);

  const writableRows = rows.filter((r) => writableGames.has(r.nbaGameId));
  const writableRowsBySeason = new Map<number, KagglePlayerGame[]>();
  for (const r of writableRows) {
    const s = seasonIdOfGame(r.nbaGameId);
    const a = writableRowsBySeason.get(s); if (a) a.push(r); else writableRowsBySeason.set(s, [r]);
  }
  const referenced = new Map<number, KagglePerson>();
  for (const r of writableRows) {
    if (!played(r) || referenced.has(r.personId)) continue;
    referenced.set(r.personId, people.get(r.personId) ?? { personId: r.personId, firstName: r.firstName, lastName: r.lastName, birthdate: null });
  }
  const dbPlayers = await loadDbPlayers(db);
  const match = matchPlayers([...referenced.values()], dbPlayers);
  const ambiguous = new Set(match.ambiguous.map((a) => a.person.personId));

  // Name matches that would set nba_person_id on a player who already has box
  // scores (a live-pipeline identity). Listed for review before the real run.
  const backfillsOntoLiveIdentities = await liveIdentityBackfills(db, match.backfillNbaId, referenced, dbPlayers);
  if (backfillsOntoLiveIdentities.length) {
    log(`nba_person_id backfills onto players who already have box scores (${backfillsOntoLiveIdentities.length}; review before the real run):`);
    for (const b of backfillsOntoLiveIdentities) {
      log(`  ${b.name} (Kaggle ${b.personId}${b.birthdate ? `, born ${b.birthdate}` : ''}) -> player_id ${b.playerId} "${b.dbName}"${b.dbBirthdate ? ` born ${b.dbBirthdate}` : ''}: ${b.boxScoreRows} box score rows, matched by ${b.matchedBy}`);
    }
  }

  const teamSeasons = aggregateTeamSeasons(allGames.filter((g) => tableSet.has(g.seasonId)), rows);
  const playerSeasons = aggregatePlayerSeasons(allGames.filter((g) => tableSet.has(g.seasonId)), rows);
  const averages = leagueAverages(teamSeasons);
  // Range filter, not set membership: an official season missing from the file must show up as 'missing'.
  const recordMismatches = tableSeasons.length === 0 ? []
    : compareFranchiseRecords(teamSeasons).filter((m) => m.seasonId >= tableSeasons[0] && inRange(m.seasonId) && m.seasonId < maxSeason);
  // Team points come from the final score; this lists where the player rows don't add up to it
  // (a missing or partial player row), for every game this run reads (per-game writes and season tables).
  const pointsCheck = checkPointsAgainstScores([...keptGames.values()], rows);
  const pointsVsScore = { mismatches: capped(pointsCheck.mismatches), noPlayerRows: capped(pointsCheck.noPlayerRows) };
  log(`Player points vs final score: ${pointsCheck.mismatches.length} team-games differ, ${pointsCheck.noPlayerRows.length} have no player rows (team points use the score; see report)`);

  if (problems.length) {
    log(`Pre-write check failed:\n  ${problems.join('\n  ')}`);
    if (!args.dryRun) throw new Error('Pre-write check failed; nothing was written');
  }

  // ── Reference writes ───────────────────────────────────────────────────────
  let eraTeamsMissing: string[] = [];
  let playerWrites = { created: 0, backfilled: 0 };
  if (!args.dryRun) {
    await sql.begin(async (txRaw) => {
      const tx = txRaw as unknown as Db;
      await upsertSeasonRows(tx, [...tableSeasons, ...stepSeasons]);
      eraTeamsMissing = await replaceEraNames(tx, teamIdByFranchise);
      playerWrites = await writePlayers(tx, match);
    });
    if (eraTeamsMissing.length) log(`Era names skipped (no current teams row): ${eraTeamsMissing.join(', ')}`);
  }
  const playerIdByPerson = await loadPlayerIdByPerson(db);
  for (const id of ambiguous) playerIdByPerson.delete(id);

  // ── Per-season loads in plan order, season tables after the 2019 gap fill ──
  type Stage = LoadStep | { scope: 'tables' };
  const stages: Stage[] = [];
  for (const s of steps) {
    if (s.scope === 'league' && s.seasonId < GAP_FILL_SEASON && !stages.some((x) => x.scope === 'tables') && tableSeasons.length) stages.push({ scope: 'tables' });
    stages.push(s);
  }
  if (tableSeasons.length && !stages.some((x) => x.scope === 'tables')) stages.push({ scope: 'tables' });

  const startBytes = await databaseBytes(db);
  let simulatedBytes = startBytes;
  const perSeason: Array<Record<string, unknown>> = [];
  const skippedStages: string[] = [];
  let stopped = false;
  const matches = { reused: 0, nearReused: 0, nearSkipped: 0, ambiguous: [] as AmbiguousGameMatch[] };

  for (const stage of stages) {
    const label = stage.scope === 'tables' ? 'season tables' : `${stage.seasonId} ${stage.scope}`;
    if (stopped) { skippedStages.push(label); continue; }
    let estimate: number;
    let stageGames: KaggleGame[] = [];
    let stageRows: KagglePlayerGame[] = [];
    if (stage.scope === 'tables') {
      estimate = estimateBytes(playerSeasons.length, teamSeasons.length + averages.length);
    } else {
      stageGames = stepGames(stage, [...writableGames.values()].filter((g) => g.seasonId === stage.seasonId));
      const ids = new Set(stageGames.map((g) => g.nbaGameId));
      stageRows = (writableRowsBySeason.get(stage.seasonId) ?? []).filter((r) => ids.has(r.nbaGameId));
      estimate = estimateBytes(stageRows.filter((r) => played(r) && !ambiguous.has(r.personId)).length, stageGames.length * 2);
    }
    const current = args.dryRun ? simulatedBytes : await databaseBytes(db);
    if (!guardAllows(current, estimate, args.capMb)) {
      log(`Storage guard: ${mb(current)} + ~${mb(estimate)} for ${label} would pass 85% of ${args.capMb} MB. Stopping.`);
      stopped = true;
      skippedStages.push(label);
      continue;
    }
    simulatedBytes += estimate;

    if (stage.scope === 'tables') {
      const n = args.dryRun
        ? { teamSeasons: teamSeasons.length, playerSeasons: playerSeasons.length, leagueAverages: averages.length }
        : await sql.begin((tx) => replaceSeasonTables(tx as unknown as Db, tableSeasons, { teamSeasons, playerSeasons, leagueAverages: averages }, { teamIdByFranchise, playerIdByPerson }));
      log(`Season tables ${args.dryRun ? 'would write' : 'written'}: ${n.teamSeasons} team, ${n.playerSeasons} player, ${n.leagueAverages} league rows`);
      perSeason.push({ stage: label, ...n, estimatedBytes: estimate });
      continue;
    }
    const ambiguousRows = stageRows.filter((r) => played(r) && ambiguous.has(r.personId)).length;
    if (args.dryRun) {
      // The same read-only matching a real run does.
      const decided = await classifyGames(db, stageGames, teamIdByFranchise);
      const count = (pred: (d: (typeof decided)[number]['decision']) => boolean) => decided.filter((c) => pred(c.decision)).length;
      const pendingIds = new Set(decided.filter((c) => c.decision.action !== 'skip').map((c) => c.game.nbaGameId));
      const playerRows = stageRows.filter((r) => pendingIds.has(r.nbaGameId) && played(r) && !ambiguous.has(r.personId)).length;
      const stageAmbiguous = decided.map(ambiguousMatchOf).filter((m): m is AmbiguousGameMatch => m !== null);
      const counts = {
        games: pendingIds.size, inserted: count((d) => d.action === 'insert'), updated: count((d) => d.action === 'update'),
        reused: count((d) => d.action === 'reuse' && !d.near), nearReused: count((d) => d.action === 'reuse' && d.near),
        skipped: count((d) => d.action === 'skip'), alreadyLoaded: count((d) => d.action === 'skip' && d.reason === 'has_box'),
        nearSkipped: count((d) => d.action === 'skip' && d.reason === 'has_box' && d.near),
      };
      matches.reused += counts.reused; matches.nearReused += counts.nearReused; matches.nearSkipped += counts.nearSkipped;
      matches.ambiguous.push(...stageAmbiguous);
      perSeason.push({ stage: label, ...counts, ambiguousMatches: stageAmbiguous, playerRows, teamRows: pendingIds.size * 2, ambiguousRows, estimatedBytes: estimate });
      log(`${label}: would write ${pendingIds.size} games (${counts.nearReused} day-off reuses), ${playerRows} player rows; ${counts.skipped} skipped, ${stageAmbiguous.length} ambiguous matches (~${mb(estimate)})`);
    } else {
      const res = await sql.begin((tx) => writeSeasonGames(tx as unknown as Db, stageGames, stageRows, { teamIdByFranchise, playerIdByPerson }));
      matches.reused += res.reused; matches.nearReused += res.nearReused; matches.nearSkipped += res.nearSkipped;
      matches.ambiguous.push(...res.ambiguousMatches);
      perSeason.push({ stage: label, ...res, estimatedBytes: estimate });
      log(`${label}: ${res.inserted} new, ${res.updated} updated, ${res.reused} reused, ${res.nearReused} day-off reused, ${res.skipped} skipped (${res.ambiguousMatches.length} ambiguous matches); ${res.playerRows} player rows, ${res.unmappedPlayerRows} skipped (ambiguous). Database ${mb(await databaseBytes(db))}`);
    }
  }

  // ── Records start, derived jobs, report ────────────────────────────────────
  const recordsStart = resolveRecordsStart(await loadCoverage(db), null);
  if (!args.dryRun && recordsStart !== null) await setBackfilledThrough(db, recordsStart);
  log(`history:backfilled_through ${args.dryRun ? 'would be' : 'set to'} ${recordsStart ?? '(none: no complete season; not written)'}`);

  const report = {
    generatedAt: new Date().toISOString(), dryRun: args.dryRun, dir: args.dir,
    args: { from: args.from, to: args.to, only: args.only, capMb: args.capMb },
    startBytes, estimatedBytes: simulatedBytes - startBytes, perSeason, skippedStages, stoppedByGuard: stopped,
    players: {
      referenced: referenced.size, matched: match.matched.size, toCreate: match.toCreate.length,
      created: playerWrites.created, backfilled: match.backfillNbaId.length, backfillApplied: playerWrites.backfilled,
      backfillsOntoLiveIdentities, ambiguousCount: match.ambiguous.length,
      ambiguous: match.ambiguous.map((a) => ({
        personId: a.person.personId, name: `${a.person.firstName} ${a.person.lastName}`.trim(),
        birthdate: a.person.birthdate, candidates: a.candidates,
      })),
    },
    gameMatches: matches, eraProblems: problems, eraTeamsMissing, recordMismatches, pointsVsScore,
    // Per season and stat: blank / zero / non-zero raw cells in played rows, before the era mask
    // (STAT_TRACKED_FROM_SEASON in kaggle.ts). Shows whether partly tracked seasons write 0 for "not recorded".
    rawCellsByEra: rawCells,
    rowErrors, rowsWithoutGame, recordsStart,
  };
  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
  log(`Players: ${match.matched.size} matched, ${match.toCreate.length} new, ${match.backfillNbaId.length} id backfills, ${match.ambiguous.length} ambiguous`);
  log(`W-L mismatches vs official Clippers records: ${recordMismatches.length}. Row errors: ${Object.entries(rowErrors).map(([f, e]) => `${f} ${e.count}`).join(', ')}`);
  log(`Existing rows: ${matches.reused} reused, ${matches.nearReused} reused a day off, ${matches.nearSkipped} day-off rows with box scores left alone, ${matches.ambiguous.length} ambiguous (skipped; see report)`);
  log(`Report: ${args.report}`);

  if (stopped) {
    log(`Stopped by the storage guard. Not loaded: ${skippedStages.join(', ')}. Derived jobs not run; raise --cap-mb or free space, then re-run.`);
  } else if (!args.dryRun && !args.skipDerived) {
    log('Computing derived stats and the record book…');
    tsx('scripts/compute-stats.ts');
    tsx('scripts/build-record-book.ts');
  }
  log(`${args.dryRun ? 'Dry run finished' : 'Finished'}. Database ${mb(await databaseBytes(db))}${args.dryRun ? `; estimated after import ~${mb(simulatedBytes)}` : ''}.`);
  await sql.end();
}

main().catch(async (err) => {
  console.error('[import-kaggle] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
