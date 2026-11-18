// scripts/import-franchise-history.ts
// Franchise transaction history import (spec §3): reads ONLY the raw cache written by fetch-franchise-sources, builds
// every Part 3 table, and writes them in one transaction. Run LOCALLY.
//
// Flags:
//   --dry-run            write nothing; still writes the report and counterparties.json
//   --only=draft|trades|moves|salaries|people|honors
//                        write only some tables (ONLY_TABLES in lib/franchise/build-dataset.ts); a partial run never
//                        deletes rows another part owns
//   --report=<path>      report file (default data/franchise-report.json)
//   --cap-mb=<n>         storage cap for the guard (default 512; stops at 85%)
//   --allow-gaps         write even while the gates fail (unparsed lines, future picks without known protections)
//   --dir=<path>         cache folder (default data/franchise-raw)
//   --from=, --to=       season start years (default 1970 .. current season)
//
// It also writes <dir>/counterparties.json: the other teams' Wikipedia season pages trade trees need before 2015-16,
// for `npm run fetch-franchise-sources -- --only=wiki-counterparties`.
// Order of real runs: Part 1's import first (players, team_seasons); the dry run says what's degraded without it.
//
// Run via: npm run import-franchise-history -- --dry-run
import { sql } from './lib/db.js';
import type { Db } from './lib/history/write.js';
import { parseImportArgs, runImport } from './lib/franchise/import-run.js';

async function main() {
  const args = parseImportArgs(process.argv.slice(2));
  const out = await runImport(sql as unknown as Db, args);
  if (out.status === 'gates-failed') process.exitCode = 1;
  await sql.end();
}

main().catch(async (err) => {
  console.error('[import-franchise] Failed:', err);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
