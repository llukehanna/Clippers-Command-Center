// scripts/dev/live-dry-run.ts
// Runs the Live v2 poller against a real game with no database and prints
// every save: phase, delay, seq, score and state size. Use with the feed probe
// (.github/workflows/feed-probe.yml) to check the cadence on a real game.
//   npx tsx scripts/dev/live-dry-run.ts [--nba-game=auto|0022600001] [--minutes=20] [--publish]
//   npx tsx scripts/dev/live-dry-run.ts --espn=DET@PHI [--date=2026-11-04] [--minutes=20]
// --publish also pushes each save to LIVE_HUB_URL (if set) — pushes any live
// NBA game to the hub during preseason, independent of Clippers game-night.
// --espn polls ESPN (the runner's fallback since cdn.nba.com liveData went
// 403) for that matchup on that US Eastern date (default today); with
// DATABASE_URL set, players are mapped to NBA ids as the runner does. Each save
// also prints on-court counts, box players and the newest play.

import {
  fetchBoxscoreConditional,
  fetchPlayByPlayConditional,
  fetchScoreboard,
} from '../lib/nba-live-client.js';
import { createPoller, type PollerDeps } from '../lib/live-poller.js';
import { hubPublisherFromEnv } from '../lib/live-publish.js';
import { espnFeedsWith, loadPersonIdResolver } from '../lib/live-deps.js';
import { nameResolver } from '../lib/espn-live-client.js';
import type { LiveStateDoc } from '../../src/lib/types/live-state.js';

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || fallback;
const flag = (name: string): boolean => process.argv.includes(`--${name}`);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const etToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

async function espnSetup(matchup: string): Promise<{ feeds: Pick<PollerDeps, 'fetchScoreboard' | 'fetchPbp' | 'fetchBox'>; end: () => Promise<void> }> {
  const [awayTricode, homeTricode] = matchup.toUpperCase().split('@');
  if (!awayTricode || !homeTricode) throw new Error('--espn wants AWAY@HOME, e.g. DET@PHI');
  const gameDate = arg('date', etToday());
  let end = async () => {};
  let resolve = nameResolver(new Map());
  if (process.env.DATABASE_URL) {
    const { sql } = await import('../lib/db.js');
    resolve = await loadPersonIdResolver(sql);
    end = async () => { await sql.end({ timeout: 5 }); };
  } else {
    console.log('[dry-run] No DATABASE_URL: players keep ESPN ids (negative).');
  }
  console.log(`[dry-run] ESPN ${awayTricode} @ ${homeTricode} on ${gameDate}`);
  return { feeds: espnFeedsWith(async () => ({ homeTricode, awayTricode, gameDate, resolve }), '0'), end };
}

function detail(d: LiveStateDoc): string {
  const on = d.lineups ? `${d.lineups.on_court.lac.length}/${d.lineups.on_court.opp.length}` : '—';
  const players = `${d.home_box?.players.length ?? 0}/${d.away_box?.players.length ?? 0}`;
  const unmatched = [...(d.home_box?.players ?? []), ...(d.away_box?.players ?? [])].filter((p) => p.personId < 0).length;
  const play = d.last_plays[0];
  return `on-court ${on} players ${players} unmatched ${unmatched} plays ${d.last_plays.length} ` +
    `flow ${d.flow?.points.length ?? '—'} wp ${d.wp?.lac ?? "—"} last: ${play ? `${play.clock} ${play.action_type} ${play.description}` : '—'}`;
}

async function main(): Promise<void> {
  const espn = arg('espn', '');
  if (espn) return espnRun(espn);
  let gameId = arg('nba-game', 'auto');
  if (gameId === 'auto') {
    const games = (await fetchScoreboard()).scoreboard.games;
    const g = games.find((x) => x.gameStatus === 2) ?? games.find((x) => x.gameStatus === 1);
    if (!g) {
      console.log('[dry-run] No game on today\'s scoreboard.');
      return;
    }
    gameId = g.gameId;
  }
  const end = Date.now() + Number(arg('minutes', '20')) * 60_000;
  const hub = flag('publish') ? hubPublisherFromEnv(gameId) : null;
  const poller = createPoller(gameId, null, {
    fetchScoreboard,
    fetchPbp: fetchPlayByPlayConditional,
    fetchBox: fetchBoxscoreConditional,
    saveState: async (d) => {
      console.log(
        `[dry-run] ${new Date().toISOString()} seq ${d.seq} ${d.cadence.phase} next ${d.cadence.next_ms}ms ` +
          `Q${d.period} ${d.clock} ${d.away_score}-${d.home_score} observed ${d.observed_at ?? '—'} ` +
          `${JSON.stringify(d).length} bytes`
      );
      if (hub) {
        const ok = await hub.publish(d);
        console.log(`[dry-run] publish ${ok ? 'ok' : 'failed'}`);
      }
    },
    saveMoment: async (d, reason) => console.log(`[dry-run] moment ${reason} seq ${d.seq}`),
    now: Date.now,
    log: (m) => console.log(`[dry-run] ${m}`),
  });
  while (Date.now() < end) {
    const r = await poller.tick();
    if (r.final) break;
    await sleep(r.delayMs);
  }
  if (hub) {
    console.log('[dry-run] flushing hub…');
    await Promise.race([hub.flush(), sleep(5_000)]);
    console.log('[dry-run] hub flushed');
  }
}

/** Poll one ESPN game through the real poller and report problems at the end. */
async function espnRun(matchup: string): Promise<void> {
  const { feeds, end: close } = await espnSetup(matchup);
  const end = Date.now() + Number(arg('minutes', '20')) * 60_000;
  const problems = new Set<string>();
  let saves = 0;
  const poller = createPoller('0', null, {
    ...feeds,
    saveState: async (d) => {
      saves++;
      console.log(`[dry-run] ${new Date().toISOString()} seq ${d.seq} ${d.cadence.phase} next ${d.cadence.next_ms}ms ` +
        `${d.status} Q${d.period} ${d.clock} ${d.away_score}-${d.home_score} ${detail(d)}`);
      if (d.status === 'in_progress') {
        if (!d.home_box || !d.away_box) problems.add('live doc without a box score');
        if (d.lineups && (d.lineups.on_court.lac.length !== 5 || d.lineups.on_court.opp.length !== 5)) {
          problems.add(`on-court not 5/5 (${d.lineups.on_court.lac.length}/${d.lineups.on_court.opp.length}) at Q${d.period} ${d.clock}`);
        }
        if (!d.lineups) problems.add('live doc without lineups');
        if (!d.flow) problems.add('live doc without flow');
        if (d.clock === '0:00' && d.period === 0) problems.add('in progress with no period/clock');
      }
    },
    saveMoment: async (d, reason) => console.log(`[dry-run] moment ${reason} seq ${d.seq}`),
    now: Date.now,
    log: (m) => { console.log(`[dry-run] ${m}`); problems.add(m.replace(/\(\d+x\)/, '')); },
  });
  while (Date.now() < end) {
    const r = await poller.tick();
    if (r.status === 'not_on_scoreboard') problems.add('game not found on the ESPN scoreboard');
    if (r.final) break;
    await sleep(r.delayMs);
  }
  await close();
  console.log(`[dry-run] ${saves} saves; ${problems.size ? `PROBLEMS:\n  - ${[...problems].join('\n  - ')}` : 'no problems'}`);
  if (problems.size) process.exitCode = 1;
}

main().catch((err) => {
  console.error('[dry-run] Failed:', err);
  process.exit(1);
});
