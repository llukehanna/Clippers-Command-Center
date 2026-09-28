// app/api/cron/poll-live/route.ts
// On-demand live poll: one live poller tick per request (writes live_state).
// The scheduled live pipeline is the game-night runner
// (.github/workflows/game-night.yml → scripts/game-night.ts, adaptive cadence); this
// route remains for manual/external triggers with `Authorization: Bearer $CRON_SECRET`.
//
// When the scoreboard reports Final, the games row is marked 'final'; box scores
// are written by the runner or the nightly post-game pipeline.

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sql } from '@/src/lib/db';
import { findLiveCandidates } from '../../../../scripts/lib/live-cycle';
import { createPoller } from '../../../../scripts/lib/live-poller';
import { nbaPollerDeps } from '../../../../scripts/lib/live-deps';
import { loadLiveSeq } from '../../../../scripts/lib/live-store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// ── Auth ──────────────────────────────────────────────────────────────────────

/** Constant-time comparison of the Authorization header against the secret. */
function isAuthorized(authHeader: string | null, cronSecret: string): boolean {
  if (!authHeader) return false;
  const provided = Buffer.from(authHeader);
  const expected = Buffer.from(`Bearer ${cronSecret}`);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

// ── GET handler ───────────────────────────────────────────────────────────────

export async function GET(request: Request): Promise<NextResponse> {
  // Fail closed: without a configured secret nobody may trigger DB writes.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error('[cron/poll-live] CRON_SECRET is not configured — refusing request');
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
  }
  if (!isAuthorized(request.headers.get('authorization'), cronSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const [candidate] = await findLiveCandidates(sql);
    if (!candidate) {
      return NextResponse.json({ state: 'NO_ACTIVE_GAME' }, { status: 200 });
    }
    const initialSeq = await loadLiveSeq(sql, candidate.game_id);
    const poller = createPoller(
      candidate.nba_game_id,
      candidate.start_time_utc?.getTime() ?? null,
      nbaPollerDeps(sql, candidate.game_id, candidate.nba_game_id),
      initialSeq
    );
    const result = await poller.tick();
    if (result.status === 'error') {
      // A tick error is a real fetch/save failure, not "no game right now" —
      // surface it as a failure rather than a healthy 200.
      return NextResponse.json({ state: 'ERROR', message: 'Poll cycle failed' }, { status: 502 });
    }
    if (result.status !== 'ok' || !result.doc) {
      return NextResponse.json({ state: 'NO_ACTIVE_GAME' }, { status: 200 });
    }
    return NextResponse.json(
      { state: 'OK', snapshot_written: result.saved, status: result.doc.status, seq: result.doc.seq },
      { status: 200 }
    );
  } catch (err) {
    // Log details server-side only; return a generic non-2xx so failures are visible.
    console.error('[cron/poll-live] Unhandled error:', err);
    return NextResponse.json({ state: 'ERROR', message: 'Poll cycle failed' }, { status: 500 });
  }
}
