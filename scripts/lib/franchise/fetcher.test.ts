import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cachePath, fetchAll, FetchStopped, HARD_BBREF_CAP, USER_AGENT, type FetchDeps, type Manifest, type SourceSpec } from './fetcher.js';

const bb = (key: string): SourceSpec => ({ source: 'bbref', key, url: `https://www.basketball-reference.com/${key}`, ext: 'html' });
const wk = (key: string): SourceSpec => ({ source: 'wiki', key, title: key.replace(/_/g, ' '), url: `https://en.wikipedia.org/${key}`, ext: 'json' });
const wks = (n: number) => Array.from({ length: n }, (_, i) => wk(`Page_${i}`));
let redirects: Record<string, string>;
let missing: Set<string>;
let wikiCalls: string[][];

let dir: string;
let t: number;
let sleeps: number[];
let calls: Array<{ url: string; headers: Record<string, string> }>;
let statusFor: (url: string) => number;
let wikiStatus: (n: number) => number;
let retryAfter: string | null;

function deps(): FetchDeps {
  return {
    fetch: (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
      if (url.startsWith('https://en.wikipedia.org/w/api.php')) {
        const titles = (new URL(url).searchParams.get('titles') ?? '').split('|');
        wikiCalls.push(titles);
        const st = wikiStatus(wikiCalls.length);
        if (st !== 200) return new Response('nope', { status: st, headers: retryAfter ? { 'Retry-After': retryAfter } : {} });
        const redirs = titles.filter((x) => redirects[x]).map((x) => ({ from: x, to: redirects[x] }));
        const pages = titles.map((x) => redirects[x] ?? x).map((x) => (missing.has(x)
          ? { title: x, missing: true }
          : { title: x, revisions: [{ slots: { main: { content: `text of ${x}` } } }] }));
        return Response.json({ query: { redirects: redirs, pages } });
      }
      const status = statusFor(url);
      return new Response(status === 200 ? `body:${url}` : 'nope', { status });
    }) as unknown as typeof fetch,
    sleep: async (ms) => { sleeps.push(ms); t += ms; },
    now: () => t,
  };
}
const opts = (o: Partial<{ refresh: Set<string>; bbrefCap: number }> = {}) => ({ refresh: new Set<string>(), bbrefCap: 100, ...o });
const manifest = (): Manifest => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'franchise-fetch-'));
  t = 1_000_000; sleeps = []; calls = []; statusFor = () => 200;
  wikiStatus = () => 200; retryAfter = null; redirects = {}; missing = new Set(); wikiCalls = [];
});

describe('fetchAll', () => {
  it('writes files, manifest entries and paces bbref at 6000 ms', async () => {
    const specs = [bb('a'), bb('b'), bb('c')];
    const r = await fetchAll(specs, dir, deps(), opts());
    expect(r).toEqual({ fetched: 3, skipped: 0 });
    expect(fs.readFileSync(cachePath(dir, specs[0]), 'utf8')).toBe(`body:${specs[0].url}`);
    expect(manifest()['bbref/a'].status).toBe(200);
    expect(manifest()['bbref/a'].bytes).toBeGreaterThan(0);
    expect(sleeps.filter((s) => s > 0).length).toBe(2);
    expect(sleeps.every((s) => s >= 6000)).toBe(true);
  });
  it('paces wiki at 3000 ms and nba not at all', async () => {
    await fetchAll(wks(60), dir, deps(), opts());
    expect(sleeps).toEqual([3000]);
    sleeps = [];
    const nba = (k: string): SourceSpec => ({ source: 'nba', key: k, url: `https://x/${k}`, ext: 'json' });
    await fetchAll([nba('a'), nba('b')], dir, deps(), opts());
    expect(sleeps).toEqual([]);
  });
  it('stops the whole run on a 429 and records it in the manifest', async () => {
    statusFor = (u) => (u.endsWith('/b') ? 429 : 200);
    await expect(fetchAll([bb('a'), bb('b'), bb('c')], dir, deps(), opts())).rejects.toBeInstanceOf(FetchStopped);
    expect(manifest()['bbref/b'].status).toBe(429);
    expect(calls.length).toBe(2);
    expect(fs.existsSync(cachePath(dir, bb('b')))).toBe(false);
  });
  it('stops the whole run on a wiki 429 and reports Retry-After', async () => {
    wikiStatus = (n) => (n === 2 ? 429 : 200);
    retryAfter = '120';
    const err = await fetchAll(wks(120), dir, deps(), opts()).catch((e) => e);
    expect(err).toBeInstanceOf(FetchStopped);
    expect(err.message).toContain('Retry-After: 120');
    expect(wikiCalls.length).toBe(2);
    expect(manifest()['wiki/Page_50'].status).toBe(429);
    expect(manifest()['wiki/Page_0'].status).toBe(200);
  });
  it('waits at least 3000 ms between wiki requests', async () => {
    await fetchAll(wks(120), dir, deps(), opts());
    expect(sleeps.length).toBe(2);
    expect(sleeps.every((s) => s >= 3000)).toBe(true);
  });
  it('fetches wiki titles in batches of at most 50', async () => {
    const r = await fetchAll(wks(120), dir, deps(), opts());
    expect(wikiCalls.map((c) => c.length)).toEqual([50, 50, 20]);
    expect(r.fetched).toBe(120);
  });
  it('writes one cache file per title with wikitext', async () => {
    await fetchAll([wk('Boston_Celtics')], dir, deps(), opts());
    const f = JSON.parse(fs.readFileSync(cachePath(dir, wk('Boston_Celtics')), 'utf8'));
    expect(f).toEqual({ title: 'Boston Celtics', resolvedTitle: 'Boston Celtics', wikitext: 'text of Boston Celtics' });
  });
  it('maps a redirected title to its requested key', async () => {
    redirects = { 'Old Name': 'New Name' };
    await fetchAll([wk('Old_Name')], dir, deps(), opts());
    const f = JSON.parse(fs.readFileSync(cachePath(dir, wk('Old_Name')), 'utf8'));
    expect(f).toEqual({ title: 'Old Name', resolvedTitle: 'New Name', wikitext: 'text of New Name' });
    expect(manifest()['wiki/Old_Name'].status).toBe(200);
  });
  it('records a missing page as 404 without stopping', async () => {
    missing = new Set(['Gone']);
    const r = await fetchAll([wk('Gone'), wk('Here')], dir, deps(), opts());
    expect(r.fetched).toBe(1);
    expect(manifest()['wiki/Gone'].status).toBe(404);
    expect(fs.existsSync(cachePath(dir, wk('Gone')))).toBe(false);
    expect(manifest()['wiki/Here'].status).toBe(200);
  });
  it('only requests wiki titles not already cached', async () => {
    await fetchAll(wks(3), dir, deps(), opts());
    wikiCalls = [];
    await fetchAll([...wks(3), wk('New_One')], dir, deps(), opts());
    expect(wikiCalls).toEqual([['New One']]);
  });
  it('skips keys already fetched with status 200 unless refreshed', async () => {
    const specs = [bb('a'), bb('b')];
    await fetchAll(specs, dir, deps(), opts());
    calls = [];
    expect(await fetchAll(specs, dir, deps(), opts())).toEqual({ fetched: 0, skipped: 2 });
    expect(calls.length).toBe(0);
    expect(await fetchAll(specs, dir, deps(), opts({ refresh: new Set(['b']) }))).toEqual({ fetched: 1, skipped: 1 });
    expect(calls.map((c) => c.url)).toEqual([specs[1].url]);
  });
  it('retries entries whose last status was not 200', async () => {
    wikiStatus = () => 404;
    await fetchAll([wk('a')], dir, deps(), opts());
    expect(manifest()['wiki/a'].status).toBe(404);
    wikiStatus = () => 200;
    expect((await fetchAll([wk('a')], dir, deps(), opts())).fetched).toBe(1);
  });
  it('refuses to make more than bbrefCap bbref requests', async () => {
    const r = await fetchAll([bb('a'), bb('b'), bb('c')], dir, deps(), opts({ bbrefCap: 2 }));
    expect(calls.length).toBe(2);
    expect(r).toEqual({ fetched: 2, skipped: 0, stoppedAt: 'bbref/c' });
  });
  it('enforces the hard cap even when bbrefCap is larger', async () => {
    const specs = Array.from({ length: 320 }, (_, i) => bb(`k${i}`));
    const r = await fetchAll(specs, dir, deps(), opts({ bbrefCap: 1000 }));
    expect(HARD_BBREF_CAP).toBe(300);
    expect(calls.length).toBe(300);
    expect(r).toEqual({ fetched: 300, skipped: 0, stoppedAt: 'bbref/k300' });
  });
  it('sends the descriptive User-Agent and nothing spoofed', async () => {
    await fetchAll([bb('a')], dir, deps(), opts());
    expect(USER_AGENT).toBe('CCC-history-archive/1.0 (private, non-commercial)');
    expect(calls[0].headers).toEqual({ 'User-Agent': USER_AGENT });
  });
});
