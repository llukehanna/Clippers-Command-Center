// scripts/lib/live-store.ts
// Database writes for the live runner (Live v2 spec §5). The caller passes its
// postgres client (scripts: scripts/lib/db.ts; the cron route: src/lib/db.ts).

import type { Sql } from 'postgres';
import type { LiveStateDoc, WpCalibration } from '../../src/lib/types/live-state';
import { expectedLacMargin } from '../../src/lib/live/win-prob';
import type { ModelContext } from './live-state';
import { modelSigma, WP_MODEL_KEY } from './wp-calibrate';

type Json = Parameters<Sql['json']>[0];

/** The last saved seq for a game (0 if none) — a restarted runner continues from it. */
export async function loadLiveSeq(sql: Sql, gameDbId: string): Promise<number> {
  const [row] = await sql<{ seq: number }[]>`SELECT seq FROM live_state WHERE game_id = ${gameDbId}::bigint`;
  return row?.seq ?? 0;
}

/**
 * Upserts the game's live state if `doc.seq` is newer than what's stored, then
 * mirrors status/score/clock onto the all_games row (preseason games included).
 * Returns false when a newer state was already stored (nothing written).
 */
export async function saveLiveState(sql: Sql, gameDbId: string, doc: LiveStateDoc): Promise<boolean> {
  const written = await sql`
    INSERT INTO live_state (game_id, seq, state, fetched_at)
    VALUES (${gameDbId}::bigint, ${doc.seq}, ${sql.json(doc as unknown as Json)}, ${doc.fetched_at})
    ON CONFLICT (game_id) DO UPDATE
      SET seq = EXCLUDED.seq, state = EXCLUDED.state, fetched_at = EXCLUDED.fetched_at, updated_at = now()
      WHERE live_state.seq < EXCLUDED.seq
    RETURNING seq
  `;
  if (written.length === 0) return false;

  // A game can't go back from final on a stale read.
  await sql`
    UPDATE all_games SET
      status = ${doc.status}, period = ${doc.period}, clock = ${doc.clock},
      home_score = ${doc.home_score}, away_score = ${doc.away_score}, updated_at = now()
    WHERE game_id = ${gameDbId}::bigint AND status <> 'final'
  `;
  await sql`
    INSERT INTO app_kv (key, value, updated_at)
    VALUES ('live:last_poll_at', ${sql.json(doc.fetched_at)}, now())
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
  `;
  return true;
}

/**
 * The win-probability and clipboard inputs for one game, read once when the
 * runner starts: the Clippers' closing spread (the newest odds snapshot taken
 * at or before tip), the fitted σ from app_kv (the fit for this game's source
 * of E when there is one), and each player's last-10-game average minutes.
 * Null when the game row doesn't exist.
 */
export async function loadModelContext(sql: Sql, gameDbId: string): Promise<ModelContext | null> {
  const [g] = await sql<{ lac_home: boolean; home_team_id: string; away_team_id: string; lac_spread: number | null }[]>`
    SELECT
      (g.home_team_id = lac.team_id) AS lac_home,
      g.home_team_id::text           AS home_team_id,
      g.away_team_id::text           AS away_team_id,
      (SELECT (CASE WHEN g.home_team_id = lac.team_id THEN o.spread_home ELSE o.spread_away END)::float8
         FROM odds_snapshots o
        WHERE o.game_id = g.game_id
          AND (g.start_time_utc IS NULL OR o.captured_at <= g.start_time_utc)
        ORDER BY o.captured_at DESC
        LIMIT 1)                     AS lac_spread
    FROM all_games g
    JOIN teams lac ON lac.abbreviation = 'LAC'
    WHERE g.game_id = ${gameDbId}::bigint
  `;
  if (!g) return null;
  const e = expectedLacMargin(g.lac_spread, g.lac_home);

  const [kv] = await sql<{ value: WpCalibration }[]>`SELECT value FROM app_kv WHERE key = ${WP_MODEL_KEY}`;
  const calibration = kv?.value ?? null;
  // The σ fitted for this game's source of E (spread or home court), else the overall σ, else the default.
  const sigma = modelSigma(calibration, e.source);

  const rows = await sql<{ person_id: number; minutes: number | null }[]>`
    SELECT DISTINCT ON (r.player_id) p.nba_person_id AS person_id, r.minutes::float8 AS minutes
    FROM rolling_player_stats r
    JOIN players p ON p.player_id = r.player_id
    WHERE r.window_games = 10
      AND p.nba_person_id IS NOT NULL
      AND r.team_id IN (${g.home_team_id}::bigint, ${g.away_team_id}::bigint)
    ORDER BY r.player_id, r.as_of_game_date DESC
  `;
  const usualMin: Record<string, number> = {};
  for (const r of rows) if (r.minutes !== null && r.minutes > 0) usualMin[String(r.person_id)] = Math.round(r.minutes * 10) / 10;

  return { expected: e.expected, expectedSource: e.source, sigma, calibration, usualMin };
}

/**
 * A compact live_snapshots row at a period end or the final buzzer (insight
 * proofs read these). The cron route builds a fresh poller per request, so the
 * poller's in-memory dedup can't be trusted alone — insert only if no row for
 * this game/reason/period exists yet, so a re-offered moment is a no-op.
 */
export async function saveLiveMoment(
  sql: Sql,
  gameDbId: string,
  doc: LiveStateDoc,
  reason: 'period_end' | 'final'
): Promise<void> {
  const payload = { reason, seq: doc.seq, status: doc.status, status_text: doc.status_text, periods: doc.periods };
  await sql`
    INSERT INTO live_snapshots (game_id, captured_at, provider_ts, period, clock, home_score, away_score, payload)
    SELECT ${gameDbId}::bigint, now(), ${doc.observed_at}, ${doc.period}, ${doc.clock},
           ${doc.home_score}, ${doc.away_score}, ${sql.json(payload as unknown as Json)}
    WHERE NOT EXISTS (
      SELECT 1 FROM live_snapshots
      WHERE game_id = ${gameDbId}::bigint AND payload->>'reason' = ${reason} AND period = ${doc.period}
    )
  `;
}
