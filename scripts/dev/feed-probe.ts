// scripts/dev/feed-probe.ts
// Live v2 spike (spec §10): during a live game, polls the NBA CDN and ESPN
// feeds once a second for --minutes, records caching headers, content hashes
// and the newest play's real-world time, writes NDJSON, and prints a summary.
// Throwaway tooling — run on a GitHub runner (.github/workflows/feed-probe.yml);
// the NBA CDN blocks some residential IPs.
//   npx tsx scripts/dev/feed-probe.ts [--minutes=20] [--nba-game=auto|0022600001] [--out=feed-probe.ndjson]

import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { formatSummary, summarizeProbe, type ProbeRecord } from '../lib/feed-probe-summary.js';

const NBA = 'https://cdn.nba.com/static/json/liveData';
const ESPN_SITE = 'https://site.api.espn.com/apis/site/v2/sports/basketball/nba';
const ESPN_CORE = 'https://sports.core.api.espn.com/v2/sports/basketball/leagues/nba';
const NBA_HEADERS: Record<string, string> = {
  Accept: 'application/json',
  Referer: 'https://www.nba.com/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};
// ESPN abbreviations that differ from NBA tricodes.
const ESPN_ALIAS: Record<string, string> = { GS: 'GSW', NY: 'NYK', SA: 'SAS', NO: 'NOP', UTAH: 'UTA', WSH: 'WAS', PHO: 'PHX' };

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || fallback;
const minutes = Number(arg('minutes', '20'));
const out = arg('out', 'feed-probe.ndjson');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Newest = (body: unknown) => number | null;
const none: Newest = () => null;
const maxTime = (times: Array<string | undefined>): number | null => {
  const ms = times.filter((t): t is string => Boolean(t)).map((t) => Date.parse(t)).filter(Number.isFinite);
  return ms.length ? Math.max(...ms) : null;
};
const nbaNewest: Newest = (b) => {
  const actions = (b as { game?: { actions?: Array<{ timeActual?: string }> } }).game?.actions ?? [];
  return maxTime(actions.slice(-5).map((a) => a.timeActual));
};
const espnSummaryNewest: Newest = (b) =>
  maxTime(((b as { plays?: Array<{ wallclock?: string }> }).plays ?? []).map((p) => p.wallclock));
const espnCoreNewest: Newest = (b) =>
  maxTime(((b as { items?: Array<{ wallclock?: string }> }).items ?? []).map((p) => p.wallclock));

async function probe(
  source: string,
  url: string,
  headers: Record<string, string>,
  newest: Newest,
  prevEtag: string | null = null
): Promise<{ record: ProbeRecord; body: unknown }> {
  const base = { source, conditional: Boolean(prevEtag) };
  try {
    const res = await fetch(url, {
      headers: prevEtag ? { ...headers, 'If-None-Match': prevEtag } : headers,
      cache: 'no-store',
    });
    const text = res.status === 200 ? await res.text() : '';
    let body: unknown = null;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
    const age = res.headers.get('age');
    return {
      body,
      record: {
        ...base,
        t: Date.now(),
        status: res.status,
        bytes: text.length,
        hash: text ? createHash('sha1').update(text).digest('hex') : null,
        cacheControl: res.headers.get('cache-control'),
        age: age === null ? null : Number(age),
        etag: res.headers.get('etag'),
        lastModified: res.headers.get('last-modified'),
        newestEventAt: body ? newest(body) : null,
      },
    };
  } catch {
    return {
      body: null,
      record: { ...base, t: Date.now(), status: 0, bytes: 0, hash: null, cacheControl: null, age: null, etag: null, lastModified: null, newestEventAt: null },
    };
  }
}

interface NbaSbGame { gameId: string; gameStatus: number; homeTeam: { teamTricode: string }; awayTeam: { teamTricode: string } }
interface EspnEvent { id: string; competitions: Array<{ competitors: Array<{ team: { abbreviation: string } }> }> }

async function discover(): Promise<{ nba: string; espn: string | null }> {
  const sbRes = await fetch(`${NBA}/scoreboard/todaysScoreboard_00.json`, { headers: NBA_HEADERS });
  if (!sbRes.ok) throw new Error(`NBA scoreboard ${sbRes.status}`);
  const games = ((await sbRes.json()) as { scoreboard: { games: NbaSbGame[] } }).scoreboard.games;
  const wanted = arg('nba-game', 'auto');
  const game = wanted === 'auto' ? games.find((g) => g.gameStatus === 2) : games.find((g) => g.gameId === wanted);
  if (!game) throw new Error(wanted === 'auto' ? 'No live game on the NBA scoreboard right now' : `Game ${wanted} not on today's scoreboard`);

  const tricodes = new Set([game.homeTeam.teamTricode, game.awayTeam.teamTricode]);
  const espnRes = await fetch(`${ESPN_SITE}/scoreboard`);
  const events = espnRes.ok ? ((await espnRes.json()) as { events?: EspnEvent[] }).events ?? [] : [];
  const match = events.find((e) =>
    e.competitions[0]?.competitors.every((c) => tricodes.has(ESPN_ALIAS[c.team.abbreviation] ?? c.team.abbreviation))
  );
  return { nba: game.gameId, espn: match?.id ?? null };
}

async function main(): Promise<void> {
  const { nba, espn } = await discover();
  console.log(`[feed-probe] NBA ${nba}, ESPN ${espn ?? 'not found'}; ${minutes} min at 1/s → ${out}`);
  writeFileSync(out, '');
  const records: ProbeRecord[] = [];
  let pbpEtag: string | null = null;
  let corePage = 1;
  const end = Date.now() + minutes * 60_000;

  while (Date.now() < end) {
    const started = Date.now();
    const results: Array<{ record: ProbeRecord; body: unknown }> = await Promise.all([
      probe('nba_pbp', `${NBA}/playbyplay/playbyplay_${nba}.json`, NBA_HEADERS, nbaNewest),
      probe('nba_pbp_conditional', `${NBA}/playbyplay/playbyplay_${nba}.json`, NBA_HEADERS, nbaNewest, pbpEtag),
      probe('nba_box', `${NBA}/boxscore/boxscore_${nba}.json`, NBA_HEADERS, none),
      probe('nba_scoreboard', `${NBA}/scoreboard/todaysScoreboard_00.json`, NBA_HEADERS, none),
      ...(espn
        ? [
            probe('espn_summary', `${ESPN_SITE}/summary?event=${espn}`, {}, espnSummaryNewest),
            probe('espn_core_status', `${ESPN_CORE}/events/${espn}/competitions/${espn}/status`, {}, none),
            probe('espn_core_plays', `${ESPN_CORE}/events/${espn}/competitions/${espn}/plays?limit=25&page=${corePage}`, {}, espnCoreNewest),
          ]
        : []),
    ]);
    for (const { record, body } of results) {
      records.push(record);
      appendFileSync(out, `${JSON.stringify(record)}\n`);
      if (record.source === 'nba_pbp' && record.etag) pbpEtag = record.etag;
      if (record.source === 'espn_core_plays' && body) {
        corePage = Math.max(1, (body as { pageCount?: number }).pageCount ?? corePage);
      }
    }
    await sleep(Math.max(0, 1000 - (Date.now() - started)));
  }
  console.log(formatSummary(summarizeProbe(records)));
}

main().catch((err) => {
  console.error('[feed-probe] Failed:', err);
  process.exit(1);
});
