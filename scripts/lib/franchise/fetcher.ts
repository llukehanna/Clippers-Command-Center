// scripts/lib/franchise/fetcher.ts
// Paced, resumable downloader for the franchise-history raw cache. Every parser
// reads from this cache; nothing else touches the network.
import fs from 'node:fs';
import path from 'node:path';

export type SourceName = 'bbref' | 'wiki' | 'espn' | 'nba';
/** `title` is set for wiki specs: those are fetched in batches through the query API. */
export interface SourceSpec { source: SourceName; key: string; url: string; ext: 'html' | 'json'; title?: string }
export interface FetchDeps { fetch: typeof fetch; sleep(ms: number): Promise<void>; now(): number }
export interface Manifest { [key: string]: { url: string; status: number; fetchedAt: string; bytes: number } }

export const USER_AGENT = 'CCC-history-archive/1.0 (private, non-commercial)';
export const PACE_MS: Record<SourceName, number> = { bbref: 6000, wiki: 3000, espn: 1000, nba: 0 };

/** Absolute ceiling on BBRef requests in one run, whatever the caller asks for. */
export const HARD_BBREF_CAP = 300;

export const WIKI_BATCH = 50;

export function wikiQueryUrl(titles: string[]): string {
  return `https://en.wikipedia.org/w/api.php?action=query&prop=revisions&rvprop=content&rvslots=main&redirects=1&format=json&formatversion=2&titles=${titles.map(encodeURIComponent).join('%7C')}`;
}

export class FetchStopped extends Error {
  constructor(public readonly key: string, public readonly status: number, public readonly retryAfter?: string | null) {
    super(`stopped at ${key}: HTTP ${status}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`);
    this.name = 'FetchStopped';
  }
}

export function cachePath(dir: string, spec: SourceSpec): string {
  return path.join(dir, spec.source, `${spec.key}.${spec.ext}`);
}

export const manifestKey = (spec: SourceSpec) => `${spec.source}/${spec.key}`;

export function readManifest(dir: string): Manifest {
  try {
    return JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as Manifest;
  } catch {
    return {};
  }
}

function writeManifest(dir: string, m: Manifest) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'manifest.json');
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(m, null, 2));
  fs.renameSync(`${file}.tmp`, file);
}

export async function fetchAll(
  specs: SourceSpec[], dir: string, deps: FetchDeps,
  opts: { refresh: Set<string>; bbrefCap: number },
): Promise<{ fetched: number; skipped: number; stoppedAt?: string }> {
  const manifest = readManifest(dir);
  const bbrefCap = Math.min(opts.bbrefCap, HARD_BBREF_CAP);
  const lastAt: Partial<Record<SourceName, number>> = {};
  let fetched = 0, skipped = 0, bbrefRequests = 0;
  const wikiPending: SourceSpec[] = [];

  for (const spec of specs) {
    const mk = manifestKey(spec);
    const file = cachePath(dir, spec);
    const refresh = opts.refresh.has(spec.key) || opts.refresh.has(mk);
    if (!refresh && manifest[mk]?.status === 200 && fs.existsSync(file)) { skipped++; continue; }

    if (spec.source === 'wiki' && spec.title) { wikiPending.push(spec); continue; }

    if (spec.source === 'bbref') {
      if (bbrefRequests >= bbrefCap) { writeManifest(dir, manifest); return { fetched, skipped, stoppedAt: mk }; }
      bbrefRequests++;
    }

    const last = lastAt[spec.source];
    if (last !== undefined) {
      const wait = PACE_MS[spec.source] - (deps.now() - last);
      if (wait > 0) await deps.sleep(wait);
    }
    lastAt[spec.source] = deps.now();

    let status = 0;
    let retryAfter: string | null = null;
    let body = '';
    try {
      const res = await deps.fetch(spec.url, { headers: { 'User-Agent': USER_AGENT } });
      status = res.status;
      retryAfter = res.headers.get('retry-after');
      body = status === 200 ? await res.text() : '';
    } catch {
      status = 0;
    }
    lastAt[spec.source] = deps.now();

    manifest[mk] = { url: spec.url, status, fetchedAt: new Date(deps.now()).toISOString(), bytes: Buffer.byteLength(body) };
    if (status === 200) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, body);
      fetched++;
    }
    writeManifest(dir, manifest);
    if (status === 429 || (spec.source === 'bbref' && status !== 200)) throw new FetchStopped(mk, status, retryAfter);
  }

  for (let i = 0; i < wikiPending.length; i += WIKI_BATCH) {
    const batch = wikiPending.slice(i, i + WIKI_BATCH);
    const last = lastAt.wiki;
    if (last !== undefined) {
      const wait = PACE_MS.wiki - (deps.now() - last);
      if (wait > 0) await deps.sleep(wait);
    }
    lastAt.wiki = deps.now();
    const url = wikiQueryUrl(batch.map((b) => b.title!));
    let status = 0;
    let retryAfter: string | null = null;
    let json: WikiQuery | null = null;
    try {
      const res = await deps.fetch(url, { headers: { 'User-Agent': USER_AGENT } });
      status = res.status;
      retryAfter = res.headers.get('retry-after');
      if (status === 200) json = (await res.json()) as WikiQuery;
    } catch {
      status = 0;
      json = null;
    }
    lastAt.wiki = deps.now();
    const fetchedAt = new Date(deps.now()).toISOString();
    for (const spec of batch) {
      const mk = manifestKey(spec);
      let st = status;
      let body = '';
      if (st === 200 && json) {
        const resolved = resolveTitle(json, spec.title!);
        const page = json.query?.pages?.find((p) => p.title === resolved);
        const wikitext = page?.revisions?.[0]?.slots?.main?.content;
        if (!page || page.missing || page.invalid || typeof wikitext !== 'string') st = 404;
        else {
          body = JSON.stringify({ title: spec.title, resolvedTitle: resolved, wikitext });
          const file = cachePath(dir, spec);
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, body);
          fetched++;
        }
      } else if (st === 200) st = 0;
      manifest[mk] = { url, status: st, fetchedAt, bytes: Buffer.byteLength(body) };
    }
    writeManifest(dir, manifest);
    if (status === 429) throw new FetchStopped(manifestKey(batch[0]), 429, retryAfter);
  }
  writeManifest(dir, manifest);
  return { fetched, skipped };
}

interface WikiQuery {
  query?: {
    normalized?: Array<{ from: string; to: string }>;
    redirects?: Array<{ from: string; to: string }>;
    pages?: Array<{ title: string; missing?: boolean; invalid?: boolean; revisions?: Array<{ slots?: { main?: { content?: string } } }> }>;
  };
}

function resolveTitle(json: WikiQuery, requested: string): string {
  let t = requested;
  const n = json.query?.normalized?.find((x) => x.from === t);
  if (n) t = n.to;
  const r = json.query?.redirects?.find((x) => x.from === t);
  return r ? r.to : t;
}
