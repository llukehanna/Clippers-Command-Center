// scripts/calibrate-wp.ts
// Fits the stern-v1 win-probability σ over every final Clippers game with a
// game_flow margin series (Live v2 spec §7.1, §10) and stores it in app_kv
// ('wp:model'); the game-night runner reads it at start. Refuses to store a fit
// whose Brier score is worse than the stored one by more than 0.005 (exit 1),
// which is what makes the nightly post-game run go red on a regression.
//
//   npm run calibrate-wp            fit, print, store
//   npm run calibrate-wp -- --dry   fit and print only

import { sql } from './lib/db.js';
import { BRIER_TOLERANCE, calibrate, WP_MODEL_KEY, type CalGame } from './lib/wp-calibrate.js';
import { expectedLacMargin } from '../src/lib/live/win-prob.js';
import type { WpCalibration } from '../src/lib/types/live-state.js';

const MIN_GAMES = 50;
type Json = Parameters<typeof sql.json>[0];

interface Row {
  series: [number, number][];
  lac_home: boolean;
  home_score: number;
  away_score: number;
  lac_spread: number | null;
}

async function main(): Promise<void> {
  const dry = process.argv.includes('--dry');
  const rows = await sql<Row[]>`
    SELECT
      gf.margin_series                   AS series,
      (g.home_team_id = lac.team_id)     AS lac_home,
      g.home_score,
      g.away_score,
      (SELECT (CASE WHEN g.home_team_id = lac.team_id THEN o.spread_home ELSE o.spread_away END)::float8
         FROM odds_snapshots o
        WHERE o.game_id = g.game_id
          AND (g.start_time_utc IS NULL OR o.captured_at <= g.start_time_utc)
        ORDER BY o.captured_at DESC
        LIMIT 1)                         AS lac_spread
    FROM game_flow gf
    JOIN games g ON g.game_id = gf.game_id
    JOIN teams lac ON lac.abbreviation = 'LAC'
    WHERE lower(g.status) = 'final'
      AND g.home_score IS NOT NULL AND g.away_score IS NOT NULL
      AND (g.home_team_id = lac.team_id OR g.away_team_id = lac.team_id)
  `;

  const games: CalGame[] = rows
    .filter((r) => Array.isArray(r.series) && r.home_score !== r.away_score)
    .map((r) => ({
      series: r.series,
      lacWon: r.lac_home ? r.home_score > r.away_score : r.away_score > r.home_score,
      expected: expectedLacMargin(r.lac_spread, r.lac_home).expected,
    }));
  if (games.length < MIN_GAMES) {
    console.error(`[calibrate-wp] Only ${games.length} games with a margin series; need ${MIN_GAMES}. Not fitting.`);
    process.exitCode = 1;
    return;
  }

  const result = calibrate(games);
  const withSpread = rows.filter((r) => r.lac_spread !== null).length;
  console.log(
    `[calibrate-wp] ${result.n_games} games (${withSpread} with a closing spread), ${result.n_samples} samples → ` +
      `σ ${result.sigma}, Brier ${result.brier}`
  );
  console.log('  predicted     actual   n');
  for (const b of result.reliability) {
    console.log(`  ${b.lo.toFixed(1)}–${b.hi.toFixed(1)}  ${b.mean_p.toFixed(3)}  ${b.observed.toFixed(3)}  ${b.n}`);
  }

  const [stored] = await sql<{ value: WpCalibration }[]>`SELECT value FROM app_kv WHERE key = ${WP_MODEL_KEY}`;
  if (stored && result.brier > stored.value.brier + BRIER_TOLERANCE) {
    console.error(
      `[calibrate-wp] Brier ${result.brier} is worse than the stored ${stored.value.brier} by more than ${BRIER_TOLERANCE}. ` +
        'Keeping the stored model.'
    );
    process.exitCode = 1;
    return;
  }
  if (dry) {
    console.log('[calibrate-wp] --dry: not storing.');
    return;
  }

  const value: WpCalibration = { ...result, fitted_at: new Date().toISOString() };
  await sql`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES (${WP_MODEL_KEY}, ${sql.json(value as unknown as Json)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  console.log(`[calibrate-wp] Stored ${WP_MODEL_KEY}.`);
}

main()
  .then(() => sql.end({ timeout: 5 }))
  .catch(async (err) => {
    console.error('[calibrate-wp] Failed:', err);
    await sql.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
