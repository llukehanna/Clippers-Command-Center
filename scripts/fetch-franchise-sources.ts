// scripts/fetch-franchise-sources.ts
// Paced, resumable download of the franchise-history raw cache (Basketball-Reference,
// Wikipedia, ESPN, NBA.com). Run LOCALLY; nothing here touches the database.
//
// Flags:
//   --only=bbref|wiki|espn|nba|wiki-counterparties   one source (default: all but wiki-counterparties)
//   --from=, --to=      season START years (default 1970 .. current season)
//   --refresh=<key>     re-download a key even if cached (repeatable; "bbref/draft" or "draft")
//   --dir=<path>        cache folder (default data/franchise-raw)
//   --bbref-cap=<n>     max Basketball-Reference requests this run (default 150)
//
// A non-200 from Basketball-Reference stops the run (manifest is written first); re-run later to resume.
// Run via: npm run fetch-franchise-sources -- --only=nba
import fs from 'node:fs';
import path from 'node:path';
import { fetchAll, FetchStopped, HARD_BBREF_CAP, type FetchDeps, type SourceSpec } from './lib/franchise/fetcher.js';
import { bbrefSources, espnDraftSources, NBA_MOVEMENT, wikiCounterpartySources, wikiSources } from './lib/franchise/sources.js';

const log = (msg: string) => console.log(`[fetch-franchise] ${msg}`);
const ONLY = ['bbref', 'wiki', 'espn', 'nba', 'wiki-counterparties'] as const;
type Only = (typeof ONLY)[number];

function currentSeasonStart(now = new Date()): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

function parseArgs(argv: string[]) {
  const vals = (name: string) => argv.filter((a) => a.startsWith(`--${name}=`)).map((a) => a.slice(name.length + 3));
  const val = (name: string) => vals(name)[0];
  const year = (name: string, dflt: number) => {
    const v = val(name);
    if (v === undefined) return dflt;
    if (!/^\d{4}$/.test(v)) throw new Error(`Invalid --${name}="${v}" (expected a 4-digit season start year)`);
    return Number(v);
  };
  const only = (val('only') ?? null) as Only | null;
  if (only !== null && !ONLY.includes(only)) throw new Error(`Invalid --only="${only}" (${ONLY.join('|')})`);
  const bbrefCap = Number(val('bbref-cap') ?? 150);
  if (!(bbrefCap > 0) || bbrefCap > HARD_BBREF_CAP) throw new Error(`--bbref-cap must be between 1 and ${HARD_BBREF_CAP}`);
  return {
    only, from: year('from', 1970), to: year('to', currentSeasonStart()), bbrefCap,
    dir: val('dir') ?? path.join('data', 'franchise-raw'), refresh: new Set(vals('refresh')),
  };
}

function counterpartyPages(dir: string): string[] {
  const file = path.join(dir, 'counterparties.json');
  if (!fs.existsSync(file)) throw new Error(`${file} not found (written by the counterparty-discovery step)`);
  const pages = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!Array.isArray(pages) || !pages.every((p) => typeof p === 'string')) throw new Error(`${file} must be a JSON array of page titles`);
  return pages;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { only, from, to } = args;
  const future = Array.from({ length: 7 }, (_, i) => to + 1 + i);
  const specs: SourceSpec[] = [];
  if (!only || only === 'nba') specs.push(NBA_MOVEMENT);
  if (!only || only === 'espn') specs.push(...espnDraftSources(from, to));
  if (!only || only === 'wiki') specs.push(...wikiSources(from, to, future));
  if (!only || only === 'bbref') specs.push(...bbrefSources(from, to));
  if (only === 'wiki-counterparties') specs.push(...wikiCounterpartySources(counterpartyPages(args.dir)));

  const deps: FetchDeps = { fetch, sleep: (ms) => new Promise((r) => setTimeout(r, ms)), now: () => Date.now() };
  log(`${specs.length} sources -> ${args.dir}`);
  try {
    const r = await fetchAll(specs, args.dir, deps, { refresh: args.refresh, bbrefCap: args.bbrefCap });
    log(`fetched ${r.fetched}, skipped ${r.skipped}${r.stoppedAt ? `, stopped at ${r.stoppedAt} (bbref cap)` : ''}`);
  } catch (err) {
    if (err instanceof FetchStopped) {
      log(`STOPPED: ${err.message}. Manifest saved; re-run later to resume.`);
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
