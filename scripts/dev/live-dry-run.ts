// scripts/dev/live-dry-run.ts
// Runs the Live v2 poller against a real game with no database and prints
// every save: phase, delay, seq, score and state size. Use with the feed probe
// (.github/workflows/feed-probe.yml) to check the cadence on a real game.
//   npx tsx scripts/dev/live-dry-run.ts [--nba-game=auto|0022600001] [--minutes=20]

import {
  fetchBoxscoreConditional,
  fetchPlayByPlayConditional,
  fetchScoreboard,
} from '../lib/nba-live-client.js';
import { createPoller } from '../lib/live-poller.js';

const arg = (name: string, fallback: string): string =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1] || fallback;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main(): Promise<void> {
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
  const poller = createPoller(gameId, null, {
    fetchScoreboard,
    fetchPbp: fetchPlayByPlayConditional,
    fetchBox: fetchBoxscoreConditional,
    saveState: async (d) =>
      console.log(
        `[dry-run] ${new Date().toISOString()} seq ${d.seq} ${d.cadence.phase} next ${d.cadence.next_ms}ms ` +
          `Q${d.period} ${d.clock} ${d.away_score}-${d.home_score} observed ${d.observed_at ?? '—'} ` +
          `${JSON.stringify(d).length} bytes`
      ),
    saveMoment: async (d, reason) => console.log(`[dry-run] moment ${reason} seq ${d.seq}`),
    now: Date.now,
    log: (m) => console.log(`[dry-run] ${m}`),
  });
  while (Date.now() < end) {
    const r = await poller.tick();
    if (r.final) break;
    await sleep(r.delayMs);
  }
}

main().catch((err) => {
  console.error('[dry-run] Failed:', err);
  process.exit(1);
});
