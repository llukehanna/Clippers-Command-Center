// scripts/lib/franchise/sync-moves.ts
// The nightly moves job (scripts/sync-franchise-moves.ts is the thin entry point; spec §3.5): one download of NBA.com's
// movement feed, or ESPN's Clippers transactions when NBA.com fails or takes 20 s, then the import's own steps on the
// moves in the window (parse -> reconcileMoves -> applyMoveOverrides -> people -> applyOverrides), written in job mode
// (adds rows and fills nulls, never deletes), in one database transaction with the key.
//
// - The window: moves dated after app_kv 'franchise:moves_synced_through' minus OVERLAP_DAYS. Re-reading the last
//   three days is idempotent (the writer matches by key and source) and catches what a strict `> key` misses: a move
//   NBA.com posts late with an already-synced date, and NBA.com's report of a trade ESPN wrote first (its `nba:`
//   source joins that row through adoptExisting, whose window is also three days).
// - The key moves only on NBA.com nights, to the latest date written (never past today, Pacific time: a move dated
//   in the future is written but the key waits for its day), never backwards; with nothing new it stays.
//   ESPN's feed is Clippers-only: an ESPN night writes what ESPN has but leaves the key, so the league-wide moves
//   NBA.com still holds are read the next NBA.com night. Missing (first run): the latest NBA.com or ESPN transaction
//   already stored, so the job doesn't rewrite what the import wrote.
//
// - People: the job has no BBRef rosters, so its PeopleIndex is person_xref plus `players` plus the override links.
//   A part's person resolves to the person_xref key already holding its NBA.com id (or its name, for ESPN), so the
//   writer's adoption (adoptExisting) finds the row another source wrote first and keeps one row per event.
// - Unparsed lines in the window (or undated, and parsed moves with no date) that no override settles stop the run
//   before anything is written, and the key stays where it was: a committed override (ignore, or create) settles them
//   the next night.
// - A feed whose shape changed (NBA.com with no movement rows, ESPN with no transactions list) is a failed fetch, never
//   a quiet night: NBA.com falls back to ESPN, ESPN throws.
import type { Db } from '../history/write.js';
import { applyMoveOverrides, applyOverrides } from './apply-overrides.js';
import { defaultDraftYear } from './build-dataset.js';
import { completePeople } from './build-tables.js';
import { seasonOfDate } from './describe.js';
import { parseEspnTransactions } from './espn.js';
import { parseMovement } from './nba-movement.js';
import { OVERRIDES } from './overrides.js';
import { buildIndex, resolveRef, type DbPlayer, type PersonRow } from './people.js';
import { reconcileMoves } from './reconcile-moves.js';
import type { FranchiseDataset, Override, ParsedMove, UnparsedLine } from './types.js';
import { writeFranchise } from './write.js';

export const SYNCED_THROUGH_KEY = 'franchise:moves_synced_through';
export const NBA_TIMEOUT_MS = 20_000;
/** Days before the key the job re-reads. */
export const OVERLAP_DAYS = 3;

export type FeedSource = 'nba' | 'espn';

export interface SyncDeps {
  fetchNba(): Promise<unknown>;
  fetchEspn(): Promise<unknown>;
  db: Db;
  now(): Date;
  /** Default OVERRIDES (overrides.ts). */
  overrides?: Override[];
  log?: (line: string) => void;
}

export interface SyncResult {
  source: FeedSource;
  /** Transactions this run inserted or changed (a re-read of the overlap that changes nothing counts 0). */
  written: number;
  /** Transaction keys of the window's moves still is_complete = false. */
  incomplete: string[];
  /** franchise:moves_synced_through after the run (null: none yet). */
  syncedThrough: string | null;
  /** Whether this run moved the key (only NBA.com nights do). */
  advanced: boolean;
  /** Why NBA.com failed, on an ESPN night. */
  nbaError?: string;
  /**
   * ESPN nights: keys of written moves with a person no person_xref key resolved (name only). NBA.com's report of the
   * same event can't adopt their row, so they may end up duplicated.
   */
  unmatched: string[];
}

/** The run stopped before writing: lines no parser or override could read. */
export class UnparsedMovesError extends Error {
  constructor(public readonly source: FeedSource, public readonly lines: UnparsedLine[], public readonly nbaError?: string) {
    super(`${lines.length} unparsed ${source} line(s); nothing written. Settle them with an override in overrides.ts:\n` +
      lines.map((l) => `  ${l.date ?? '(no date)'} ${l.text}`).join('\n'));
    this.name = 'UnparsedMovesError';
  }
}

// ---- fetch -------------------------------------------------------------------------

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms / 1000} s`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/** The parsers read a missing list as empty: a changed shape must fail the fetch instead of looking like a quiet night. */
function checkNba(json: unknown): unknown {
  const rows = (json as { NBA_Player_Movement?: { rows?: unknown } } | null)?.NBA_Player_Movement?.rows;
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('NBA.com feed has no NBA_Player_Movement.rows');
  return json;
}

function checkEspn(json: unknown): unknown {
  if (!Array.isArray((json as { transactions?: unknown } | null)?.transactions)) throw new Error('ESPN feed has no transactions list');
  return json;
}

/** NBA.com, or ESPN when NBA.com throws, takes NBA_TIMEOUT_MS or sends no rows. Throws when both fail. */
export async function fetchFeed(deps: Pick<SyncDeps, 'fetchNba' | 'fetchEspn'>): Promise<{ source: FeedSource; json: unknown; nbaError?: string }> {
  let nbaError: string;
  try {
    return { source: 'nba', json: checkNba(await withTimeout(deps.fetchNba(), NBA_TIMEOUT_MS, 'NBA.com')) };
  } catch (e) {
    nbaError = message(e);
  }
  try {
    return { source: 'espn', json: checkEspn(await deps.fetchEspn()), nbaError };
  } catch (e) {
    throw new Error(`no feed: NBA.com: ${nbaError}; ESPN: ${message(e)}`);
  }
}

// ---- build (pure) ------------------------------------------------------------------

export interface NightlyInput {
  source: FeedSource;
  json: unknown;
  /** Moves dated after this minus OVERLAP_DAYS are read; null: everything is (an empty database). */
  syncedThrough: string | null;
  /** person_xref. */
  people: PersonRow[];
  players: DbPlayer[];
  overrides: Override[];
  currentDraftYear: number;
}

/** YYYY-MM-DD `n` days before `date`. */
function daysBefore(date: string, n: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
}

/** The night's dataset (moves in the window, the people person_xref lacks) and the lines still unparsed. */
export function buildNightly(input: NightlyInput): { data: FranchiseDataset; unparsed: UnparsedLine[] } {
  const from = input.syncedThrough == null ? null : daysBefore(input.syncedThrough, OVERLAP_DAYS);
  const after = (d: string | null) => from == null || d == null || d > from;
  const parsed = input.source === 'nba'
    ? parseMovement(input.json)
    : parseEspnTransactions(input.json, input.players.map((p) => ({ name: p.display_name, nbaPersonId: p.nba_person_id })));
  const moves: ParsedMove[] = parsed.moves.filter((m) => m.date && after(m.date));
  // A move the parser read but couldn't date gates like an undated line.
  const unparsed = [
    ...parsed.unparsed.filter((l) => after(l.date)),
    ...parsed.moves.filter((m) => !m.date).map((m, i) => ({ source: input.source, index: -1 - i, date: null, text: `move with no date: ${m.sourceKey}` })),
  ];

  // As build-dataset: `person` overrides tying an NBA.com id to a BBRef id.
  const links = input.overrides.flatMap((o) => (o.kind === 'person' && /^nba:\d+$/.test(o.match.ref) && !o.personKey.startsWith('nba:') && !o.match.scope
    ? [{ bbrefId: o.personKey, nbaPersonId: Number(o.match.ref.slice(4)) }] : []));
  const index = buildIndex(input.people, new Map(), input.players, links);
  // One source a night: reconcile only shapes the moves (ESPN's prose, like Wikipedia's, is the weakest source).
  const reconciled = reconcileMoves({ nba: input.source === 'nba' ? moves : [], bbref: [], wiki: input.source === 'espn' ? moves : [], index });
  const p1 = applyMoveOverrides({ moves: reconciled, unparsed, draftRows: [] }, input.overrides);
  // Every part names the person_xref key it resolves to (by id, or a unique name), so the writer can adopt the row
  // another source already wrote for the same event.
  const resolved = p1.moves.map((m) => ({
    ...m,
    parts: m.parts.map((p) => {
      if (!p.person || p.personKey) return p;
      const key = resolveRef(p.person, index, seasonOfDate(m.date));
      return key ? { ...p, personKey: key } : p;
    }),
  }));
  const known = new Set(input.people.map((p) => p.personKey));
  const people = completePeople(input.people, {
    moves: resolved, picks: [], draftNames: new Map(), coachSeasons: [], execTerms: [], salaries: [], contracts: [], dbPlayers: input.players,
  }).filter((p) => !known.has(p.personKey));

  const assembled: FranchiseDataset = {
    currentDraftYear: input.currentDraftYear, people, moves: resolved, picks: [], swaps: [], lottery: [],
    salaries: [], payrollSeasons: [], contracts: [], coachSeasons: [], execTerms: [], honors: [],
    unparsed: p1.unparsed, ignored: [], dropped: p1.dropped, skipped: [], peopleUnmatched: [], peopleAmbiguous: [],
    breaks: [], disputes: [], unkeyed: [], skippedCategories: [],
  };
  const { data } = applyOverrides(assembled, input.overrides);
  return { data, unparsed: data.unparsed };
}

/** The latest of the previous key and the dates written, a date after `today` counting as today; null when none. */
export function nextSyncedThrough(prev: string | null, written: string[], today: string): string | null {
  return [prev, ...written.map((d) => (d > today ? today : d))].filter((d): d is string => !!d).sort().at(-1) ?? null;
}

/** YYYY-MM-DD in Los Angeles. */
export function pacificDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// ---- database ----------------------------------------------------------------------

/** `stored`: the key as stored; `syncedThrough`: it, or the first run's baseline. */
async function loadState(db: Db): Promise<{ stored: string | null; syncedThrough: string | null; people: PersonRow[]; players: DbPlayer[] }> {
  const [kv] = await db<{ v: string }[]>`SELECT value #>> '{}' AS v FROM app_kv WHERE key = ${SYNCED_THROUGH_KEY}`;
  const stored = kv?.v ?? null;
  let syncedThrough: string | null = stored;
  if (syncedThrough == null) {
    const [t] = await db<{ d: string | null }[]>`
      SELECT max(date)::text AS d FROM transactions t
      WHERE EXISTS (SELECT 1 FROM unnest(t.sources) s WHERE s LIKE 'nba:%' OR s LIKE 'espn:%')`;
    syncedThrough = t?.d ?? null;
  }
  const people = await db<PersonRow[]>`
    SELECT person_key AS "personKey", kind, display_name AS "displayName", birthdate::text AS birthdate,
           nba_person_id AS "nbaPersonId", player_id::text AS "playerId"
    FROM person_xref`;
  const players = await db<DbPlayer[]>`
    SELECT player_id::text, nba_person_id, display_name, birthdate::text AS birthdate FROM players`;
  return { stored, syncedThrough, people: [...people], players: [...players] };
}

export async function syncMoves(deps: SyncDeps): Promise<SyncResult> {
  const { db } = deps;
  const log = deps.log ?? (() => {});
  const feed = await fetchFeed(deps);
  if (feed.nbaError) log(`NBA.com failed (${feed.nbaError}); using ESPN's Clippers transactions`);

  const state = await loadState(db);
  const { data, unparsed } = buildNightly({
    source: feed.source, json: feed.json, syncedThrough: state.syncedThrough, people: state.people, players: state.players,
    overrides: deps.overrides ?? OVERRIDES, currentDraftYear: defaultDraftYear(deps.now()),
  });
  if (unparsed.length) throw new UnparsedMovesError(feed.source, unparsed, feed.nbaError);

  // ESPN nights never move the key (see the header).
  const next = feed.source === 'nba'
    ? nextSyncedThrough(state.syncedThrough, data.moves.map((m) => m.date), pacificDate(deps.now()))
    : state.stored;
  const advanced = next !== state.stored;
  let incomplete: string[] = [];
  let written = 0;
  await db.begin(async (t) => {
    const tx = t as unknown as Db;
    if (data.moves.length) {
      const res = await writeFranchise(tx, data, { kind: 'job', job: 'nightly' });
      written = (res.inserted.transactions ?? 0) + (res.updated.transactions ?? 0);
      const keys = data.moves.map((m) => m.transactionKey);
      const sources = [...new Set(data.moves.flatMap((m) => m.sources))];
      incomplete = (await tx<{ transaction_key: string }[]>`
        SELECT transaction_key FROM transactions
        WHERE NOT is_complete AND (transaction_key = ANY(${keys}::text[]) OR sources && ${sources}::text[])
        ORDER BY date, transaction_key`).map((r) => r.transaction_key);
    }
    if (advanced && next != null) {
      await tx`
        INSERT INTO app_kv (key, value, updated_at) VALUES (${SYNCED_THROUGH_KEY}, ${tx.json(next)}, now())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`;
    }
  });
  const unmatched = feed.source === 'espn'
    ? data.moves.filter((m) => m.parts.some((p) => p.person && !p.personKey)).map((m) => m.transactionKey) : [];
  return {
    source: feed.source, written, incomplete, syncedThrough: next, advanced, unmatched,
    ...(feed.nbaError ? { nbaError: feed.nbaError } : {}),
  };
}
