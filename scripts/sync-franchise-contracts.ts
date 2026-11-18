// scripts/sync-franchise-contracts.ts
// Weekly franchise contracts and current season (spec §3.5; the work is syncContracts in lib/franchise/sync-contracts.ts):
// two BBRef pages 6 s apart (/contracts/LAC.html and the current season's transactions page) plus the current Wikipedia
// season page. Replaces the contracts snapshot, upserts this season's salaries, fills pick parts on this season's
// incomplete Clippers trades, and lists the trades still incomplete and the possible duplicate people. Exits non-zero,
// writing nothing (the old contracts snapshot stays), on any non-200 or a contracts page whose shape changed. Unparsed
// lines or a changed transactions page skip only the trade fills (contracts and salaries are written) and exit
// non-zero; the season's transactions page answering 404 (not published yet, around July) skips them and exits 0.
//
// Run via: npm run sync-franchise-contracts
import fs from 'node:fs';
import { sql } from './lib/db.js';
import type { Db } from './lib/history/write.js';
import { FetchStopped } from './lib/franchise/fetcher.js';
import { FeedShapeError, syncContracts } from './lib/franchise/sync-contracts.js';

const log = (line: string) => console.log(`[sync-franchise-contracts] ${line}`);

/** The Actions run page's summary, when there is one. */
function summary(lines: string[]): void {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) fs.appendFileSync(file, `### Franchise contracts\n\n${lines.map((l) => `- ${l}`).join('\n')}\n`);
}

/** Why the run stopped, for the summary: nothing was written in any of these cases. */
function failure(e: unknown): string[] | null {
  const kept = 'nothing written; the old contracts snapshot stays';
  if (e instanceof FetchStopped) return [`fetch failed: ${e.key} answered HTTP ${e.status}${e.retryAfter ? ` (Retry-After: ${e.retryAfter})` : ''}; ${kept}`];
  if (e instanceof FeedShapeError) return [`page shape changed: ${e.message.replace(/; nothing written$/, '')}; ${kept}`];
  return null;
}

async function main() {
  try {
    const r = await syncContracts({
      fetch: globalThis.fetch, sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      db: sql as unknown as Db, now: () => new Date(), log,
    });
    const line = `season ${r.season}: contracts ${r.contracts}${r.contracts ? '' : ' (stored snapshot as new)'}; salaries ${r.salaries}; ` +
      `filled picks ${r.filledPicks}; still incomplete ${r.stillIncomplete.length}${r.skipped ? `; skipped rows ${r.skipped}` : ''}`;
    const skipped = r.fillsSkipped
      ? [`trade fills skipped (contracts and salaries written): ${r.fillsSkipped.detail}`,
        ...(r.fillsSkipped.lines ?? []).map((l) => `unparsed: ${l.source} ${l.date ?? '(no date)'}: ${l.text}`)]
      : [];
    const dups = r.possibleDuplicates.map((d) =>
      `possible duplicate person: contract player \`${d.personKey}\` (${d.name}) and \`${d.nbaKey}\`; not merged, the next import settles it`);
    log(line);
    for (const l of [...skipped, ...dups]) log(l);
    for (const k of r.stillIncomplete) log(`  still incomplete: ${k}`);
    summary([line, ...skipped, ...r.stillIncomplete.map((k) => `still incomplete (needs an override): \`${k}\``), ...dups]);
    // Not published yet is the season's normal start; unreadable lines or a changed page need a human.
    if (r.fillsSkipped && r.fillsSkipped.reason !== 'not_published') process.exitCode = 1;
  } catch (e) {
    const lines = failure(e);
    if (!lines) throw e;
    for (const l of lines) console.error(`[sync-franchise-contracts] ${l}`);
    summary(lines);
    process.exitCode = 1;
  }
  await sql.end();
}

main().catch(async (err) => {
  console.error('[sync-franchise-contracts] Failed:', err);
  try {
    summary([`failed: ${err instanceof Error ? err.message : String(err)}`]);
  } catch { /* the summary is best effort */ }
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
