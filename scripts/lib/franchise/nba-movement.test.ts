import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { parseMovement } from './nba-movement.js';

const sample = JSON.parse(
  readFileSync(new URL('../__fixtures__/franchise/nba/movement-sample.json', import.meta.url), 'utf8'),
);
const { moves, unparsed } = parseMovement(sample);
const LAC = NBA_TEAM_IDS.LAC;
const TOR = NBA_TEAM_IDS.TOR;
const byKey = (k: string) => moves.find((m) => m.sourceKey === k)!;

describe('parseMovement', () => {
  it('groups a four-row trade into one move with a draft consideration gap', () => {
    const trades = moves.filter((m) => m.kind === 'trade');
    expect(trades).toHaveLength(1);
    const t = trades[0];
    expect(t.sourceKey).toBe('nba:Trade 2026015');
    expect(t.date).toBe('2026-09-14');
    expect(t.involvesClippers).toBe(true);
    expect(t.complete).toBe(false);
    expect(t.parts).toHaveLength(4);
    const players = t.parts.filter((p) => p.kind === 'player').map((p) => [p.person!.name, p.person!.nbaPersonId, p.from, p.to]);
    expect(players).toEqual([
      ['Gradey Dick', 1641711, TOR, LAC],
      ['Brandon Ingram', 1627742, TOR, LAC],
      ['Kawhi Leonard', 202695, LAC, TOR],
    ]);
    const dc = t.parts.find((p) => p.kind === 'pick')!;
    expect(dc).toMatchObject({ from: TOR, to: LAC, gap: 'pick_unidentified' });
    expect(dc.pick).toBeUndefined();
    expect(unparsed).toEqual([]);
  });

  it('flags non-Clippers moves involvesClippers=false', () => {
    const m = byKey('nba:Signing 1158557:1643265');
    expect(m.involvesClippers).toBe(false);
    expect(byKey('nba:Signing 1157124:1631104').involvesClippers).toBe(true);
  });

  it('classifies two-way, 10-day, re-signed, converted, claim, waiver and plain rows', () => {
    expect(byKey('nba:Signing 1158557:1643265').kind).toBe('two_way');
    expect(byKey('nba:Signing 1157124:1631104').kind).toBe('ten_day');
    expect(byKey('nba:Signing 1155734:1641717').kind).toBe('re_signing');
    expect(byKey('nba:Signing 1157986:1631115').kind).toBe('signing');
    expect(byKey('nba:ContractConverted 1155732:1641871').kind).toBe('conversion');
    expect(byKey('nba:AwardedOnWaivers 1155740:1631166').kind).toBe('claim');
    const w = byKey('nba:Waive 1155519:1629671');
    expect(w.kind).toBe('waiver');
    expect(w.parts).toEqual([{ from: LAC, to: null, kind: 'player', person: { nbaPersonId: 1629671, name: 'Miye Oni' } }]);
    expect(byKey('nba:Signing 1157124:1631104').parts[0]).toMatchObject({ from: null, to: LAC, person: { name: 'Blake Wesley' } });
  });

  it('honours since', () => {
    const r = parseMovement(sample, '2026-10-20');
    expect(r.moves.map((m) => m.kind).sort()).toEqual(['signing', 'ten_day', 'two_way']);
  });

  it('sends a group with an unresolvable counterparty to unparsed', () => {
    const row = (desc: string, team: number, pid: number) => ({
      Transaction_Type: 'Trade', TRANSACTION_DATE: '2026-01-05T00:00:00', TRANSACTION_DESCRIPTION: desc,
      TEAM_ID: team, TEAM_SLUG: 'x', PLAYER_ID: pid, PLAYER_SLUG: 'x', Additional_Sort: 0, GroupSort: 'Trade 999',
    });
    const r = parseMovement({ NBA_Player_Movement: { rows: [row('LA Clippers received guard Foo Bar from Atlantis Krakens.', LAC, 5)] } });
    expect(r.moves).toEqual([]);
    expect(r.unparsed).toHaveLength(1);
    expect(r.unparsed[0]).toMatchObject({ source: 'nba', date: '2026-01-05' });
    expect(r.unparsed[0].text).toContain('Atlantis Krakens');
  });

  it('keeps the Jr. period on waiver and trade paths', () => {
    const base = { TRANSACTION_DATE: '2026-01-05T00:00:00', TEAM_SLUG: 'x', PLAYER_SLUG: 'x', Additional_Sort: 0 };
    const r = parseMovement({ NBA_Player_Movement: { rows: [
      { ...base, Transaction_Type: 'Waive', TRANSACTION_DESCRIPTION: 'LA Clippers waived guard Kevin Porter Jr.', TEAM_ID: LAC, PLAYER_ID: 7, GroupSort: 'Waive 1' },
      { ...base, Transaction_Type: 'Trade', TRANSACTION_DESCRIPTION: 'LA Clippers received guard Kevin Porter Jr. from Toronto Raptors.', TEAM_ID: LAC, PLAYER_ID: 7, GroupSort: 'Trade 2' },
      { ...base, Transaction_Type: 'Signing', TRANSACTION_DESCRIPTION: 'LA Clippers signed forward P.J. Washington to a Two-Way Contract.', TEAM_ID: LAC, PLAYER_ID: 9, GroupSort: 'Signing 3' },
    ] } });
    expect(r.unparsed).toEqual([]);
    expect(r.moves.map((m) => m.parts[0].person!.name)).toEqual(['Kevin Porter Jr.', 'Kevin Porter Jr.', 'P.J. Washington']);
  });
});
