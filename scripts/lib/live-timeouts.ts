// scripts/lib/live-timeouts.ts
// Timeouts a team has left, counted from play-by-play. ESPN's feed doesn't
// carry timeouts remaining (the NBA CDN scoreboard did), so the runner applies
// the NBA rule to the timeouts it has seen charged. Pure.
//
// NBA rule: 7 timeouts per team in regulation, no more than 4 in the fourth
// quarter and no more than 2 in its last three minutes; 2 per overtime period
// (regulation leftovers don't carry over). A failed coach's challenge costs a
// timeout (a successful one keeps it); media (official) timeouts carry no
// team and cost nothing.

import type { PlayByPlayAction } from '../../src/lib/types/live';
import { clockToSecondsRemaining } from './nba-live-client';

const REGULATION_TIMEOUTS = 7;
const Q4_MAX = 4;
const LAST_3_MIN_MAX = 2;
const LAST_3_MIN_SECS = 180;
const OT_TIMEOUTS = 2;

interface Charge {
  period: number;
  clockSec: number;
}

/**
 * The timeouts charged to `teamId`, in order. A coach's challenge shows up in
 * ESPN's feed as the team's full timeout, then the ruling: "charged with a
 * timeout" keeps it, "retain their timeout" gives it back. A challenge logged
 * without its own timeout that is upheld costs one.
 */
export function chargedTimeouts(actions: PlayByPlayAction[], teamId: number): Charge[] {
  const out: Charge[] = [];
  if (!teamId) return out;
  let last: (Charge & { open: boolean }) | null = null;
  const sameMoment = (a: PlayByPlayAction) =>
    last?.open && last.period === a.period && last.clockSec === clockToSecondsRemaining(a.clock);
  for (const a of actions) {
    if (a.teamId !== teamId) continue;
    const at = { period: a.period, clockSec: clockToSecondsRemaining(a.clock) };
    const desc = a.description ?? '';
    if (a.actionType.toLowerCase() === 'timeout') {
      if ((a.subType ?? '').toLowerCase() === 'official') continue;
      out.push(at);
      last = { ...at, open: true };
    } else if (/retain their timeout/i.test(desc)) {
      if (sameMoment(a)) out.pop();
      last = null;
    } else if (/charged with a timeout/i.test(desc)) {
      if (!sameMoment(a)) out.push(at);
      last = null;
    }
  }
  return out;
}

/** Timeouts `teamId` has left at (period, clockSec), 0 at worst. */
export function timeoutsRemaining(actions: PlayByPlayAction[], teamId: number, period: number, clockSec: number): number {
  const charged = chargedTimeouts(actions, teamId);
  if (period > 4) return Math.max(0, OT_TIMEOUTS - charged.filter((c) => c.period === period).length);

  let left = REGULATION_TIMEOUTS - charged.filter((c) => c.period <= 4).length;
  if (period === 4) {
    const q4 = charged.filter((c) => c.period === 4);
    left = Math.min(left, Q4_MAX - q4.length);
    if (clockSec <= LAST_3_MIN_SECS) {
      left = Math.min(left, LAST_3_MIN_MAX - q4.filter((c) => c.clockSec <= LAST_3_MIN_SECS).length);
    }
  }
  return Math.max(0, left);
}
