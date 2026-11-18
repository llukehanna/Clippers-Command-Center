// scripts/sync-franchise-moves.ts
// Nightly franchise moves (spec §3.5; the work is syncMoves in lib/franchise/sync-moves.ts): NBA.com's movement feed,
// or ESPN's Clippers transactions when NBA.com fails or takes 20 s, from app_kv 'franchise:moves_synced_through' minus
// 3 days. Prints the source used and whether the key moved (only NBA.com nights move it). Exits non-zero, writing
// nothing, on any line no parser or override reads.
//
// Run via: npm run sync-franchise-moves
import fs from 'node:fs';
import { sql } from './lib/db.js';
import type { Db } from './lib/history/write.js';
import { USER_AGENT } from './lib/franchise/fetcher.js';
import { ESPN_TRANSACTIONS_URL, NBA_MOVEMENT } from './lib/franchise/sources.js';
import { NBA_TIMEOUT_MS, syncMoves, UnparsedMovesError } from './lib/franchise/sync-moves.js';

const log = (line: string) => console.log(`[sync-franchise-moves] ${line}`);

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(NBA_TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  return res.json();
}

/** The Actions run page's summary, when there is one. */
function summary(lines: string[]): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, `### Franchise moves\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

async function main() {
  try {
    const r = await syncMoves({
      fetchNba: () => getJson(NBA_MOVEMENT.url), fetchEspn: () => getJson(ESPN_TRANSACTIONS_URL),
      db: sql as unknown as Db, now: () => new Date(), log,
    });
    const key = r.advanced ? `synced through ${r.syncedThrough} (advanced)`
      : `synced through ${r.syncedThrough ?? 'none'} (unchanged${r.source === 'espn' ? ': ESPN nights never move it' : ''})`;
    const line = `source: ${r.source}; written: ${r.written}; incomplete: ${r.incomplete.length}; ${key}`;
    const nba = r.nbaError ? `NBA.com failed: ${r.nbaError}` : null;
    const unmatched = r.unmatched.length
      ? `possible duplicates: ${r.unmatched.length} ESPN move(s) name a person no person_xref key resolved, so NBA.com's report can't adopt them`
      : null;
    log(line);
    for (const k of r.incomplete) log(`  incomplete: ${k}`);
    if (unmatched) log(unmatched);
    for (const k of r.unmatched) log(`  unmatched: ${k}`);
    summary([
      line, ...(nba ? [nba] : []), ...r.incomplete.map((k) => `incomplete: \`${k}\``),
      ...(unmatched ? [unmatched, ...r.unmatched.map((k) => `unmatched: \`${k}\``)] : []),
    ]);
  } catch (e) {
    if (!(e instanceof UnparsedMovesError)) throw e;
    console.error(`[sync-franchise-moves] source: ${e.source}; ${e.message}`);
    summary([
      `source: ${e.source}; nothing written: ${e.lines.length} unparsed line(s)`, ...(e.nbaError ? [`NBA.com failed: ${e.nbaError}`] : []),
      ...e.lines.map((l) => `${l.date ?? '(no date)'} ${l.text}`),
    ]);
    process.exitCode = 1;
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error('[sync-franchise-moves] Failed:', err);
  try {
    summary([`failed: ${err instanceof Error ? err.message : String(err)}`]);
  } catch { /* the summary is best effort */ }
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
