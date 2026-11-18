import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { cachePath, fetchAll, FetchStopped, HARD_BBREF_CAP, USER_AGENT, type FetchDeps, type Manifest, type SourceSpec } from './fetcher.js';

const bb = (key: string): SourceSpec => ({ source: 'bbref', key, url: `https://www.basketball-reference.com/${key}`, ext: 'html' });
const wk = (key: string): SourceSpec => ({ source: 'wiki', key, url: `https://en.wikipedia.org/${key}`, ext: 'json' });

let dir: string;
let t: number;
let sleeps: number[];
let calls: Array<{ url: string; headers: Record<string, string> }>;
let statusFor: (url: string) => number;

function deps(): FetchDeps {
  return {
    fetch: (async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
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
  it('paces wiki at 1000 ms and nba not at all', async () => {
    await fetchAll([wk('a'), wk('b')], dir, deps(), opts());
    expect(sleeps).toEqual([1000]);
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
    statusFor = () => 404;
    await fetchAll([wk('a')], dir, deps(), opts());
    expect(manifest()['wiki/a'].status).toBe(404);
    statusFor = () => 200;
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
