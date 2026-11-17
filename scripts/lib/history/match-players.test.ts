import { describe, it, expect } from 'vitest';
import { matchPlayers, type DbPlayer } from './match-players.js';
import type { KagglePerson } from './kaggle.js';

const person = (personId: number, firstName: string, lastName: string, birthdate: string | null = null): KagglePerson => ({
  personId,
  firstName,
  lastName,
  birthdate,
});
const row = (player_id: string, display_name: string, nba_person_id: number | null = null, birthdate: string | null = null): DbPlayer => ({
  player_id,
  nba_person_id,
  display_name,
  birthdate,
});

describe('matchPlayers', () => {
  it('matches on nba_person_id first', () => {
    const r = matchPlayers([person(2544, 'LeBron', 'James')], [row('bdl1', 'Someone Else', 2544)]);
    expect(r.matched.get(2544)).toBe('bdl1');
    expect(r.backfillNbaId).toEqual([]);
    expect(r.toCreate).toEqual([]);
  });

  it('matches name + birthdate and queues the NBA id backfill', () => {
    const r = matchPlayers(
      [person(1, 'Charles', 'Smith', '1970-07-16')],
      [row('a', 'Charles Smith', null, '1965-01-01'), row('b', 'Charles Smith', null, '1970-07-16')]
    );
    expect(r.matched.get(1)).toBe('b');
    expect(r.backfillNbaId).toEqual([{ player_id: 'b', nba_person_id: 1 }]);
  });

  it('matches a unique name without birthdate', () => {
    const r = matchPlayers([person(5, 'Nikola', 'Jokić')], [row('x', 'Nikola Jokic')]);
    expect(r.matched.get(5)).toBe('x');
    expect(r.backfillNbaId).toEqual([{ player_id: 'x', nba_person_id: 5 }]);
  });

  it('reports same-name players without birthdates as ambiguous', () => {
    const r = matchPlayers([person(9, 'Charles', 'Smith')], [row('a', 'Charles Smith'), row('b', 'Charles Smith')]);
    expect(r.matched.size).toBe(0);
    expect(r.ambiguous).toHaveLength(1);
    expect(r.ambiguous[0].candidates.length).toBe(2);
    expect(r.toCreate).toEqual([]);
  });

  it('never assigns one DB row to two people', () => {
    const r = matchPlayers([person(1, 'Charles', 'Smith'), person(2, 'Charles', 'Smith')], [row('a', 'Charles Smith')]);
    expect(r.matched.size).toBe(0);
    expect(r.ambiguous.map((a) => a.person.personId)).toEqual([1, 2]);
    const r2 = matchPlayers(
      [person(1, 'Charles', 'Smith', '1970-01-01'), person(2, 'Charles', 'Smith', '1970-01-01')],
      [row('a', 'Charles Smith', null, '1970-01-01')]
    );
    expect(r2.matched.size).toBe(0);
    expect(r2.ambiguous).toHaveLength(2);
  });

  it('creates unknown players', () => {
    const r = matchPlayers([person(7, 'New', 'Guy')], [row('a', 'Old Guy')]);
    expect(r.toCreate.map((p) => p.personId)).toEqual([7]);
  });

  it('never name-matches a DB row that has a different nba_person_id', () => {
    const r = matchPlayers([person(10, 'Chris', 'Paul')], [row('a', 'Chris Paul', 999)]);
    expect(r.matched.size).toBe(0);
    expect(r.toCreate.map((p) => p.personId)).toEqual([10]);
  });

  it('reports a sole name match with a conflicting birthdate as ambiguous', () => {
    const r = matchPlayers([person(3, 'Mike', 'James', '1975-08-18')], [row('a', 'Mike James', null, '1990-08-18')]);
    expect(r.matched.size).toBe(0);
    expect(r.toCreate).toEqual([]);
    expect(r.ambiguous).toEqual([{ person: person(3, 'Mike', 'James', '1975-08-18'), candidates: ['a'] }]);
  });

  it('ignores people already settled by nba_person_id when checking name uniqueness', () => {
    const r = matchPlayers(
      [person(1, 'Charles', 'Smith'), person(2, 'Charles', 'Smith')],
      [row('a', 'Charles Smith', 1), row('b', 'Charles Smith')]
    );
    expect(r.matched.get(1)).toBe('a');
    expect(r.matched.get(2)).toBe('b');
    expect(r.backfillNbaId).toEqual([{ player_id: 'b', nba_person_id: 2 }]);
  });

  it('is deterministic regardless of input order', () => {
    const people = [person(30, 'Zed', 'New'), person(10, 'Amy', 'New'), person(20, 'Bob', 'Dup')];
    const db = [row('a', 'Bob Dup'), row('b', 'Bob Dup')];
    const r1 = matchPlayers(people, db);
    const r2 = matchPlayers([...people].reverse(), [...db].reverse());
    expect(r2).toEqual(r1);
    expect(r1.toCreate.map((p) => p.personId)).toEqual([10, 30]);
    expect(r1.ambiguous[0].candidates).toEqual(['a', 'b']);
  });
});
