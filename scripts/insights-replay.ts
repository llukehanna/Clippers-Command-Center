// scripts/insights-replay.ts
// Runs every detector with a date cutoff against real data and prints the
// ranked feeds with score parts, without writing (spec §5.3).
//
// Run via: npm run insights:replay -- --as-of=YYYY-MM-DD [--surface=season,pregame,postgame]
import { sql } from './lib/db.js';
import { laToday } from './lib/insights/engine/dates.js';
import { formatReplay, parseReplayArgs } from './lib/insights/engine/replay.js';
import { runEngine } from './lib/insights/engine/run.js';

async function main(): Promise<void> {
  const args = parseReplayArgs(process.argv.slice(2), laToday());
  console.log(`Replaying ${args.surfaces.join(', ')} as of ${args.asOf} (no writes)`);
  const result = await runEngine({ surfaces: args.surfaces, asOf: args.asOf, write: false, log: (m) => console.log(m) });
  if (!result.context) {
    console.log('No Clippers box scores as of that date.');
    return;
  }
  console.log(formatReplay(result, args.surfaces));
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('insights:replay failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
