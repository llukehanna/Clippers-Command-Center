// app/api/cron/poll-live/route.ts
// On-demand live poll: one scoreboard fetch + snapshot write per request.
// The scheduled live pipeline is the game-night runner
// (.github/workflows/game-night.yml → scripts/game-night.ts, every 12s); this
// route remains for manual/external triggers with `Authorization: Bearer $CRON_SECRET`.
//
// When the scoreboard reports Final, the games row is marked 'final'; box scores
// are written by the runner or the nightly post-game pipeline.

import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sql } from '@/src/lib/db';
import { findLiveCandidates, runLiveCycle } from '../../../../scripts/lib/live-cycle';

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
    const result = await runLiveCycle(sql, candidate);
    if (result.state !== 'OK') {
      return NextResponse.json({ state: 'NO_ACTIVE_GAME' }, { status: 200 });
    }
    return NextResponse.json(
      { state: 'OK', snapshot_written: true, status: result.payload.status },
      { status: 200 }
    );
  } catch (err) {
    // Log details server-side only; return a generic non-2xx so failures are visible.
    console.error('[cron/poll-live] Unhandled error:', err);
    return NextResponse.json({ state: 'ERROR', message: 'Poll cycle failed' }, { status: 500 });
  }
}
