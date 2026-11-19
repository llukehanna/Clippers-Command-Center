import { describe, expect, it } from 'vitest';
import {
  bestBars, deltaView, fmtNum, milestoneBar, miniDeltas, rankTicks, RANK_BUCKETS, SPARK_H, SPARK_W, sparkGeometry,
  streakBars, surname,
} from './kit-geometry';

describe('fmtNum', () => {
  it('formats integers with separators and decimals to one place', () => {
    expect(fmtNum(12)).toBe('12');
    expect(fmtNum(19612)).toBe('19,612');
    expect(fmtNum(14.83)).toBe('14.8');
  });
});

describe('rankTicks', () => {
  it('29th of 30 is a red "me" tick in the bottom five', () => {
    const t = rankTicks(29, 30)!;
    expect(t).toHaveLength(30);
    expect(t.slice(0, 5)).toEqual(['top5', 'top5', 'top5', 'top5', 'top5']);
    expect(t[5]).toBe('base');
    expect(t[28]).toBe('meBad');
    expect(t[25]).toBe('bot5');
    expect(t[29]).toBe('bot5');
  });

  it('3rd of 30 is a blue "me" tick', () => {
    const t = rankTicks(3, 30)!;
    expect(t[2]).toBe('me');
    expect(t.filter((k) => k === 'me' || k === 'meBad')).toHaveLength(1);
  });

  it('tied for 13th of 15 marks the tied rank after it', () => {
    const t = rankTicks(13, 15, 1)!;
    expect(t[12]).toBe('meBad');
    expect(t[13]).toBe('tie');
    expect(t[14]).toBe('bot5');
  });

  it('a field under 10 never reads as bottom five', () => {
    expect(rankTicks(8, 8)![7]).toBe('me');
  });

  it('a large field buckets into a fixed number of ticks with one "me"', () => {
    const t = rankTicks(150, 300)!;
    expect(t).toHaveLength(RANK_BUCKETS);
    expect(t.filter((k) => k === 'me' || k === 'meBad')).toHaveLength(1);
    expect(t[14]).toBe('me');
    expect(t[0]).toBe('top5');
    expect(t[29]).toBe('bot5');
    expect(rankTicks(300, 300)![29]).toBe('meBad');
    expect(rankTicks(1, 300)![0]).toBe('me');
  });

  it('impossible inputs draw nothing', () => {
    expect(rankTicks(0, 30)).toBeNull();
    expect(rankTicks(31, 30)).toBeNull();
    expect(rankTicks(1, 1)).toBeNull();
    expect(rankTicks(Number.NaN, 30)).toBeNull();
    expect(rankTicks(2.5, 30)).toBeNull();
  });
});

describe('streakBars', () => {
  it('scales to 70% of 1.1 x the max, keeping the hit flag', () => {
    const b = streakBars([{ value: 22, hit: true }, { value: 10, hit: false }], 20)!;
    expect(b[0]).toEqual({ value: 22, hit: true, pct: (22 / (22 * 1.1)) * 70 });
    expect(b[1].hit).toBe(false);
    expect(b[1].pct).toBeCloseTo((10 / 24.2) * 70);
  });

  it('the threshold sets the scale when every game is under it', () => {
    expect(streakBars([{ value: 5, hit: false }], 20)![0].pct).toBeCloseTo((5 / 22) * 70);
  });

  it('no games or bad values draw nothing', () => {
    expect(streakBars([], 20)).toBeNull();
    expect(streakBars([{ value: Number.NaN, hit: true }], 20)).toBeNull();
  });

  it('all zeros give flat bars, not NaN', () => {
    expect(streakBars([{ value: 0, hit: false }], 0)![0].pct).toBe(0);
  });
});

describe('sparkGeometry', () => {
  it('maps time to x and margin to y around the midline', () => {
    const g = sparkGeometry([[0, 0], [100, 10], [200, -10]])!;
    expect(g.line).toBe(`M0.0,${(SPARK_H / 2).toFixed(1)}L150.0,3.0L300.0,53.0`);
    expect(g.area).toBe(`${g.line}L${SPARK_W},28L0,28Z`);
    expect(g.mid).toBe(28);
    expect(g.highlight).toBeNull();
  });

  it('draws the highlight band in x units', () => {
    const g = sparkGeometry([[0, 0], [200, 4]], { from: 50, to: 100 })!;
    expect(g.highlight).toEqual({ x: 75, width: 75 });
  });

  it('a highlight starting at tip-off still draws', () => {
    expect(sparkGeometry([[0, 0], [200, 4]], { from: 0, to: 100 })!.highlight).toEqual({ x: 0, width: 150 });
  });

  it('a flat game does not divide by zero', () => {
    expect(sparkGeometry([[0, 0], [10, 0]])!.line).toBe('M0.0,28.0L300.0,28.0');
  });

  it('fewer than two points or no elapsed time draws nothing', () => {
    expect(sparkGeometry([[0, 0]])).toBeNull();
    expect(sparkGeometry([[0, 0], [0, 3]])).toBeNull();
    expect(sparkGeometry([[0, 0], [10, Number.NaN]])).toBeNull();
  });
});

describe('milestoneBar', () => {
  it('reports the fill and what is left', () => {
    expect(milestoneBar(19612, 20000)).toEqual({ pct: (19612 / 20000) * 100, remaining: 388 });
  });

  it('caps at 100% once reached', () => {
    expect(milestoneBar(503, 500)).toEqual({ pct: 100, remaining: 0 });
  });

  it('a zero target draws nothing', () => {
    expect(milestoneBar(5, 0)).toBeNull();
  });
});

describe('bestBars', () => {
  it('sizes both bars against the larger value', () => {
    expect(bestBars(20, 26)).toEqual({ prevPct: (20 / 26) * 100, valuePct: 100 });
  });

  it('zero or negative values draw nothing', () => {
    expect(bestBars(0, 0)).toBeNull();
    expect(bestBars(-1, 4)).toBeNull();
  });
});

describe('deltaView', () => {
  it('a rise where higher is better is a better change', () => {
    expect(deltaView(8.5, 14.8, true)).toEqual({ before: '8.5', after: '14.8', change: '+6.3', better: true });
  });

  it('a rise where lower is better is a worse change', () => {
    expect(deltaView(110, 115.5, false)).toMatchObject({ change: '+5.5', better: false });
  });

  it('a fall uses a true minus sign', () => {
    expect(deltaView(12, 9, true)).toMatchObject({ change: '−3', better: false });
  });

  it('no change has no change label', () => {
    expect(deltaView(5, 5, true)).toMatchObject({ change: null, better: false });
  });
});

describe('miniDeltas', () => {
  it('places each rank on the 1st..total track (mockup: 10th → 22nd of 30)', () => {
    const m = miniDeltas([{ label: 'Offense', from: 10, to: 22, total: 30 }])!;
    expect(m.rows[0]).toEqual({
      label: 'Offense', from: 31, to: 72.4, lineLeft: 31, lineWidth: 41.4, worse: true, fromText: '10th', toText: '22nd',
    });
    expect(m.axisEnd).toBe('30th');
  });

  it('an improvement is not worse and the line starts at the new rank', () => {
    const r = miniDeltas([{ label: 'Defense', from: 25, to: 18, total: 30 }])!.rows[0];
    expect(r.worse).toBe(false);
    expect(r.lineLeft).toBe(r.to);
  });

  it('rows with impossible ranks are dropped; none left draws nothing', () => {
    expect(miniDeltas([{ label: 'Net', from: 0, to: 5, total: 30 }])).toBeNull();
    expect(miniDeltas([{ label: 'Net', from: 3, to: 5, total: 1 }])).toBeNull();
    expect(miniDeltas([])).toBeNull();
  });
});

describe('surname', () => {
  it('takes the last name and drops suffixes', () => {
    expect(surname('Kawhi Leonard')).toBe('Leonard');
    expect(surname('Derrick Jones Jr.')).toBe('Jones');
    expect(surname('Nene')).toBe('Nene');
  });
});
