import { describe, it, expect } from 'vitest';
import { deriveClutch, deriveGameFlow, derivePeriodStats } from './derive';
import type { NormalizedPbp, PbpEvent } from './types';

// Builds a scoring/shot event. Score is the running score AFTER the event.
let seq = 0;
function ev(p: Partial<PbpEvent> & { home: number; away: number; prev: [number, number] }): PbpEvent {
  const { home, away, prev, ...rest } = p;
  const points = home - prev[0] + (away - prev[1]);
  return {
    seq: ++seq, period: 1, clockSec: 600, elapsedSec: 120, teamTricode: null, personId: null,
    kind: 'other', made: null, shotValue: null, assistPersonId: null,
    points, scoringSide: home > prev[0] ? 'home' : away > prev[1] ? 'away' : null,
    scoreHome: home, scoreAway: away, description: '', ...rest,
  };
}

// LAC is the AWAY team. Sequence: LAC 3 (0-3), DEN 2 (2-3), DEN 2 (4-3), LAC FT (4-4), LAC 2 (4-6).
const events: PbpEvent[] = [
  ev({ prev: [0, 0], home: 0, away: 3, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 3, assistPersonId: 2, elapsedSec: 20 }),
  ev({ prev: [0, 3], home: 0, away: 3, teamTricode: 'DEN', personId: 9, kind: 'fg', made: false, shotValue: 2, elapsedSec: 40 }),
  ev({ prev: [0, 3], home: 0, away: 3, teamTricode: 'LAC', personId: 2, kind: 'rebound', elapsedSec: 41 }),
  ev({ prev: [0, 3], home: 2, away: 3, teamTricode: 'DEN', personId: 9, kind: 'fg', made: true, shotValue: 2, elapsedSec: 60 }),
  ev({ prev: [2, 3], home: 4, away: 3, teamTricode: 'DEN', personId: 9, kind: 'fg', made: true, shotValue: 2, period: 4, clockSec: 200, elapsedSec: 2680 }),
  ev({ prev: [4, 3], home: 4, away: 4, teamTricode: 'LAC', personId: 1, kind: 'ft', made: true, shotValue: 1, period: 4, clockSec: 120, elapsedSec: 2760 }),
  ev({ prev: [4, 4], home: 4, away: 4, teamTricode: 'LAC', personId: 1, kind: 'turnover', period: 4, clockSec: 90, elapsedSec: 2790 }),
  ev({ prev: [4, 4], home: 4, away: 6, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 2, period: 4, clockSec: 60, elapsedSec: 2820 }),
];

describe('deriveGameFlow', () => {
  const flow = deriveGameFlow(events, false);
  it('tracks leads, deficits, lead changes and ties from the Clippers side', () => {
    expect(flow).toMatchObject({ lacLargestLead: 3, lacLargestDeficit: 1, leadChanges: 2, timesTied: 1 });
  });
  it('finds the best unanswered runs', () => {
    expect(flow.lacBestRun).toBe(3);
    expect(flow.oppBestRun).toBe(4);
  });
  it('records a comeback margin only for a win', () => {
    expect(flow.comebackMargin).toBe(1);
    expect(deriveGameFlow(events.slice(0, 5), false).comebackMargin).toBeNull();
  });
  it('emits the margin series at each score change', () => {
    expect(flow.marginSeries).toEqual([[0, 0], [20, 3], [60, 1], [2680, -1], [2760, 0], [2820, 2]]);
  });

  it('subtracts a same-side correction from the in-progress run, flooring at 0', () => {
    // LAC scores 2, then 3 (run = 5), then the 3-pointer is overturned (away score drops by 3).
    const seq: PbpEvent[] = [
      ev({ prev: [0, 0], home: 0, away: 2, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 2 }),
      ev({ prev: [0, 2], home: 0, away: 5, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 3 }),
      ev({ prev: [0, 5], home: 0, away: 2, description: 'Overturned on review' }),
    ];
    expect(deriveGameFlow(seq, false).lacBestRun).toBe(2);
  });

  it('leaves the run alone when the correction is to the side not currently on the run', () => {
    // DEN scores 2 (run = opp 2), then LAC scores 3 then 2 (run = lac 5), then DEN's earlier
    // basket is overturned (home score drops by 2) while the LAC run is still in progress.
    const seq: PbpEvent[] = [
      ev({ prev: [0, 0], home: 2, away: 0, teamTricode: 'DEN', personId: 9, kind: 'fg', made: true, shotValue: 2 }),
      ev({ prev: [2, 0], home: 2, away: 3, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 3 }),
      ev({ prev: [2, 3], home: 2, away: 5, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 2 }),
      ev({ prev: [2, 5], home: 0, away: 5, description: 'DEN basket overturned' }),
    ];
    expect(deriveGameFlow(seq, false).lacBestRun).toBe(5);
  });

  it('does not lower an earlier, larger best run when a later smaller run is corrected', () => {
    // LAC runs 6 (best = 6), DEN scores 4 (run = opp 4), LAC scores 3 (run = lac 3, best stays 6),
    // then that 3-pointer is overturned (away score drops by 2) — best must stay 6, not drop.
    const seq: PbpEvent[] = [
      ev({ prev: [0, 0], home: 0, away: 6, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 2 }),
      ev({ prev: [0, 6], home: 4, away: 6, teamTricode: 'DEN', personId: 9, kind: 'fg', made: true, shotValue: 2 }),
      ev({ prev: [4, 6], home: 4, away: 9, teamTricode: 'LAC', personId: 1, kind: 'fg', made: true, shotValue: 3 }),
      ev({ prev: [4, 9], home: 4, away: 7, description: '3-pointer overturned' }),
    ];
    expect(deriveGameFlow(seq, false).lacBestRun).toBe(6);
  });
});

describe('derivePeriodStats', () => {
  const pbp: NormalizedPbp = { source: 'cdn', hasDefensiveCredits: true, events };
  const { teams, players } = derivePeriodStats(pbp, { home: 'DEN', away: 'LAC' });
  const team = (t: string, p: number) => teams.find((x) => x.tricode === t && x.period === p);
  const player = (id: number, p: number) => players.find((x) => x.personId === id && x.period === p);

  it('team points per period match the score changes', () => {
    expect(team('LAC', 1)).toMatchObject({ pts: 3, fgm: 1, fga: 1, fg3m: 1, fg3a: 1, ast: 1, reb: 1 });
    expect(team('DEN', 1)).toMatchObject({ pts: 2, fgm: 1, fga: 2 });
    expect(team('LAC', 4)).toMatchObject({ pts: 3, fgm: 1, fga: 1, ftm: 1, fta: 1, tov: 1 });
  });
  it('credits players for points, threes, rebounds and assists', () => {
    expect(player(1, 1)).toMatchObject({ pts: 3, fg3m: 1, fgm: 1, fga: 1, tricode: 'LAC' });
    expect(player(2, 1)).toMatchObject({ reb: 1, ast: 1, pts: 0 });
    expect(player(1, 4)).toMatchObject({ pts: 3, fgm: 1, fga: 1 });
  });
  it('leaves assist/steal/block credits NULL when the source has none', () => {
    const v3 = derivePeriodStats({ ...pbp, source: 'stats_pbp', hasDefensiveCredits: false }, { home: 'DEN', away: 'LAC' });
    expect(v3.players.find((x) => x.personId === 2 && x.period === 1)).toMatchObject({ ast: null, stl: null, blk: null });
    expect(v3.teams.find((x) => x.tricode === 'LAC' && x.period === 1)?.ast).toBeNull();
  });
});

describe('deriveClutch', () => {
  const lines = deriveClutch(events);
  it('counts only events in the last 5:00 of the 4th with the game within 5', () => {
    expect(lines.find((l) => l.tricode === 'LAC' && l.personId === null)).toMatchObject({ pts: 3, fgm: 1, fga: 1, ftm: 1, fta: 1, tov: 1 });
    expect(lines.find((l) => l.tricode === 'LAC' && l.personId === 1)).toMatchObject({ pts: 3, tov: 1 });
    expect(lines.find((l) => l.tricode === 'DEN' && l.personId === 9)).toMatchObject({ pts: 2, fgm: 1, fga: 1 });
  });
  it('excludes events when the margin before them is more than 5', () => {
    const blowout = [ev({ prev: [20, 0], home: 22, away: 0, teamTricode: 'DEN', personId: 9, kind: 'fg', made: true, shotValue: 2, period: 4, clockSec: 100 })];
    blowout.unshift(ev({ prev: [0, 0], home: 20, away: 0, period: 1 }));
    expect(deriveClutch(blowout)).toEqual([]);
  });
});
