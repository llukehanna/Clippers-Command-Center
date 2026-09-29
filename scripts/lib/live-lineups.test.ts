import { describe, it, expect } from 'vitest';
import { buildLineups, inFoulTrouble, isoMinutes, minutesPace, type LineupInputs } from './live-lineups.js';
import { action, box, LAC_ID, SAC_ID } from './live-fixtures.js';
import type { BoxscorePlayer, BoxscoreTeam, PlayByPlayAction, PlayerStatistics } from '../../src/lib/types/live.js';

const ZERO: PlayerStatistics = {
  assists: 0, blocks: 0, fieldGoalsAttempted: 0, fieldGoalsMade: 0, fieldGoalsPercentage: 0, foulsPersonal: 0,
  freeThrowsAttempted: 0, freeThrowsMade: 0, freeThrowsPercentage: 0, minutes: 'PT00M00.00S', minutesCalculated: 'PT00M',
  plus: 0, minus: 0, plusMinusPoints: 0, points: 0, reboundsDefensive: 0, reboundsOffensive: 0, reboundsTotal: 0,
  steals: 0, threePointersAttempted: 0, threePointersMade: 0, threePointersPercentage: 0, turnovers: 0,
};

function player(personId: number, o: { on?: boolean; starter?: boolean; pf?: number; minutes?: string } = {}): BoxscorePlayer {
  return {
    status: 'ACTIVE', order: 1, personId, jerseyNum: '0', name: `Player ${personId}`, nameI: `P. ${personId}`, position: '',
    starter: o.starter ? '1' : '0', oncourt: o.on ? '1' : '0', played: '1',
    statistics: { ...ZERO, foulsPersonal: o.pf ?? 0, minutes: o.minutes ?? 'PT00M00.00S' },
  };
}

/** LAC: starters 101–105, bench 106. `on` lists who is on the floor now. */
function lac(on: number[], extra: Partial<BoxscoreTeam> = {}): BoxscoreTeam {
  const players = [101, 102, 103, 104, 105, 106].map((id) => player(id, { on: on.includes(id), starter: id <= 105 }));
  return { ...box().homeTeam, players, ...extra };
}

function sac(): BoxscoreTeam {
  return { ...box().awayTeam, players: [201, 202, 203, 204, 205].map((id) => player(id, { on: true, starter: true })) };
}

function score(n: number, home: number, away: number, clock: string, period = 1): PlayByPlayAction {
  return action(n, { scoreHome: String(home), scoreAway: String(away), clock, period });
}

function sub(n: number, personId: number, dir: 'in' | 'out', clock: string, period: number, home: number, away: number): PlayByPlayAction {
  return action(n, { actionType: 'substitution', subType: dir, personId, teamId: LAC_ID, clock, period, scoreHome: String(home), scoreAway: String(away) });
}

function inputs(over: Partial<LineupInputs>): LineupInputs {
  return { actions: [], lacBox: lac([101, 102, 103, 104, 105]), oppBox: sac(), lacIsHome: true, period: 1, clockSec: 720, usualMin: {}, ...over };
}

describe('inFoulTrouble', () => {
  it('uses 2 / 3 / 4 / 5 fouls by quarter', () => {
    expect(inFoulTrouble(1, 1)).toBe(false);
    expect(inFoulTrouble(1, 2)).toBe(true);
    expect(inFoulTrouble(2, 3)).toBe(true);
    expect(inFoulTrouble(3, 3)).toBe(false);
    expect(inFoulTrouble(3, 4)).toBe(true);
    expect(inFoulTrouble(4, 5)).toBe(true);
    expect(inFoulTrouble(5, 4)).toBe(false);
    expect(inFoulTrouble(6, 5)).toBe(true);
  });
});

describe('minutesPace', () => {
  it('flags projected minutes more than 25 % off the usual', () => {
    expect(minutesPace(20, 30, 1440)).toBe('over');   // on pace for 40
    expect(minutesPace(8, 30, 1440)).toBe('under');   // on pace for 16
    expect(minutesPace(15, 30, 1440)).toBeNull();     // on pace for 30
  });
  it('does not judge the first quarter or a player without a usual', () => {
    expect(minutesPace(10, 30, 600)).toBeNull();
    expect(minutesPace(10, null, 1440)).toBeNull();
  });
});

describe('isoMinutes', () => {
  it('reads the box score minutes', () => {
    expect(isoMinutes('PT25M30.00S')).toBe(25.5);
    expect(isoMinutes('')).toBe(0);
  });
});

describe('buildLineups', () => {
  // Q1 11:00 LAC 2-0; Q2 6:00 105 out, 106 in at 10-8; Q2 2:00 now 15-8.
  const midQ2 = inputs({
    actions: [
      score(1, 2, 0, 'PT11M00.00S'),
      sub(2, 105, 'out', 'PT06M00.00S', 2, 10, 8),
      sub(3, 106, 'in', 'PT06M00.00S', 2, 10, 8),
      score(4, 15, 8, 'PT02M00.00S', 2),
    ],
    lacBox: lac([101, 102, 103, 104, 106]),
    period: 2,
    clockSec: 120,
  });

  it('times a stint from the substitution that started it', () => {
    const l = buildLineups(midQ2);
    const bench = l.on_court.lac.find((p) => p.player_id === 106)!;
    expect(bench).toMatchObject({ stint_start: { period: 2, clock: '6:00' }, stint_secs: 240, stint_plus_minus: 5 });
    const starter = l.on_court.lac.find((p) => p.player_id === 101)!;
    expect(starter).toMatchObject({ stint_start: { period: 1, clock: '12:00' }, stint_secs: 1320, stint_plus_minus: 7 });
    expect(l.on_court.lac.map((p) => p.player_id)).not.toContain(105);
  });

  it("gives the other team's stints from their side", () => {
    const l = buildLineups(midQ2);
    expect(l.on_court.opp).toHaveLength(5);
    expect(l.on_court.opp[0]).toMatchObject({ stint_secs: 1320, stint_plus_minus: -7 });
  });

  it('times the current Clippers five from its newest arrival', () => {
    expect(buildLineups(midQ2).current_unit).toEqual({ secs_together: 240, lac_plus_minus: 5 });
  });

  it("tallies tonight's Clippers units, longest first", () => {
    const units = buildLineups(midQ2).units_tonight;
    expect(units.map((u) => [u.player_ids, u.secs, u.plus_minus])).toEqual([
      [[101, 102, 103, 104, 105], 1080, 2],
      [[101, 102, 103, 104, 106], 240, 5],
    ]);
    expect(units[1].names).toEqual(['P. 101', 'P. 102', 'P. 103', 'P. 104', 'P. 106']);
  });

  it('treats a player back on the floor without a logged sub as back since the period started', () => {
    const l = buildLineups(
      inputs({
        actions: [
          sub(1, 105, 'out', 'PT05M00.00S', 1, 4, 4),
          sub(2, 106, 'in', 'PT05M00.00S', 1, 4, 4),
          score(3, 12, 9, 'PT00M30.00S', 1),
          score(4, 14, 9, 'PT11M00.00S', 2),
        ],
        lacBox: lac([101, 102, 103, 104, 105]),
        period: 2,
        clockSec: 660,
      })
    );
    expect(l.on_court.lac.find((p) => p.player_id === 105)).toMatchObject({
      stint_start: { period: 2, clock: '12:00' },
      stint_secs: 60,
      stint_plus_minus: 2,
    });
  });

  it('flags foul trouble and minutes pace', () => {
    const team = lac([101, 102, 103, 104, 105]);
    team.players[0] = { ...team.players[0], statistics: { ...team.players[0].statistics, foulsPersonal: 3, minutes: 'PT20M00.00S' } };
    const l = buildLineups(inputs({ lacBox: team, period: 2, clockSec: 0, usualMin: { '101': 30 } }));
    expect(l.on_court.lac[0]).toMatchObject({ pf: 3, foul_trouble: true, min: 20, usual_min: 30, pace: 'over' });
    expect(l.on_court.lac[1]).toMatchObject({ foul_trouble: false, usual_min: null, pace: null });
  });

  it('reads timeouts and bonus from the box, else from the scoreboard fallback', () => {
    const l = buildLineups(
      inputs({
        lacBox: lac([101, 102, 103, 104, 105], { timeoutsRemaining: 4, inBonus: '1' }),
        fallback: { timeouts: { lac: 7, opp: 3 }, bonus: { lac: false, opp: false } },
      })
    );
    expect(l.timeouts).toEqual({ lac: 4, opp: 3 });
    expect(l.bonus).toEqual({ lac: true, opp: false });
  });

  it('works from the away side', () => {
    const l = buildLineups(
      inputs({
        actions: [score(1, 0, 3, 'PT11M00.00S')],
        lacBox: { ...lac([101, 102, 103, 104, 105]), teamId: LAC_ID },
        oppBox: { ...sac(), teamId: SAC_ID },
        lacIsHome: false,
        period: 1,
        clockSec: 600,
      })
    );
    expect(l.on_court.lac[0].stint_plus_minus).toBe(3);
    expect(l.current_unit.lac_plus_minus).toBe(3);
  });
});
