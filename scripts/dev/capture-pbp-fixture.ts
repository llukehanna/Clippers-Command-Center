// scripts/dev/capture-pbp-fixture.ts
// Saves real play-by-play JSON for normalize.test.ts. Run from a home network
// (stats.nba.com blocks cloud IPs):
//   npx tsx scripts/dev/capture-pbp-fixture.ts --cdn=0022500123 --stats=0020500456
import fs from 'node:fs';
import path from 'node:path';
import { fetchPlayByPlay } from '../lib/nba-live-client.js';
import { fetchStatsPlayByPlay } from '../lib/stats-nba.js';

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const dir = path.join(process.cwd(), 'scripts/lib/pbp/__fixtures__');

async function main() {
  fs.mkdirSync(dir, { recursive: true });
  const cdn = arg('cdn');
  if (cdn) {
    const data = await fetchPlayByPlay(cdn);
    fs.writeFileSync(path.join(dir, `cdn-${cdn}.json`), JSON.stringify({ game: { gameId: data.game.gameId, actions: data.game.actions } }));
    console.log(`saved cdn-${cdn}.json (${data.game.actions.length} actions)`);
  }
  const stats = arg('stats');
  if (stats) {
    const data = await fetchStatsPlayByPlay(stats, console.log);
    if (!data) throw new Error(`stats.nba.com has no play-by-play for ${stats}`);
    fs.writeFileSync(path.join(dir, `stats-${stats}.json`), JSON.stringify(data));
    console.log(`saved stats-${stats}.json (${data.game.actions.length} actions)`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
