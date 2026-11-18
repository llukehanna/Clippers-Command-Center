// scripts/lib/franchise/import-run.ts
// The import CLI's work (scripts/import-franchise-history.ts is the thin entry point): read Part 1's rows, build the
// dataset from the cache, write counterparties.json and the report, then, on a real run with the gates clear (or
// --allow-gaps), write everything in one transaction. Split out so the end-to-end test can drive it with its own
// database connection.
import fs from 'node:fs';
import path from 'node:path';
import type { Db } from '../history/write.js';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { buildDataset, defaultDraftYear, ONLY_TABLES, ONLY_VALUES, type BuiltDataset, type DbInput, type ImportChecks, type OnlyValue } from './build-dataset.js';
import type { PlayoffRecord } from './build-tables.js';
import type { TeamSeasonRow } from './lottery.js';
import type { DbPlayer } from './people.js';
import { gateFailures, summarizeReport } from './report.js';
import type { Override } from './types.js';
import { writeFranchise, type WriteResult } from './write.js';

const LAC = NBA_TEAM_IDS.LAC;

export interface ImportArgs {
  dryRun: boolean;
  only: OnlyValue | null;
  report: string;
  capMb: number;
  allowGaps: boolean;
  dir: string;
  /** Season start years. */
  from: number;
  to: number;
  currentDraftYear: number;
  /** Overrides to apply; default OVERRIDES (overrides.ts). Tests pass [] to exercise the pipeline alone. */
  overrides?: Override[];
}

export interface ImportOutcome {
  status: 'dry-run' | 'gates-failed' | 'written';
  gateFailures: string[];
  /** The console summary. */
  lines: string[];
  checks: ImportChecks;
  write?: WriteResult;
}

/** July on is the next season (as seasonOfDate and defaultDraftYear). */
function currentSeasonStart(now: Date): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

export function parseImportArgs(argv: string[], now = new Date()): ImportArgs {
  // Booleans take no value (`--dry-run=false` must never mean a real run); value flags need `=`.
  const booleans = ['dry-run', 'allow-gaps'];
  const values = ['only', 'report', 'cap-mb', 'dir', 'from', 'to'];
  for (const a of argv) {
    const m = /^--([a-z-]+)(=.*)?$/.exec(a);
    const name = m?.[1] ?? '';
    if (booleans.includes(name)) {
      if (m![2] !== undefined) throw new Error(`--${name} takes no value (got "${a}")`);
    } else if (values.includes(name)) {
      if (m![2] === undefined || m![2] === '=') throw new Error(`--${name} needs a value: --${name}=<value> (got "${a}")`);
    } else {
      throw new Error(`Unknown argument "${a}" (flags: ${[...booleans, ...values].map((k) => `--${k}`).join(' ')})`);
    }
  }
  const val = (name: string) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  const year = (name: string, dflt: number) => {
    const v = val(name);
    if (v === undefined) return dflt;
    if (!/^\d{4}$/.test(v)) throw new Error(`Invalid --${name}="${v}" (expected a 4-digit season start year)`);
    return Number(v);
  };
  const only = (val('only') ?? null) as OnlyValue | null;
  if (only !== null && !ONLY_VALUES.includes(only)) throw new Error(`Invalid --only="${only}" (${ONLY_VALUES.join('|')})`);
  const capMb = Number(val('cap-mb') ?? 512);
  if (!(capMb > 0)) throw new Error('--cap-mb must be a positive number');
  const from = year('from', 1970);
  const to = year('to', currentSeasonStart(now));
  if (from > to) throw new Error(`--from=${from} is after --to=${to}`);
  return {
    dryRun: argv.includes('--dry-run'), allowGaps: argv.includes('--allow-gaps'), only, capMb,
    report: val('report') ?? path.join('data', 'franchise-report.json'), dir: val('dir') ?? path.join('data', 'franchise-raw'),
    from, to, currentDraftYear: defaultDraftYear(now),
  };
}

/** Part 1's rows the import reads (R13: dates as text). Empty tables come back empty; the dry run says what that costs. */
export async function loadDbInput(db: Db): Promise<DbInput> {
  const players = await db<DbPlayer[]>`
    SELECT player_id::text, nba_person_id, display_name, birthdate::text AS birthdate FROM players`;
  const teamSeasons = await db<TeamSeasonRow[]>`
    SELECT season_id, nba_franchise_id, wins, losses, playoff_round FROM team_seasons`;
  const counts = await db<{ season_id: number; n: number }[]>`
    SELECT season_id, count(DISTINCT nba_person_id)::int AS n FROM player_seasons
    WHERE nba_franchise_id = ${LAC} AND games > 0 GROUP BY season_id`;
  // Playoff finals only (the play-in, NBA ids 005YY…, is not the playoffs).
  const playoffs = await db<{ season_id: number; wins: number; losses: number }[]>`
    SELECT g.season_id,
           count(*) FILTER (WHERE (g.home_team_id = t.team_id) = (g.home_score > g.away_score))::int AS wins,
           count(*) FILTER (WHERE (g.home_team_id = t.team_id) <> (g.home_score > g.away_score))::int AS losses
    FROM games g JOIN teams t ON t.nba_team_id = ${LAC} AND t.team_id IN (g.home_team_id, g.away_team_id)
    WHERE g.is_playoffs AND g.status = 'final' AND g.season_id IS NOT NULL
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL AND g.home_score <> g.away_score
      AND g.nba_game_id NOT BETWEEN 50000000 AND 59999999
    GROUP BY g.season_id`;
  return {
    players,
    teamSeasons: teamSeasons.map((t) => ({ ...t, season_id: Number(t.season_id), nba_franchise_id: Number(t.nba_franchise_id) })),
    playersBySeason: new Map(counts.map((c) => [Number(c.season_id), c.n])),
    playoffs: new Map<number, PlayoffRecord>(playoffs.map((p) => [Number(p.season_id), { wins: p.wins, losses: p.losses }])),
  };
}

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);
const fmt = (r: Record<string, number>) => Object.entries(r).map(([k, v]) => `${k} ${v}`).join(', ') || 'none';

function summary(args: ImportArgs, built: BuiltDataset, reportPath: string, cpPath: string): string[] {
  const c = built.checks;
  const out = [
    `${args.dryRun ? 'DRY RUN (no database writes). ' : ''}cache ${args.dir}; seasons ${args.from}–${args.to}; covered ${c.coveredSeasons.length}` +
      (c.coveredSeasons.length ? ` (${c.coveredSeasons[0]}–${c.coveredSeasons.at(-1)})` : '') +
      (args.only ? `; --only=${args.only}: writes ${ONLY_TABLES[args.only]}` : ''),
    ...summarizeReport(built.report),
    `NBA.com <-> BBRef merged moves: ${c.nbaBbrefMerged}`,
  ];
  if (c.unmergedSignings.length) {
    out.push(
      `WARNING: ${c.unmergedSignings.length} Clippers signings/waivers from 2015-16 on appear from BOTH NBA.com and BBRef unmerged. ` +
        'The players table probably lacks their NBA.com ids: run Part 1\'s import first.',
      ...c.unmergedSignings.slice(0, 5).map((u) => `  ${u.date} ${u.name}: ${u.nba} / ${u.bbref}`),
    );
  }
  for (const d of c.degraded) out.push(`NOTE: ${d}`);
  for (const u of c.uncoveredSeasons) out.push(`NOTE: ${u}`);
  if (c.draftPagesSkipped.length) out.push(`draft pages skipped (redirects): ${c.draftPagesSkipped.join(', ')}`);
  if (c.lotteryFailedYears.length) out.push(`lottery sections unreadable: ${c.lotteryFailedYears.join(', ')}`);
  if (c.contractDuplicates.length) out.push(`contracts listed twice (first kept): ${c.contractDuplicates.join(', ')}`);
  if (c.coachStintMismatches.length) out.push(`coach stints not matching season rows: ${c.coachStintMismatches.length} (see report)`);
  if (c.execPartialDates.length) out.push(`executive dates not a full date (written null): ${c.execPartialDates.length}`);
  out.push(
    `counterparty pages: ${c.counterparties.listed} listed -> ${cpPath} (${c.counterparties.read} cached and read, ` +
      `${c.counterparties.moves} league trades)`,
    `report: ${reportPath}`,
  );
  return out;
}

export async function runImport(db: Db, args: ImportArgs, log: (line: string) => void = (l) => console.log(`[import-franchise] ${l}`)): Promise<ImportOutcome> {
  const input = await loadDbInput(db);
  const built = buildDataset(args.dir, input, { from: args.from, to: args.to, only: args.only, currentDraftYear: args.currentDraftYear, overrides: args.overrides });

  const cpPath = path.join(args.dir, 'counterparties.json');
  fs.writeFileSync(cpPath, `${JSON.stringify(built.counterparties, null, 2)}\n`);
  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, `${JSON.stringify({ ...built.report, import: built.checks }, null, 1)}\n`);

  const lines = summary(args, built, args.report, cpPath);
  const gates = gateFailures(built.report);
  const done = (status: ImportOutcome['status'], write?: WriteResult): ImportOutcome => {
    for (const l of lines) log(l);
    return { status, gateFailures: gates, lines, checks: built.checks, ...(write ? { write } : {}) };
  };
  if (args.dryRun) return done('dry-run');
  if (gates.length && !args.allowGaps) {
    lines.push(`Nothing written: gates failing (${gates.join('; ')}). Settle them with overrides, or pass --allow-gaps.`);
    return done('gates-failed');
  }

  const write = await writeFranchise(db, built.data, { kind: 'import', ...built.checks.writeScope }, { capMb: args.capMb });
  const skipped: Record<string, number> = {};
  for (const s of write.skipped) skipped[s.table] = (skipped[s.table] ?? 0) + 1;
  lines.push(
    `written: inserted ${sum(write.inserted)} (${fmt(write.inserted)}); updated ${sum(write.updated)} (${fmt(write.updated)}); ` +
      `deleted ${sum(write.deleted)} (${fmt(write.deleted)}); people merged ${write.merged}`,
    `skipped writer rows: ${write.skipped.length} (${fmt(skipped)})`,
  );
  fs.writeFileSync(args.report, `${JSON.stringify({ ...built.report, import: built.checks, write }, null, 1)}\n`);
  return done('written', write);
}
