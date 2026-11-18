// scripts/sync-franchise-contracts.ts
// Weekly franchise contracts and current season (spec §3.5; the work is syncContracts in lib/franchise/sync-contracts.ts):
// two BBRef pages 6 s apart (/contracts/LAC.html and the current season's transactions page) plus the current Wikipedia
// season page. Replaces the contracts snapshot, upserts this season's salaries, fills pick parts on this season's
// incomplete Clippers trades, and lists the trades still incomplete. Exits non-zero, writing nothing (the old contracts
// snapshot stays), on any non-200, a page whose shape changed, or a line no parser or override reads.
//
// Run via: npm run sync-franchise-contracts
import fs from 'node:fs';
import { sql } from './lib/db.js';
import type { Db } from './lib/history/write.js';
import { FetchStopped } from './lib/franchise/fetcher.js';
import { FeedShapeError, syncContracts, UnparsedLinesError } from './lib/franchise/sync-contracts.js';

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
  if (e instanceof UnparsedLinesError) {
    return [`${e.lines.length} unparsed line(s); ${kept}. Settle them with an override in overrides.ts`,
      ...e.lines.map((l) => `${l.source} ${l.date ?? '(no date)'}: ${l.text}`)];
  }
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
    log(line);
    for (const k of r.stillIncomplete) log(`  still incomplete: ${k}`);
    summary([line, ...r.stillIncomplete.map((k) => `still incomplete (needs an override): \`${k}\``)]);
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
