// scripts/lib/franchise/write.ts
// Writes an assembled FranchiseDataset into Part 3's tables by stable natural keys (spec §1, §3.4).
//
// Ownership:
//   - import mode (scripts/import-franchise-history.ts) is the source of truth for the seasons it covers. It
//     overwrites what it writes and deletes its own stale rows: rows whose sources are ALL import-owned prefixes
//     and that the dataset no longer contains, in covered seasons only. A table the dataset carries no rows for is
//     never pruned (a partial run must not wipe it). People, picks, swaps and lottery rows are never deleted.
//   - job mode (nightly moves, weekly contracts) only adds rows or fills nulls; it never deletes. An existing
//     transaction is rewritten by a job only while it is incomplete.
// A move matches an existing row by key, then by a shared source key, then by adoptExisting (same event already
// stored under another key): the existing key and slug are kept, so URLs never change, and sources are unioned.
// A person stored as `nba:<id>` is merged into the BBRef row once the dataset gives that id (mergePerson).
// Rows that can't be written (no person_xref row for their person) are returned in `skipped`, never dropped silently.
// The whole write is one database transaction, after the storage guard. Unknown is null.
import { databaseBytes, type Db } from '../history/write.js';
import { describeMove, eraTeamName, seasonOfDate } from './describe.js';
import { tradeSlug } from './keys.js';
import type { PersonRow } from './people.js';
import type { MergedMove } from './reconcile-moves.js';
import type { FranchiseDataset, MoveKind, MovePart } from './types.js';

export type WriteMode = { kind: 'import'; importSources: string[] /* source prefixes this run owns */ } | { kind: 'job'; job: 'nightly' | 'weekly' };

export interface WriteOptions {
  /** Storage cap in MB; the write stops above 85% of it (Part 1's rule). Default 512. */
  capMb?: number;
  /** Seasons (start years) the import's cache covers; default: every season from the dataset's first to its last. */
  seasons?: number[];
}

export interface SkippedRow { table: string; reason: string; row: unknown }

export interface WriteResult {
  inserted: Record<string, number>;
  updated: Record<string, number>;
  deleted: Record<string, number>;
  /** People merged from an `nba:` key into their BBRef row. */
  merged: number;
  skipped: SkippedRow[];
}

type Value = string | number | boolean | null | string[] | ReturnType<Db['json']>;
type Row = Record<string, Value>;

const BATCH = 500;
const chunks = <T>(xs: T[], n = BATCH): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};
const WINDOW_DAYS = 3;
const GUARD_SHARE = 0.85;

// ---- helpers -----------------------------------------------------------------

function bump(c: Record<string, number>, table: string, n: number): void {
  if (n) c[table] = (c[table] ?? 0) + n;
}

/** Last row wins per key, so one INSERT … ON CONFLICT never touches a row twice. */
function dedupe(rows: Row[], key: string[]): Row[] {
  const m = new Map<string, Row>();
  for (const r of rows) m.set(JSON.stringify(key.map((k) => r[k])), r);
  return [...m.values()];
}

/**
 * INSERT … ON CONFLICT (key) DO UPDATE, only where something differs (so a repeat write changes nothing).
 * 'overwrite' takes the new value (or keeps the old one for `keep` columns when the new one is null);
 * 'fill' only fills nulls.
 */
async function upsert(
  tx: Db, table: string, key: string[], rows: Row[], how: 'overwrite' | 'fill', keep: string[] = [],
): Promise<{ ins: number; upd: number }> {
  let ins = 0, upd = 0;
  const all = dedupe(rows, key);
  if (!all.length) return { ins, upd };
  const cols = Object.keys(all[0]);
  const rest = cols.filter((c) => !key.includes(c));
  const expr = (c: string) =>
    how === 'fill' ? `COALESCE(${table}.${c}, EXCLUDED.${c})` : keep.includes(c) ? `COALESCE(EXCLUDED.${c}, ${table}.${c})` : `EXCLUDED.${c}`;
  const set = rest.map((c) => `${c} = ${expr(c)}`).join(', ');
  const differs = `(${rest.map((c) => `${table}.${c}`).join(', ')}) IS DISTINCT FROM (${rest.map(expr).join(', ')})`;
  for (const batch of chunks(all)) {
    const res = await tx<{ ins: boolean }[]>`
      INSERT INTO ${tx.unsafe(table)} ${tx(batch as never, cols)}
      ON CONFLICT (${tx.unsafe(key.join(', '))}) DO UPDATE SET ${tx.unsafe(set)} WHERE ${tx.unsafe(differs)}
      RETURNING (xmax = 0) AS ins`;
    for (const r of res) if (r.ins) ins++; else upd++;
  }
  return { ins, upd };
}

const likePrefix = (p: string) => `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function coveredSeasons(data: FranchiseDataset, opts: WriteOptions): string[] {
  if (opts.seasons) return opts.seasons.map(String);
  const s = [
    ...data.moves.filter((m) => m.date).map((m) => seasonOfDate(m.date)),
    ...data.salaries.map((r) => r.seasonId), ...data.coachSeasons.map((r) => r.seasonId),
    ...data.payrollSeasons.map((r) => r.seasonId),
  ].filter(Number.isFinite);
  if (!s.length) return [];
  const out: string[] = [];
  for (let y = Math.min(...s); y <= Math.max(...s); y++) out.push(String(y));
  return out;
}

// ---- people ------------------------------------------------------------------

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

interface People { keys: Set<string>; byNba: Map<number, string>; name: Map<string, string> }

async function writePeople(tx: Db, data: FranchiseDataset, mode: WriteMode, res: WriteResult): Promise<People> {
  const people = new Map<string, PersonRow>(data.people.map((p) => [p.personKey, p]));
  // Coaches and executives carry their BBRef id and name; they need a person row to be written at all.
  const extra = (personKey: string, kind: PersonRow['kind'], displayName: string) => {
    if (!people.has(personKey)) people.set(personKey, { personKey, kind, displayName, birthdate: null, nbaPersonId: null, playerId: null });
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

  const rows: Row[] = [...people.values()].map((p) => ({
    person_key: p.personKey, kind: p.kind, display_name: p.displayName, birthdate: p.birthdate,
    nba_person_id: p.nbaPersonId, player_id: p.playerId,
  }));
  const r = await upsert(tx, 'person_xref', ['person_key'], rows, mode.kind === 'import' ? 'overwrite' : 'fill',
    ['birthdate', 'nba_person_id', 'player_id']);
  bump(res.inserted, 'person_xref', r.ins);
  bump(res.updated, 'person_xref', r.upd);

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

function resolvePerson(p: MovePart, people: People): string | null {
  if (p.personKey) return people.keys.has(p.personKey) ? p.personKey : null;
  const ref = p.person;
  if (!ref) return null;
  if (ref.bbrefId && people.keys.has(ref.bbrefId)) return ref.bbrefId;
  if (ref.nbaPersonId != null) {
    return people.byNba.get(ref.nbaPersonId) ?? (people.keys.has(`nba:${ref.nbaPersonId}`) ? `nba:${ref.nbaPersonId}` : null);
  }
  return null;
}

// ---- picks, swaps, lottery ---------------------------------------------------

async function idsByKey(tx: Db, table: 'draft_picks' | 'pick_swaps', keys: string[]): Promise<Map<string, number>> {
  if (!keys.length) return new Map();
  const [idCol, keyCol] = table === 'draft_picks' ? ['pick_id', 'pick_key'] : ['swap_id', 'swap_key'];
  const rows = await tx<{ id: number; key: string }[]>`
    SELECT ${tx.unsafe(`${idCol} AS id, ${keyCol} AS key FROM ${table} WHERE ${keyCol}`)} = ANY(${[...new Set(keys)]}::text[])`;
  return new Map(rows.map((r) => [r.key, r.id]));
}

async function writePicks(tx: Db, data: FranchiseDataset, how: 'overwrite' | 'fill', people: People, res: WriteResult) {
  const json = (x: unknown) => (x == null ? null : tx.json(x as never));
  const picks: Row[] = data.picks.map((p) => {
    let selected = p.selectedPersonKey;
    if (selected && !people.keys.has(selected)) {
      res.skipped.push({ table: 'draft_picks.selected_person', reason: `no person_xref row for ${selected}; written as null`, row: p });
      selected = null;
    }
    return {
      pick_key: p.pickKey, draft_year: p.year, round: p.round, original_franchise_id: p.originalFranchiseId,
      protections: json(p.protections), protections_text: p.protectionsText, protections_known: p.protectionsKnown,
      status: p.status, overall_pick: p.overall, selected_person: selected, final_owner_franchise_id: p.finalOwnerFranchiseId,
    };
  });
  const swaps: Row[] = data.swaps.map((s) => ({
    swap_key: s.swapKey, draft_year: s.year, round: s.round, franchise_a: s.franchiseA, franchise_b: s.franchiseB,
    protections: json(s.protections), protections_text: s.protectionsText, protections_known: s.protectionsKnown,
    exercised: s.exercised,
  }));
  for (const [table, key, rows] of [['draft_picks', 'pick_key', picks], ['pick_swaps', 'swap_key', swaps]] as const) {
    const r = await upsert(tx, table, [key], rows, how);
    bump(res.inserted, table, r.ins);
    bump(res.updated, table, r.upd);
  }
  const pickIds = await idsByKey(tx, 'draft_picks', [
    ...data.picks.map((p) => p.pickKey), ...data.lottery.map((l) => l.pickKey),
    ...data.moves.flatMap((m) => m.parts.map((p) => p.pickKey).filter((k): k is string => !!k)),
  ]);
  const swapIds = await idsByKey(tx, 'pick_swaps', [
    ...data.swaps.map((s) => s.swapKey), ...data.moves.flatMap((m) => m.parts.map((p) => p.swapKey).filter((k): k is string => !!k)),
  ]);

  const lottery: Row[] = [];
  for (const l of data.lottery) {
    const pickId = pickIds.get(l.pickKey);
    if (pickId == null) { res.skipped.push({ table: 'draft_lottery', reason: `no draft_picks row for ${l.pickKey}`, row: l }); continue; }
    lottery.push({
      draft_year: l.year, pick_id: pickId, pre_lottery_slot: l.preSlot, odds_first: l.oddsFirst, pick_won: l.pickWon,
      tie_unresolved: l.tieUnresolved, source: l.source,
    });
  }
  const r = await upsert(tx, 'draft_lottery', ['draft_year', 'pick_id'], lottery, how);
  bump(res.inserted, 'draft_lottery', r.ins);
  bump(res.updated, 'draft_lottery', r.upd);
  return { pickIds, swapIds };
}

// ---- transactions ------------------------------------------------------------

const kindsLike = (k: MoveKind): MoveKind[] => (k === 'signing' || k === 're_signing' ? ['signing', 're_signing'] : [k]);

/**
 * The transaction_key of an already stored row for the same event as `move` (Review Focus 3): same kind (signing
 * and re-signing alike), date within 3 days, and a shared person or pick. Nearest date first; keys in `exclude`
 * (already claimed by another move of this write) are passed over. Null when none.
 */
export async function adoptExisting(tx: Db, move: MergedMove, exclude: ReadonlySet<string> = new Set()): Promise<string | null> {
  if (!move.date) return null;
  const persons = [...new Set(move.parts.flatMap((p) => [
    p.personKey, p.person?.bbrefId, p.person?.nbaPersonId != null ? `nba:${p.person.nbaPersonId}` : undefined,
  ]).filter((k): k is string => !!k))];
  const picks = [...new Set(move.parts.map((p) => p.pickKey).filter((k): k is string => !!k))];
  if (!persons.length && !picks.length) return null;
  const rows = await tx<{ transaction_key: string }[]>`
    SELECT t.transaction_key FROM transactions t
    WHERE t.kind = ANY(${kindsLike(move.kind)}::text[])
      AND t.date BETWEEN ${move.date}::date - ${WINDOW_DAYS}::int AND ${move.date}::date + ${WINDOW_DAYS}::int
      AND EXISTS (
        SELECT 1 FROM transaction_parts p LEFT JOIN draft_picks d ON d.pick_id = p.pick_id
        WHERE p.transaction_id = t.transaction_id
          AND (p.person_key = ANY(${persons}::text[]) OR d.pick_key = ANY(${picks}::text[])))
    ORDER BY abs(t.date - ${move.date}::date), t.transaction_id`;
  return rows.map((r) => r.transaction_key).find((k) => !exclude.has(k)) ?? null;
}

interface TxRow {
  transaction_id: string; transaction_key: string; slug: string; date: string | null; season_id: number | null;
  involves_clippers: boolean; kind: string; description: string; sources: string[]; is_complete: boolean;
}
type PartTuple = [number | null, number | null, string, string | null, number | null, number | null, string | null, string | null];
const PART_COLS = ['from_franchise_id', 'to_franchise_id', 'asset_kind', 'person_key', 'pick_id', 'swap_id', 'unlinked_text', 'gap_reason'] as const;
const TX_FIELDS = ['date', 'season_id', 'involves_clippers', 'kind', 'description', 'sources', 'is_complete'] as const;

async function loadTx(tx: Db, where: ReturnType<Db>): Promise<TxRow[]> {
  return tx<TxRow[]>`
    SELECT transaction_id::text, transaction_key, slug, date::text, season_id, involves_clippers, kind, description,
           sources, is_complete
    FROM transactions WHERE ${where}`;
}

async function writeMoves(
  tx: Db, data: FranchiseDataset, mode: WriteMode, people: People,
  ids: { pickIds: Map<string, number>; swapIds: Map<string, number> }, res: WriteResult,
): Promise<Set<string>> {
  // Every move's parts and fields as they'd be written.
  const built = data.moves.map((m) => {
    let addedGap = false;
    const resolved = m.parts.map((p) => {
      const personKey = resolvePerson(p, people);
      const pickId = p.pickKey ? ids.pickIds.get(p.pickKey) ?? null : null;
      const swapId = p.swapKey ? ids.swapIds.get(p.swapKey) ?? null : null;
      let gap = p.gap ?? null;
      if (!gap && p.person && !personKey) gap = 'person_unmatched';
      if (!gap && ((p.pickKey && pickId == null) || (p.swapKey && swapId == null))) gap = 'pick_unidentified';
      if (gap && !p.gap) addedGap = true;
      const linked = personKey != null || pickId != null || swapId != null;
      const tuple: PartTuple = [p.from, p.to, p.kind, personKey, pickId, swapId, linked ? null : p.text ?? null, gap];
      return { part: personKey ? { ...p, personKey } : p, tuple };
    });
    const named = { ...m, parts: resolved.map((r) => r.part) };
    const fields = {
      date: m.date || null, season_id: m.date ? seasonOfDate(m.date) : null, involves_clippers: m.involvesClippers,
      kind: m.kind, description: describeMove(named, eraTeamName, (k) => people.name.get(k) ?? ''),
      sources: [...new Set(m.sources)], is_complete: m.complete && !addedGap,
    };
    return { m, parts: resolved.map((r) => r.tuple), fields };
  });

  // Match existing rows: by key, then by a shared source, then by adoption.
  const keys = built.map((b) => b.m.transactionKey);
  const sources = [...new Set(built.flatMap((b) => b.fields.sources))];
  const found = keys.length
    ? await loadTx(tx, tx`transaction_key = ANY(${keys}::text[]) OR sources && ${sources}::text[]`) : [];
  const byKey = new Map(found.map((r) => [r.transaction_key, r]));
  const bySource = new Map<string, TxRow>();
  for (const r of found) for (const s of r.sources) if (!bySource.has(s)) bySource.set(s, r);
  const claimed = new Set<string>();
  const match: Array<TxRow | null> = built.map(() => null);
  built.forEach((b, i) => {
    const r = byKey.get(b.m.transactionKey);
    if (r && !claimed.has(r.transaction_key)) { match[i] = r; claimed.add(r.transaction_key); }
  });
  built.forEach((b, i) => {
    if (match[i]) return;
    const r = b.fields.sources.map((s) => bySource.get(s)).find((x) => x && !claimed.has(x.transaction_key));
    if (r) { match[i] = r; claimed.add(r.transaction_key); }
  });
  for (let i = 0; i < built.length; i++) {
    if (match[i]) continue;
    const key = await adoptExisting(tx, built[i].m, claimed);
    if (!key) continue;
    const [r] = await loadTx(tx, tx`transaction_key = ${key}`);
    match[i] = r;
    claimed.add(key);
  }

  // Existing rows: union sources; rewrite fields and parts in import mode, or in a job while still incomplete.
  const existingIds = match.filter((r): r is TxRow => !!r).map((r) => r.transaction_id);
  const oldParts = new Map<string, PartTuple[]>();
  if (existingIds.length) {
    const rows = await tx<Array<{ transaction_id: string } & Record<(typeof PART_COLS)[number], never>>>`
      SELECT transaction_id::text, ${tx(PART_COLS as unknown as string[])} FROM transaction_parts
      WHERE transaction_id = ANY(${existingIds}::bigint[]) ORDER BY transaction_id, part_id`;
    for (const r of rows) {
      const list = oldParts.get(r.transaction_id) ?? [];
      list.push(PART_COLS.map((c) => r[c]) as unknown as PartTuple);
      oldParts.set(r.transaction_id, list);
    }
  }
  const partRows: Row[] = [];
  const replaceParts: string[] = [];
  const pushParts = (id: string, parts: PartTuple[]) => {
    for (const t of parts) partRows.push(Object.fromEntries([['transaction_id', id], ...PART_COLS.map((c, j) => [c, t[j]])]));
  };
  const fresh: Array<{ b: (typeof built)[number]; row: Row }> = [];
  for (let i = 0; i < built.length; i++) {
    const b = built[i], old = match[i];
    if (!old) {
      const key = b.m.transactionKey;
      fresh.push({ b, row: { transaction_key: key, slug: tradeSlug(key, b.m.date), ...b.fields } });
      continue;
    }
    const rewrite = mode.kind === 'import' || !old.is_complete;
    const union = [...old.sources, ...b.fields.sources.filter((s) => !old.sources.includes(s))];
    const next = rewrite ? { ...b.fields, sources: union } : { ...old, sources: union };
    if (TX_FIELDS.some((f) => JSON.stringify(next[f]) !== JSON.stringify(old[f]))) {
      await tx`
        UPDATE transactions SET date = ${next.date}, season_id = ${next.season_id}, involves_clippers = ${next.involves_clippers},
          kind = ${next.kind}, description = ${next.description}, sources = ${next.sources}::text[], is_complete = ${next.is_complete}
        WHERE transaction_id = ${old.transaction_id}::bigint`;
      bump(res.updated, 'transactions', 1);
    }
    const before = oldParts.get(old.transaction_id) ?? [];
    if (rewrite && JSON.stringify(before) !== JSON.stringify(b.parts)) {
      replaceParts.push(old.transaction_id);
      bump(res.deleted, 'transaction_parts', before.length);
      pushParts(old.transaction_id, b.parts);
    }
  }
  if (replaceParts.length) await tx`DELETE FROM transaction_parts WHERE transaction_id = ANY(${replaceParts}::bigint[])`;
  for (const batch of chunks(fresh)) {
    const rows = await tx<{ transaction_id: string; transaction_key: string }[]>`
      INSERT INTO transactions ${tx(batch.map((f) => f.row) as never)} RETURNING transaction_id::text, transaction_key`;
    const idOf = new Map(rows.map((r) => [r.transaction_key, r.transaction_id]));
    for (const f of batch) pushParts(idOf.get(f.b.m.transactionKey)!, f.b.parts);
    bump(res.inserted, 'transactions', rows.length);
  }
  for (const batch of chunks(partRows)) {
    const r = await tx`INSERT INTO transaction_parts ${tx(batch as never, ['transaction_id', ...PART_COLS])}`;
    bump(res.inserted, 'transaction_parts', r.count);
  }
  return new Set([...claimed, ...fresh.map((f) => f.b.m.transactionKey)]);
}

// ---- season tables, contracts, coaches, executives, honors -------------------

/** Rows whose person has no person_xref row can't be written (FK, NOT NULL): reported in `skipped`. */
function withPerson<T>(rows: T[], keyOf: (r: T) => string | null, table: string, people: People, res: WriteResult): T[] {
  return rows.filter((r) => {
    const k = keyOf(r);
    if (k && people.keys.has(k)) return true;
    res.skipped.push({ table, reason: k ? `no person_xref row for ${k}` : 'no person key', row: r });
    return false;
  });
}

async function writeContracts(tx: Db, data: FranchiseDataset, people: People, res: WriteResult): Promise<void> {
  const rows = withPerson(data.contracts, (c) => c.personKey, 'contracts', people, res);
  if (!rows.length) return;
  const snapshot = rows.map((c) => c.fetchedAt).sort().at(-1)!;
  const [{ newest }] = await tx<{ newest: Date | null }[]>`SELECT max(fetched_at) AS newest FROM contracts`;
  if (newest && Date.parse(snapshot) <= newest.getTime()) return; // the stored snapshot is as new or newer
  const out = dedupe(rows.map((c) => ({
    snapshot_id: snapshot, person_key: c.personKey, season_id: c.seasonId, amount_usd: c.amountUsd,
    guaranteed_usd: c.guaranteedUsd, option: c.option, fetched_at: snapshot,
  })), ['person_key', 'season_id']);
  for (const batch of chunks(out)) await tx`INSERT INTO contracts ${tx(batch as never)}`;
  bump(res.inserted, 'contracts', out.length);
  // Only after the new snapshot is in: drop the previous one.
  const d = await tx`DELETE FROM contracts WHERE snapshot_id <> ${snapshot}`;
  bump(res.deleted, 'contracts', d.count);
}

/** executive_terms and honors have no unique key: match on a natural key in memory. */
async function writeKeyless(
  tx: Db, table: 'executive_terms' | 'honors', idCol: string, keyCols: string[], valCols: string[], rows: Row[],
  how: 'overwrite' | 'fill', prune: ((r: Row) => boolean) | null, res: WriteResult,
): Promise<void> {
  const cols = [...keyCols, ...valCols];
  const list = cols.map((c) => (c.endsWith('_date') ? `${c}::text AS ${c}` : c)).join(', ');
  const existing = await tx<Row[]>`SELECT ${tx.unsafe(`${idCol}::text AS id, ${list} FROM ${table}`)}`;
  const keyOf = (r: Row) => JSON.stringify(keyCols.map((c) => r[c] ?? null));
  const old = new Map(existing.map((r) => [keyOf(r), r]));
  const want = dedupe(rows, keyCols);
  const seen = new Set<string>();
  const insert: Row[] = [];
  for (const r of want) {
    const k = keyOf(r);
    seen.add(k);
    const o = old.get(k);
    if (!o) { insert.push(r); continue; }
    const next = Object.fromEntries(valCols.map((c) => [c, how === 'fill' ? o[c] ?? r[c] ?? null : r[c] ?? null]));
    if (valCols.every((c) => next[c] === (o[c] ?? null))) continue;
    await tx`UPDATE ${tx.unsafe(table)} SET ${tx(next as never, valCols)} WHERE ${tx.unsafe(idCol)} = ${o.id as string}::int`;
    bump(res.updated, table, 1);
  }
  for (const batch of chunks(insert)) await tx`INSERT INTO ${tx.unsafe(table)} ${tx(batch as never, cols)}`;
  bump(res.inserted, table, insert.length);
  if (!prune) return;
  const stale = existing.filter((r) => !seen.has(keyOf(r)) && prune(r)).map((r) => r.id as string);
  if (stale.length) await tx`DELETE FROM ${tx.unsafe(`${table} WHERE ${idCol}`)} = ANY(${stale}::int[])`;
  bump(res.deleted, table, stale.length);
}

async function writeTables(
  tx: Db, data: FranchiseDataset, mode: WriteMode, people: People, seasons: string[], res: WriteResult,
): Promise<void> {
  const how = mode.kind === 'import' ? 'overwrite' : 'fill';
  const prune = mode.kind === 'import';
  const covered = new Set(seasons.map(Number));

  const salaries: Row[] = withPerson(data.salaries, (s) => s.personKey, 'salaries', people, res).map((s) => ({
    season_id: s.seasonId, person_key: s.personKey, amount_usd: s.amountUsd, source: s.source,
  }));
  const payroll: Row[] = data.payrollSeasons.map((p) => ({
    season_id: p.seasonId, listed_players: p.listedPlayers, roster_players: p.rosterPlayers,
    listed_total_usd: p.listedTotalUsd, is_partial: p.isPartial,
  }));
  const coaches: Row[] = withPerson(data.coachSeasons, (c) => c.bbrefId, 'coach_seasons', people, res).map((c) => ({
    season_id: c.seasonId, person_key: c.bbrefId, ordinal: c.order, games: c.games, wins: c.wins, losses: c.losses,
    playoff_wins: c.playoffWins, playoff_losses: c.playoffLosses,
  }));
  for (const [table, key, rows] of [
    ['salaries', ['season_id', 'person_key'], salaries], ['payroll_seasons', ['season_id'], payroll],
    ['coach_seasons', ['season_id', 'person_key', 'ordinal'], coaches],
  ] as const) {
    const r = await upsert(tx, table, [...key], rows, how);
    bump(res.inserted, table, r.ins);
    bump(res.updated, table, r.upd);
  }
  await writeContracts(tx, data, people, res);

  const execs: Row[] = withPerson(data.execTerms, (e) => e.personKey, 'executive_terms', people, res).map((e) => ({
    person_key: e.personKey, title: e.title, start_date: e.startDate, end_date: e.endDate,
  }));
  await writeKeyless(tx, 'executive_terms', 'term_id', ['person_key', 'title', 'start_date'], ['end_date'], execs, how,
    prune && data.execTerms.length ? () => true : null, res);
  const honors: Row[] = withPerson(data.honors, (h) => h.personKey, 'honors', people, res).map((h) => ({
    season_id: h.seasonId, person_key: h.personKey, honor: h.honor, detail: h.detail,
  }));
  await writeKeyless(tx, 'honors', 'honor_id', ['season_id', 'person_key', 'honor'], ['detail'], honors, how,
    prune && data.honors.length ? (r) => r.season_id == null || covered.has(Number(r.season_id)) : null, res);

  if (!prune) return;
  // Stale import rows in covered seasons (salaries: import-owned sources only; the weekly job's rows stay).
  const owned = mode.importSources.map(likePrefix);
  if (data.salaries.length) {
    const d = await tx`
      DELETE FROM salaries s WHERE s.season_id = ANY(${seasons}::smallint[]) AND s.source LIKE ANY(${owned}::text[])
        AND NOT EXISTS (SELECT 1 FROM unnest(${salaries.map((r) => String(r.season_id))}::smallint[], ${salaries.map((r) => r.person_key as string)}::text[]) v(s, p)
                        WHERE v.s = s.season_id AND v.p = s.person_key)`;
    bump(res.deleted, 'salaries', d.count);
  }
  if (data.payrollSeasons.length) {
    const d = await tx`
      DELETE FROM payroll_seasons WHERE season_id = ANY(${seasons}::smallint[])
        AND NOT (season_id = ANY(${payroll.map((r) => String(r.season_id))}::smallint[]))`;
    bump(res.deleted, 'payroll_seasons', d.count);
  }
  if (data.coachSeasons.length) {
    const d = await tx`
      DELETE FROM coach_seasons c WHERE c.season_id = ANY(${seasons}::smallint[])
        AND NOT EXISTS (SELECT 1 FROM unnest(${coaches.map((r) => String(r.season_id))}::smallint[], ${coaches.map((r) => r.person_key as string)}::text[],
                                             ${coaches.map((r) => String(r.ordinal))}::smallint[]) v(s, p, o)
                        WHERE v.s = c.season_id AND v.p = c.person_key AND v.o = c.ordinal)`;
    bump(res.deleted, 'coach_seasons', d.count);
  }
}

// ---- entry point -------------------------------------------------------------

/**
 * Writes `data` in one transaction (or inside the caller's, when `db` already is one), after the storage guard.
 * See the file header for what each mode may change.
 */
export async function writeFranchise(db: Db, data: FranchiseDataset, mode: WriteMode, opts: WriteOptions = {}): Promise<WriteResult> {
  const capMb = opts.capMb ?? 512;
  const bytes = await databaseBytes(db);
  if (bytes > GUARD_SHARE * capMb * 1024 * 1024) {
    throw new Error(`Database is ${(bytes / 1024 / 1024).toFixed(1)} MB, above ${GUARD_SHARE * 100}% of the ${capMb} MB cap; nothing written`);
  }
  const seasons = coveredSeasons(data, opts);
  const run = async (tx: Db): Promise<WriteResult> => {
    const res: WriteResult = { inserted: {}, updated: {}, deleted: {}, merged: 0, skipped: [] };
    const how = mode.kind === 'import' ? 'overwrite' : 'fill';
    const people = await writePeople(tx, data, mode, res);
    const ids = await writePicks(tx, data, how, people, res);
    const written = await writeMoves(tx, data, mode, people, ids, res);
    await writeTables(tx, data, mode, people, seasons, res);
    // Import-owned transactions the dataset no longer contains (job rows and shared rows stay).
    if (mode.kind === 'import' && data.moves.length && seasons.length) {
      const d = await tx`
        DELETE FROM transactions t WHERE t.season_id = ANY(${seasons}::smallint[])
          AND NOT (t.transaction_key = ANY(${[...written]}::text[])) AND cardinality(t.sources) > 0
          AND NOT EXISTS (SELECT 1 FROM unnest(t.sources) s WHERE NOT (s LIKE ANY(${mode.importSources.map(likePrefix)}::text[])))`;
      bump(res.deleted, 'transactions', d.count);
    }
    return res;
  };
  const maybeTx = db as unknown as { savepoint?: unknown };
  if (typeof maybeTx.savepoint === 'function') return run(db); // already inside the caller's transaction
  return db.begin((t) => run(t as unknown as Db)) as Promise<WriteResult>;
}
