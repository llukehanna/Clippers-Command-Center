// scripts/lib/history/match-players.ts
// Map Kaggle (NBA.com personId) people onto players rows keyed by balldontlie
// ids. A wrong match merges two humans' stats, so every doubtful case is
// reported as ambiguous (or created) instead of guessed. Pure; no DB imports.

import { normalizePersonName } from '../player-match.js';
import type { KagglePerson } from './kaggle.js';

export type DbPlayer = {
  player_id: string;
  nba_person_id: number | null;
  display_name: string;
  birthdate: string | null;
};

export type MatchResult = {
  matched: Map<number, string>;
  backfillNbaId: Array<{ player_id: string; nba_person_id: number }>;
  toCreate: KagglePerson[];
  ambiguous: Array<{ person: KagglePerson; candidates: string[] }>;
};

const personKey = (p: KagglePerson) => normalizePersonName(`${p.firstName} ${p.lastName}`);
const bothPresent = (a: string | null, b: string | null) => !!a && !!b;
const birthEqual = (a: string | null, b: string | null) => bothPresent(a, b) && a === b;
const birthConflict = (a: string | null, b: string | null) => bothPresent(a, b) && a !== b;
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export function matchPlayers(people: KagglePerson[], db: DbPlayer[]): MatchResult {
  const sortedPeople = [...people].sort((a, b) => a.personId - b.personId);
  const rows = [...db].sort((a, b) => cmp(a.player_id, b.player_id));

  const matchedMap = new Map<number, string>();
  const backfill: Array<{ player_id: string; nba_person_id: number }> = [];
  const ambiguous: Array<{ person: KagglePerson; candidates: string[] }> = [];
  const claimed = new Set<string>();
  const done = new Set<number>(); // personIds fully resolved (matched or ambiguous)

  const markAmbiguous = (person: KagglePerson, candidates: string[]) => {
    ambiguous.push({ person, candidates: [...candidates].sort(cmp) });
    done.add(person.personId);
  };
  const markMatched = (person: KagglePerson, row: DbPlayer, viaName: boolean) => {
    matchedMap.set(person.personId, row.player_id);
    claimed.add(row.player_id);
    done.add(person.personId);
    if (viaName) backfill.push({ player_id: row.player_id, nba_person_id: person.personId });
  };

  // Pass 1: exact nba_person_id.
  for (const p of sortedPeople) {
    const hits = rows.filter((r) => r.nba_person_id === p.personId);
    if (hits.length === 0) continue;
    if (hits.length === 1 && !claimed.has(hits[0].player_id)) markMatched(p, hits[0], false);
    else markAmbiguous(p, hits.map((r) => r.player_id));
  }

  // Only rows without an NBA id may be name-matched; a row with a different id
  // is a different human.
  const pool = rows.filter((r) => r.nba_person_id === null && !claimed.has(r.player_id));
  const rowKey = new Map(pool.map((r) => [r.player_id, normalizePersonName(r.display_name)]));

  // Pass 2: normalized name + equal birthdate.
  const pass2 = new Map<number, DbPlayer[]>();
  const rowUsers = new Map<string, number>();
  for (const p of sortedPeople) {
    if (done.has(p.personId)) continue;
    const key = personKey(p);
    if (!key) continue;
    const cands = pool.filter((r) => rowKey.get(r.player_id) === key && birthEqual(p.birthdate, r.birthdate));
    if (cands.length === 0) continue;
    pass2.set(p.personId, cands);
    for (const r of cands) rowUsers.set(r.player_id, (rowUsers.get(r.player_id) ?? 0) + 1);
  }
  const pass2Matches: Array<[KagglePerson, DbPlayer]> = [];
  for (const p of sortedPeople) {
    const cands = pass2.get(p.personId);
    if (!cands) continue;
    if (cands.length === 1 && rowUsers.get(cands[0].player_id) === 1) pass2Matches.push([p, cands[0]]);
    else markAmbiguous(p, cands.map((r) => r.player_id));
  }
  for (const [p, r] of pass2Matches) markMatched(p, r, true);

  // Pass 3: name alone, only when it is unambiguous on both sides.
  const nameCount = new Map<string, number>();
  for (const p of sortedPeople) nameCount.set(personKey(p), (nameCount.get(personKey(p)) ?? 0) + 1);
  const toCreate: KagglePerson[] = [];
  for (const p of sortedPeople) {
    if (done.has(p.personId)) continue;
    const key = personKey(p);
    const nameRows = key ? pool.filter((r) => !claimed.has(r.player_id) && rowKey.get(r.player_id) === key) : [];
    const compatible = nameRows.filter((r) => !birthConflict(p.birthdate, r.birthdate));
    if (compatible.length === 0) {
      toCreate.push(p);
    } else if (nameRows.length === 1 && nameCount.get(key) === 1) {
      markMatched(p, compatible[0], true);
    } else {
      markAmbiguous(p, compatible.map((r) => r.player_id));
    }
  }

  const matched = new Map([...matchedMap.entries()].sort((a, b) => a[0] - b[0]));
  backfill.sort((a, b) => a.nba_person_id - b.nba_person_id);
  ambiguous.sort((a, b) => a.person.personId - b.person.personId);
  return { matched, backfillNbaId: backfill, toCreate, ambiguous };
}
