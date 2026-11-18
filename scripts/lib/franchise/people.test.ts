import { describe, expect, it } from 'vitest';
import type { RosterRow } from './bbref-tables.js';
import { buildIndex, matchPeople, resolveRef, type DbPlayer } from './people.js';

const row = (bbrefId: string, name: string, birthdate: string | null = null): RosterRow => ({ bbrefId, name, number: null, birthdate });
const db = (player_id: string, nba_person_id: number | null, display_name: string, birthdate: string | null): DbPlayer => ({
  player_id, nba_person_id, display_name, birthdate,
});

describe('people crosswalk', () => {
  it('matches on name plus birthdate', () => {
    const r = matchPeople(
      [row('jamesle01', 'LeBron James', '1984-12-30'), row('smithjo01', 'Joe Smith', '1975-07-26')],
      [db('1', 2544, 'LeBron James', '1984-12-30'), db('2', 11, 'Joe Smith', '1975-07-26'), db('3', 12, 'Joe Smith', '1980-01-01')],
    );
    expect(r.unmatched).toEqual([]);
    expect(r.ambiguous).toEqual([]);
    const lbj = r.people.find((p) => p.personKey === 'jamesle01')!;
    expect(lbj).toMatchObject({ kind: 'player', playerId: '1', nbaPersonId: 2544, birthdate: '1984-12-30' });
    expect(r.people.find((p) => p.personKey === 'smithjo01')!.playerId).toBe('2');
  });

  it('reports two same-name players without birthdates as ambiguous', () => {
    const r = matchPeople([row('smithjo01', 'Joe Smith')], [db('1', 11, 'Joe Smith', null), db('2', 12, 'Joe Smith', null)]);
    expect(r.ambiguous.map((x) => x.bbrefId)).toEqual(['smithjo01']);
    expect(r.people).toHaveLength(1);
    expect(r.people[0]).toMatchObject({ personKey: 'smithjo01', playerId: null, nbaPersonId: null });
  });

  it('matches a unique name when a birthdate is missing, and keeps unmatched rows as people', () => {
    const r = matchPeople([row('a01', 'Ann Lee'), row('b01', 'Bo Nobody', '1990-01-01')], [db('1', 5, 'Ann Lee', '1980-02-02')]);
    expect(r.people.find((p) => p.personKey === 'a01')!.playerId).toBe('1');
    expect(r.unmatched.map((x) => x.bbrefId)).toEqual(['b01']);
    expect(r.people.find((p) => p.personKey === 'b01')!.playerId).toBeNull();
  });

  it('does not match a same-name player with a different birthdate', () => {
    const r = matchPeople([row('a01', 'Ann Lee', '1990-01-01')], [db('1', 5, 'Ann Lee', '1980-02-02')]);
    expect(r.unmatched).toHaveLength(1);
  });

  it('dedupes a player appearing on several rosters', () => {
    const r = matchPeople([row('a01', 'Ann Lee'), row('a01', 'Ann Lee', '1980-02-02')], []);
    expect(r.people).toHaveLength(1);
    expect(r.people[0].birthdate).toBe('1980-02-02');
  });

  it("resolves a wikipedia name through that season's roster", () => {
    const people = matchPeople([row('smithjo01', 'Joe Smith'), row('smithjo02', 'Joe Smith')], []).people;
    const idx = buildIndex(people, new Map([[1995, [row('smithjo01', 'Joe Smith')]], [2010, [row('smithjo02', 'Joe Smith')]]]));
    expect(resolveRef({ name: 'Joe Smith' }, idx, 1995)).toBe('smithjo01');
    expect(resolveRef({ name: 'Joe Smith' }, idx, 1996)).toBe('smithjo01');
    expect(resolveRef({ name: 'Joe Smith' }, idx, 2010)).toBe('smithjo02');
  });

  it('returns null for a name on no nearby roster with several all-time matches', () => {
    const people = matchPeople([row('smithjo01', 'Joe Smith'), row('smithjo02', 'Joe Smith')], []).people;
    const idx = buildIndex(people, new Map([[1995, [row('smithjo01', 'Joe Smith')]], [2010, [row('smithjo02', 'Joe Smith')]]]));
    expect(resolveRef({ name: 'Joe Smith' }, idx, 2002)).toBeNull();
  });

  it('falls back to a unique all-time name, and resolves ids first', () => {
    const people = matchPeople([row('jamesle01', 'LeBron James', '1984-12-30')], [db('1', 2544, 'LeBron James', '1984-12-30')]).people;
    const idx = buildIndex(people, new Map());
    expect(resolveRef({ name: 'Lebron James Jr.' }, idx, 2020)).toBe('jamesle01');
    expect(resolveRef({ name: 'x', bbrefId: 'jamesle01' }, idx, 1990)).toBe('jamesle01');
    expect(resolveRef({ name: 'x', nbaPersonId: 2544 }, idx, 1990)).toBe('jamesle01');
    expect(resolveRef({ name: 'x', nbaPersonId: 999 }, idx, 1990)).toBe('nba:999');
    expect(resolveRef({ name: 'Nobody Here' }, idx, 1990)).toBeNull();
  });
});
