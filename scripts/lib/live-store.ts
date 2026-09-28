// scripts/lib/live-store.ts
// Database writes for the live runner (Live v2 spec §5). The caller passes its
// postgres client (scripts: scripts/lib/db.ts; the cron route: src/lib/db.ts).

import type { Sql } from 'postgres';
import type { LiveStateDoc } from '../../src/lib/types/live-state';

type Json = Parameters<Sql['json']>[0];

/** The last saved seq for a game (0 if none) — a restarted runner continues from it. */
export async function loadLiveSeq(sql: Sql, gameDbId: string): Promise<number> {
  const [row] = await sql<{ seq: number }[]>`SELECT seq FROM live_state WHERE game_id = ${gameDbId}::bigint`;
  return row?.seq ?? 0;
}

/**
 * Upserts the game's live state if `doc.seq` is newer than what's stored, then
 * mirrors status/score/clock onto the games row. Returns false when a newer
 * state was already stored (nothing written).
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
    UPDATE games SET
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

/** A compact live_snapshots row at a period end or the final buzzer (insight proofs read these). */
export async function saveLiveMoment(
  sql: Sql,
  gameDbId: string,
  doc: LiveStateDoc,
  reason: 'period_end' | 'final'
): Promise<void> {
  const payload = { reason, seq: doc.seq, status: doc.status, status_text: doc.status_text, periods: doc.periods };
  await sql`
    INSERT INTO live_snapshots (game_id, captured_at, provider_ts, period, clock, home_score, away_score, payload)
    VALUES (${gameDbId}::bigint, now(), ${doc.observed_at}, ${doc.period}, ${doc.clock},
            ${doc.home_score}, ${doc.away_score}, ${sql.json(payload as unknown as Json)})
  `;
}
