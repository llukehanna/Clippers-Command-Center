// scripts/lib/franchise/write-people.ts
// The people half of the franchise writer: person_xref upserts, the `nba:` -> BBRef person merge (spec §3.4
// "People"), the players.nba_person_id fill, and resolving a move part to its person key.
import type { Db } from '../history/write.js';
import type { PersonRow } from './people.js';
import type { FranchiseDataset, MovePart } from './types.js';
import { bump, chunks, upsert, type Row, type WriteMode, type WriteResult } from './write-common.js';

const PERSON_REFS: Array<{ table: string; col: string; same?: string[] }> = [
  { table: 'transaction_parts', col: 'person_key' },
  { table: 'draft_picks', col: 'selected_person' },
  { table: 'salaries', col: 'person_key', same: ['season_id'] },
  { table: 'contracts', col: 'person_key', same: ['snapshot_id', 'season_id'] },
  { table: 'coach_seasons', col: 'person_key', same: ['season_id', 'ordinal'] },
  { table: 'executive_terms', col: 'person_key', same: ['title', 'start_date'] },
  { table: 'honors', col: 'person_key', same: ['season_id', 'honor'] },
];

/**
 * Merges person `fromKey` into `toKey`. With no `toKey` row the key is renamed and every reference follows by
 * ON UPDATE CASCADE. Otherwise references are repointed (a `fromKey` row that would duplicate one of `toKey`'s is
 * deleted), `toKey` fills its null columns from `fromKey`, and the `fromKey` row is deleted.
 */
export async function mergePerson(tx: Db, fromKey: string, toKey: string): Promise<void> {
  if (fromKey === toKey) return;
  const [target] = await tx`SELECT 1 FROM person_xref WHERE person_key = ${toKey}`;
  if (!target) {
    await tx`UPDATE person_xref SET person_key = ${toKey} WHERE person_key = ${fromKey}`;
    return;
  }
  for (const r of PERSON_REFS) {
    if (r.same) {
      const same = r.same.map((c) => `a.${c} IS NOT DISTINCT FROM b.${c}`).join(' AND ');
      await tx.unsafe(
        `DELETE FROM ${r.table} a WHERE a.${r.col} = $1 AND EXISTS (SELECT 1 FROM ${r.table} b WHERE b.${r.col} = $2 AND ${same})`,
        [fromKey, toKey]);
    }
    await tx.unsafe(`UPDATE ${r.table} SET ${r.col} = $2 WHERE ${r.col} = $1`, [fromKey, toKey]);
  }
  await tx`
    UPDATE person_xref t SET birthdate = COALESCE(t.birthdate, f.birthdate),
      nba_person_id = COALESCE(t.nba_person_id, f.nba_person_id), player_id = COALESCE(t.player_id, f.player_id)
    FROM person_xref f WHERE t.person_key = ${toKey} AND f.person_key = ${fromKey}`;
  await tx`DELETE FROM person_xref WHERE person_key = ${fromKey}`;
}

/** Every person_xref row after the people write: keys, nba ids (unambiguous only) and display names. */
export interface People { keys: Set<string>; byNba: Map<number, string>; name: Map<string, string> }

const personRow = (p: PersonRow): Row => ({
  person_key: p.personKey, kind: p.kind, display_name: p.displayName, birthdate: p.birthdate,
  nba_person_id: p.nbaPersonId, player_id: p.playerId,
});

export async function writePeople(tx: Db, data: FranchiseDataset, mode: WriteMode, res: WriteResult): Promise<People> {
  const people = new Map<string, PersonRow>(data.people.map((p) => [p.personKey, p]));
  // Coaches and executives carry their BBRef id and name; they need a person row to be written at all. These rows
  // only fill: an existing row keeps its kind and name.
  const extras = new Map<string, PersonRow>();
  const extra = (personKey: string, kind: PersonRow['kind'], displayName: string) => {
    if (!people.has(personKey) && !extras.has(personKey)) {
      extras.set(personKey, { personKey, kind, displayName, birthdate: null, nbaPersonId: null, playerId: null });
    }
  };
  for (const c of data.coachSeasons) if (c.bbrefId) extra(c.bbrefId, 'coach', c.name);
  for (const e of data.execTerms) if (e.personKey) extra(e.personKey, 'executive', e.name);

  const nbaOnly = new Set((await tx<{ person_key: string }[]>`
    SELECT person_key FROM person_xref WHERE person_key LIKE 'nba:%'`).map((r) => r.person_key));
  for (const p of people.values()) {
    const from = `nba:${p.nbaPersonId}`;
    if (p.nbaPersonId == null || p.personKey.startsWith('nba:') || !nbaOnly.has(from)) continue;
    await mergePerson(tx, from, p.personKey);
    nbaOnly.delete(from);
    res.merged++;
  }

  const main = await upsert(tx, 'person_xref', ['person_key'], [...people.values()].map(personRow),
    mode.kind === 'import' ? 'overwrite' : 'fill', ['birthdate', 'nba_person_id', 'player_id']);
  const added = await upsert(tx, 'person_xref', ['person_key'], [...extras.values()].map(personRow), 'fill');
  bump(res.inserted, 'person_xref', main.ins + added.ins);
  bump(res.updated, 'person_xref', main.upd + added.upd);

  // players: only fill a NULL nba_person_id, and never with an id another player (or another person here) holds.
  const fills = [...people.values()].filter((p) => p.playerId != null && p.nbaPersonId != null);
  const idCount = new Map<number, number>();
  for (const p of fills) idCount.set(p.nbaPersonId!, (idCount.get(p.nbaPersonId!) ?? 0) + 1);
  const unique = fills.filter((p) => idCount.get(p.nbaPersonId!) === 1);
  for (const batch of chunks(unique)) {
    const u = await tx`
      UPDATE players p SET nba_person_id = v.nid, updated_at = now()
      FROM unnest(${batch.map((x) => x.playerId!)}::bigint[], ${batch.map((x) => String(x.nbaPersonId))}::int[]) AS v(pid, nid)
      WHERE p.player_id = v.pid AND p.nba_person_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM players q WHERE q.nba_person_id = v.nid)`;
    bump(res.updated, 'players', u.count);
  }

  const all = await tx<{ person_key: string; display_name: string; nba_person_id: number | null }[]>`
    SELECT person_key, display_name, nba_person_id FROM person_xref`;
  const byNba = new Map<number, string>();
  const ambiguous = new Set<number>();
  for (const p of all) {
    if (p.nba_person_id == null) continue;
    if (byNba.has(p.nba_person_id) && byNba.get(p.nba_person_id) !== p.person_key) ambiguous.add(p.nba_person_id);
    byNba.set(p.nba_person_id, p.person_key);
  }
  for (const id of ambiguous) byNba.delete(id);
  return { keys: new Set(all.map((p) => p.person_key)), byNba, name: new Map(all.map((p) => [p.person_key, p.display_name])) };
}

/** `nba:<id>` -> the person now holding that id (a person merged this run), else the key if it still exists. */
function viaNbaId(id: number, people: People): string | null {
  return people.byNba.get(id) ?? (people.keys.has(`nba:${id}`) ? `nba:${id}` : null);
}

/** The person_xref key a part's person resolves to, or null (never invented). */
export function resolvePerson(p: MovePart, people: People): string | null {
  if (p.personKey) {
    if (people.keys.has(p.personKey)) return p.personKey;
    const m = /^nba:(\d+)$/.exec(p.personKey);
    return m ? viaNbaId(Number(m[1]), people) : null;
  }
  const ref = p.person;
  if (!ref) return null;
  if (ref.bbrefId && people.keys.has(ref.bbrefId)) return ref.bbrefId;
  return ref.nbaPersonId != null ? viaNbaId(ref.nbaPersonId, people) : null;
}
