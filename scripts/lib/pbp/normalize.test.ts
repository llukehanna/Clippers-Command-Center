import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { clockSeconds, elapsedSeconds, normalizePbp } from './normalize';
import type { RawPlayByPlay } from './types';

describe('clock helpers', () => {
  it('parses ISO clocks', () => {
    expect(clockSeconds('PT11M40.00S')).toBe(700);
    expect(clockSeconds('PT00M04.70S')).toBe(4);
    expect(clockSeconds('')).toBe(0);
  });
  it('computes elapsed seconds in regulation and overtime', () => {
    expect(elapsedSeconds(1, 720)).toBe(0);
    expect(elapsedSeconds(2, 700)).toBe(740);
    expect(elapsedSeconds(4, 0)).toBe(2880);
    expect(elapsedSeconds(5, 300)).toBe(2880);
    expect(elapsedSeconds(6, 0)).toBe(3480);
  });
});

const CDN: RawPlayByPlay = { game: { gameId: '0022500001', actions: [
  { actionNumber: 1, clock: 'PT12M00.00S', period: 1, actionType: 'period', subType: 'start', scoreHome: '0', scoreAway: '0', description: 'Period Start' },
  { actionNumber: 4, clock: 'PT11M40.00S', period: 1, teamTricode: 'LAC', personId: 202695, actionType: '3pt', shotResult: 'Made', assistPersonId: 201935, scoreHome: '3', scoreAway: '0', description: "Leonard 26' 3PT (3 PTS) (Harden 1 AST)" },
  { actionNumber: 5, clock: 'PT11M20.00S', period: 1, teamTricode: 'DEN', personId: 203999, actionType: '2pt', shotResult: 'Missed', scoreHome: '3', scoreAway: '0', description: "MISS Jokic 10' Jump Shot" },
  { actionNumber: 6, clock: 'PT11M18.00S', period: 1, teamTricode: 'LAC', personId: 1627826, actionType: 'rebound', subType: 'defensive', scoreHome: '3', scoreAway: '0', description: 'Zubac REBOUND (Off:0 Def:1)' },
  { actionNumber: 7, clock: 'PT05M00.00S', period: 5, teamTricode: 'DEN', personId: 203999, actionType: 'freethrow', subType: '1 of 2', shotResult: 'Made', scoreHome: '3', scoreAway: '1', description: 'Jokic Free Throw 1 of 2 (1 PTS)' },
] } };

const STATS: RawPlayByPlay = { game: { gameId: '0020500001', actions: [
  { actionNumber: 2, clock: 'PT11M40.00S', period: 1, teamTricode: 'LAC', personId: 1, actionType: 'Made Shot', subType: 'Jump Shot', shotValue: 3, scoreHome: '3', scoreAway: '0', description: "Brand 26' 3PT Jump Shot (3 PTS) (Cassell 1 AST)" },
  { actionNumber: 3, clock: 'PT11M20.00S', period: 1, teamTricode: 'NJN', personId: 2, actionType: 'Missed Shot', subType: 'Layup', shotValue: 2, scoreHome: '', scoreAway: '', description: 'MISS Kidd Layup' },
  { actionNumber: 4, clock: 'PT11M10.00S', period: 1, teamTricode: 'NJN', personId: 2, actionType: 'Free Throw', subType: 'Free Throw 1 of 2', scoreHome: '', scoreAway: '', description: 'MISS Kidd Free Throw 1 of 2' },
  { actionNumber: 5, clock: 'PT11M10.00S', period: 1, teamTricode: 'NJN', personId: 2, actionType: 'Free Throw', subType: 'Free Throw 2 of 2', scoreHome: '3', scoreAway: '1', description: 'Kidd Free Throw 2 of 2 (1 PTS)' },
] } };

describe('normalizePbp (cdn)', () => {
  const pbp = normalizePbp(CDN, 'cdn');
  it('classifies shots, rebounds and free throws', () => {
    expect(pbp.hasDefensiveCredits).toBe(true);
    expect(pbp.events.map((e) => e.kind)).toEqual(['other', 'fg', 'fg', 'rebound', 'ft']);
    expect(pbp.events[1]).toMatchObject({ seq: 2, made: true, shotValue: 3, teamTricode: 'LAC', personId: 202695, assistPersonId: 201935, points: 3, scoringSide: 'home', elapsedSec: 20 });
    expect(pbp.events[2]).toMatchObject({ made: false, shotValue: 2, points: 0, scoringSide: null });
  });
  it('handles overtime clocks and away scoring', () => {
    expect(pbp.events[4]).toMatchObject({ period: 5, elapsedSec: 2880, made: true, shotValue: 1, points: 1, scoringSide: 'away', scoreHome: 3, scoreAway: 1 });
  });
});

describe('normalizePbp (stats v3)', () => {
  const pbp = normalizePbp(STATS, 'stats_pbp');
  it('carries the score forward when the provider leaves it blank', () => {
    expect(pbp.events.map((e) => [e.scoreHome, e.scoreAway])).toEqual([[3, 0], [3, 0], [3, 0], [3, 1]]);
  });
  it('reads made/missed free throws from the description and drops assist ids', () => {
    expect(pbp.hasDefensiveCredits).toBe(false);
    expect(pbp.events[2]).toMatchObject({ kind: 'ft', made: false, points: 0 });
    expect(pbp.events[3]).toMatchObject({ kind: 'ft', made: true, points: 1, scoringSide: 'away' });
    expect(pbp.events[0].assistPersonId).toBeNull();
  });
  it('normalizes historical tricodes', () => {
    expect(pbp.events[1].teamTricode).toBe('BKN');
  });
});

// Real samples saved by scripts/dev/capture-pbp-fixture.ts. Every made shot and
// free throw must add up to the final score — this validates classification.
const FIXTURES = path.join(__dirname, '__fixtures__');
const real = fs.existsSync(FIXTURES) ? fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.json')) : [];
describe.skipIf(real.length === 0)('normalizePbp on captured games', () => {
  for (const file of real) {
    it(`${file}: made shots + free throws equal the final score`, () => {
      const source = file.startsWith('cdn-') ? 'cdn' : 'stats_pbp';
      const pbp = normalizePbp(JSON.parse(fs.readFileSync(path.join(FIXTURES, file), 'utf8')), source);
      const last = pbp.events[pbp.events.length - 1];
      const fromShots = pbp.events.reduce((s, e) => s + (e.made ? (e.shotValue ?? 0) : 0), 0);
      expect(pbp.events.length).toBeGreaterThan(300);
      expect(fromShots).toBe(last.scoreHome + last.scoreAway);
    });
  }
});
