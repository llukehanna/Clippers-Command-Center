import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { parseEspnDraftRounds, parseEspnTransactions } from './espn.js';

const fx = (n: string) => JSON.parse(readFileSync(new URL(`../__fixtures__/franchise/espn/${n}`, import.meta.url), 'utf8'));
const LAC = NBA_TEAM_IDS.LAC;

describe('parseEspnDraftRounds', () => {
  it('reads tradeNote by overall pick', () => {
    const r = parseEspnDraftRounds(fx('draft-2018-round1.json'), 2018);
    expect(r).toEqual([
      { overall: 1, tradeNote: null },
      { overall: 3, tradeNote: 'Rights traded to DAL' },
      { overall: 8, tradeNote: 'From BOS through BKN' },
      { overall: 25, tradeNote: 'From CLE' },
    ]);
  });
});

describe('parseEspnTransactions', () => {
  const roster = [
    { name: 'Cam Christie', nbaPersonId: 1641717 },
    { name: 'Miye Oni', nbaPersonId: 1629671 },
    { name: 'Blake Wesley', nbaPersonId: 1631104 },
  ];
  const { moves, unparsed } = parseEspnTransactions(fx('transactions.json'), roster);

  it('splits "Waived Gs A, B and C." into three waivers', () => {
    const w = moves.filter((m) => m.kind === 'waiver' && m.date === '2026-10-17');
    expect(w.map((m) => [m.parts[0].person!.name, m.parts[0].person!.nbaPersonId])).toEqual([
      ['Miye Oni', 1629671], ['Jahmyl Telfort', undefined], ['Blake Wesley', 1631104],
    ]);
    expect(new Set(w.map((m) => m.sourceKey)).size).toBe(3);
    expect(w[0].parts[0]).toMatchObject({ from: LAC, to: null });
    expect(w.every((m) => m.sourceKey.startsWith('espn:2026-10-17:'))).toBe(true);
  });

  it('parses signings, single waivers, acquisitions and re-signings', () => {
    expect(moves.find((m) => m.kind === 'two_way')!.parts[0]).toMatchObject({ to: LAC, person: { name: 'Cam Christie', nbaPersonId: 1641717 } });
    expect(moves.filter((m) => m.kind === 'waiver' && m.date === '2026-10-16')).toHaveLength(1);
    const t = moves.find((m) => m.kind === 'trade')!;
    expect(t.parts[0]).toMatchObject({ from: NBA_TEAM_IDS.CLE, to: LAC, person: { name: 'Max Strus' } });
    expect(t.involvesClippers).toBe(true);
    expect(moves.find((m) => m.kind === 're_signing')!.parts[0].person!.name).toBe('Kobe Sanders');
    expect(unparsed).toEqual([]);
  });

  it('puts unmatched sentences in unparsed', () => {
    const r = parseEspnTransactions({ transactions: [{ date: '2026-01-01T08:00Z', description: 'Did something odd.' }] }, roster);
    expect(r.moves).toEqual([]);
    expect(r.unparsed[0]).toMatchObject({ source: 'espn', date: '2026-01-01', text: 'Did something odd.' });
  });

  it('keeps initialed names whole and keeps Jr. periods', () => {
    const r = parseEspnTransactions({ transactions: [
      { date: '2026-03-01T08:00Z', description: 'Signed F P.J. Washington to a two-way contract. Waived G Kevin Porter Jr.' },
      { date: '2026-03-02T08:00Z', description: 'Waived Gs C.J. McCollum and Kevin Porter Jr.' },
    ] }, [{ name: 'Kevin Porter Jr.', nbaPersonId: 1630233 }, { name: 'P.J. Washington', nbaPersonId: 1629023 }]);
    expect(r.unparsed).toEqual([]);
    expect(r.moves.map((m) => [m.kind, m.parts[0].person!.name, m.parts[0].person!.nbaPersonId])).toEqual([
      ['two_way', 'P.J. Washington', 1629023],
      ['waiver', 'Kevin Porter Jr.', 1630233],
      ['waiver', 'C.J. McCollum', undefined],
      ['waiver', 'Kevin Porter Jr.', 1630233],
    ]);
  });

  it('matches roster names through normalization and leaves ambiguous ones unmatched', () => {
    const one = parseEspnTransactions({ transactions: [{ date: '2026-03-01T08:00Z', description: 'Waived G Kevin Porter Jr' }] },
      [{ name: 'Kevin Porter Jr.', nbaPersonId: 7 }]);
    expect(one.moves[0].parts[0].person).toEqual({ nbaPersonId: 7, name: 'Kevin Porter Jr' });
    const two = parseEspnTransactions({ transactions: [{ date: '2026-03-01T08:00Z', description: 'Waived G Kevin Porter' }] },
      [{ name: 'Kevin Porter Jr.', nbaPersonId: 7 }, { name: 'Kevin Porter', nbaPersonId: 8 }]);
    expect(two.moves[0].parts[0].person).toEqual({ name: 'Kevin Porter' });
  });
});
