import { describe, it, expect } from 'vitest';
import { injuryText, parseEspnInjuries, statusRank } from './injuries';

const inj = (name: string, abbr: string, status: string, details: Record<string, unknown> | undefined) => ({
  status,
  date: '2026-11-17T01:07Z',
  athlete: { displayName: name, team: { abbreviation: abbr } },
  details,
  shortComment: 'Rotowire text that must never be surfaced',
});

describe('injuryText', () => {
  it('builds "Left ankle soreness" from side, type and detail', () => {
    expect(injuryText({ type: 'Ankle', side: 'Left', detail: 'Soreness' })).toBe('Left ankle soreness');
  });
  it('drops missing or unspecified parts', () => {
    expect(injuryText({ type: 'Back', side: null, detail: 'Soreness' })).toBe('Back soreness');
    expect(injuryText({ type: 'Knee', side: 'Not Specified', detail: null })).toBe('Knee');
    expect(injuryText({})).toBeNull();
    expect(injuryText(undefined)).toBeNull();
  });
});

describe('statusRank', () => {
  it('orders Out before Doubtful, Questionable, Day-To-Day and Probable', () => {
    const order = ['Probable', 'Day-To-Day', 'Out', 'Questionable', 'Doubtful'].sort((a, b) => statusRank(a) - statusRank(b));
    expect(order).toEqual(['Out', 'Doubtful', 'Questionable', 'Day-To-Day', 'Probable']);
  });
});

describe('parseEspnInjuries', () => {
  it('groups by NBA tricode, sorts by status then name, and never keeps comments', () => {
    const report = parseEspnInjuries({
      timestamp: '2026-11-18T04:23:54Z',
      injuries: [
        { id: '12', injuries: [
          inj('Bradley Beal', 'LAC', 'Out', { type: 'Hip', side: 'Right', detail: 'Inflammation', returnDate: '2026-11-20' }),
          inj('Aaron Able', 'LAC', 'Day-To-Day', { type: 'Ankle', side: 'Left', detail: 'Sprain', returnDate: '2026-11-18' }),
        ] },
        { id: '24', injuries: [inj('Spurs Guy', 'SA', 'Out', { type: 'Calf' })] },
      ],
    });
    expect(report.fetched_at).toBe('2026-11-18T04:23:54Z');
    expect(report.byTeam.LAC.map((e) => e.name)).toEqual(['Bradley Beal', 'Aaron Able']);
    expect(report.byTeam.LAC[0]).toEqual({
      name: 'Bradley Beal', status: 'Out', injury: 'Right hip inflammation', return_date: '2026-11-20', updated: '2026-11-17T01:07Z',
    });
    expect(report.byTeam.SAS).toHaveLength(1);
    expect(JSON.stringify(report)).not.toContain('Rotowire');
  });
  it('tolerates junk', () => {
    expect(parseEspnInjuries(null)).toEqual({ fetched_at: null, byTeam: {} });
  });
});
