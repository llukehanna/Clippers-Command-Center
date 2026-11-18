import { describe, it, expect } from 'vitest';
import type { PlayByPlayAction } from '../../src/lib/types/live';
import { chargedTimeouts, timeoutsRemaining } from './live-timeouts';

const LAC = 1610612746;
const UTA = 1610612762;

let n = 0;
function to(teamId: number, period: number, clock: string, extra: Partial<PlayByPlayAction> = {}): PlayByPlayAction {
  n += 2;
  return {
    actionNumber: n, clock, period, teamId, teamTricode: '', actionType: 'timeout', subType: 'full',
    qualifiers: [], personId: 0, description: 'Full timeout', scoreHome: '', scoreAway: '', pointsTotal: 0, ...extra,
  } as PlayByPlayAction;
}

const challenge = (teamId: number, period: number, clock: string, ruling: 'stands' | 'overturned') =>
  to(teamId, period, clock, {
    actionType: `coach'schallenge(${ruling})`,
    subType: '',
    description: ruling === 'stands' ? "COACH'S CHALLENGE (CALL STANDS) [Clippers] charged with a timeout" : "COACH'S CHALLENGE (CALL OVERTURNED) [Clippers] retain their timeout",
  });

describe('chargedTimeouts', () => {
  it('counts team timeouts, not media timeouts or the other team', () => {
    const acts = [to(LAC, 1, 'PT06M59.00S'), to(UTA, 1, 'PT05M00.00S'), to(0, 1, 'PT04M00.00S', { subType: 'official' })];
    expect(chargedTimeouts(acts, LAC)).toEqual([{ period: 1, clockSec: 419 }]);
  });

  it("keeps a failed challenge's timeout and gives back a successful one's", () => {
    const failed = [to(LAC, 3, 'PT04M03.00S'), challenge(LAC, 3, 'PT04M03.00S', 'stands')];
    expect(chargedTimeouts(failed, LAC)).toHaveLength(1);
    const won = [to(LAC, 3, 'PT09M05.00S'), challenge(LAC, 3, 'PT09M05.00S', 'overturned')];
    expect(chargedTimeouts(won, LAC)).toHaveLength(0);
  });

  it('charges an upheld challenge logged without its own timeout', () => {
    expect(chargedTimeouts([challenge(LAC, 4, 'PT05M26.00S', 'stands')], LAC)).toHaveLength(1);
    // A successful one logged that way costs nothing, and takes nothing back.
    const acts = [to(LAC, 2, 'PT08M00.00S'), challenge(LAC, 4, 'PT05M26.00S', 'overturned')];
    expect(chargedTimeouts(acts, LAC)).toHaveLength(1);
  });
});

describe('timeoutsRemaining', () => {
  it('starts at 7 and counts down through regulation', () => {
    expect(timeoutsRemaining([], LAC, 0, 720)).toBe(7);
    const used = [to(LAC, 1, 'PT06M59.00S'), to(UTA, 1, 'PT01M36.00S'), to(LAC, 3, 'PT08M17.00S')];
    expect(timeoutsRemaining(used, LAC, 3, 300)).toBe(5);
    expect(timeoutsRemaining(used, UTA, 3, 300)).toBe(6);
  });

  it('caps the fourth quarter at 4, and its last three minutes at 2', () => {
    expect(timeoutsRemaining([], LAC, 4, 720)).toBe(4);
    const q4 = [to(LAC, 4, 'PT09M14.00S'), to(LAC, 4, 'PT06M08.00S')];
    expect(timeoutsRemaining(q4, LAC, 4, 300)).toBe(2);
    expect(timeoutsRemaining([], LAC, 4, 179)).toBe(2);
    expect(timeoutsRemaining([to(LAC, 4, 'PT01M10.00S')], LAC, 4, 60)).toBe(1);
    // Six used before the fourth leave one, whatever the caps.
    const six = Array.from({ length: 6 }, (_, i) => to(LAC, 1 + (i % 3), 'PT05M00.00S'));
    expect(timeoutsRemaining(six, LAC, 4, 100)).toBe(1);
  });

  it('gives 2 per overtime period', () => {
    const used = [to(LAC, 4, 'PT00M30.00S'), to(LAC, 5, 'PT03M00.00S')];
    expect(timeoutsRemaining(used, LAC, 5, 100)).toBe(1);
    expect(timeoutsRemaining(used, LAC, 6, 300)).toBe(2);
  });

  it('never goes below 0', () => {
    const many = Array.from({ length: 9 }, () => to(LAC, 2, 'PT05M00.00S'));
    expect(timeoutsRemaining(many, LAC, 3, 300)).toBe(0);
  });
});
