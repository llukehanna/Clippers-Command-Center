// scripts/backfill-periods.ts
// Adds the per-period line score to game_team_box_scores.raw_payload for final
// Clippers games finalized before finalization stored it (see scripts/lib/finalize.ts).
// /api/history/games/[id] returns it as game.periods.
//
// Idempotent and bounded: each run handles at most --limit games (newest first),
// so the nightly post-game workflow works through the backlog over a few nights.
//
//   tsx scripts/backfill-periods.ts [--limit 150]

import { sql } from './lib/db.js';
import { fetchCdnBoxscore, mapPool } from './lib/nba-season.js';
import { periodsBackfillCandidates } from './lib/periods-candidates.js';
import { toNbaGameId10 } from './lib/schedule-utils.js';

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const limit = Number(argValue('--limit') ?? 150);

  const games = await periodsBackfillCandidates(sql, limit);
  console.log(`[backfill-periods] ${games.length} game(s) missing line scores`);

  let updated = 0;
  let failed = 0;
  await mapPool(games, 4, async (g) => {
    const gid = toNbaGameId10(g.nba_game_id, g.season_id);
    if (!gid) return;
    const res = await fetchCdnBoxscore(gid);
    if (res.status !== 'ok') {
      failed++;
      return;
    }
    const { homeTeam, awayTeam } = res.boxscore.game;
    await sql`
      UPDATE game_team_box_scores
      SET raw_payload = (CASE jsonb_typeof(raw_payload) WHEN 'object' THEN raw_payload WHEN 'string' THEN (raw_payload #>> '{}')::jsonb ELSE '{}'::jsonb END) || jsonb_build_object('periods', ${sql.json(homeTeam.periods ?? [])}::jsonb)
      WHERE game_id = ${g.game_id}::bigint AND is_home
    `;
    await sql`
      UPDATE game_team_box_scores
      SET raw_payload = (CASE jsonb_typeof(raw_payload) WHEN 'object' THEN raw_payload WHEN 'string' THEN (raw_payload #>> '{}')::jsonb ELSE '{}'::jsonb END) || jsonb_build_object('periods', ${sql.json(awayTeam.periods ?? [])}::jsonb)
      WHERE game_id = ${g.game_id}::bigint AND NOT is_home
    `;
    updated++;
  });
  console.log(`[backfill-periods] updated ${updated}, unavailable ${failed}`);
}

main()
  .then(() => sql.end())
  .catch(async (err) => {
    console.error('[backfill-periods] Failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
