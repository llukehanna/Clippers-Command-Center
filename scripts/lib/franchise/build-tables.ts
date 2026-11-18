// scripts/lib/franchise/build-tables.ts
// The import's non-move rows (spec §1): salaries and payroll, the contracts snapshot, coach seasons, executive terms,
// honors, and the person rows every other row needs. Pure: the caller reads the cache and the database.
//
// Payroll partial rule (Task 15): a season is partial when it lists fewer salaries than the players who played at least
// one game for the Clippers that season (Part 1's player_seasons); without player_seasons rows for it, when it lists
// fewer than 10.
// Coach playoff W/L (Ruling R6): BBRef team pages carry no per-coach playoff split, so a season's playoff record (Part
// 1's games) goes to its coach only when the season had exactly one coach; otherwise, or with no playoff games on
// record, it stays null.
// Honors count only while the person was a Clippers player or coach (spec §1): a player award resolves against that
// season's Clippers roster, Coach of the Year against that season's coaches, Executive of the Year against the
// executives in office; Hall of Fame and retired numbers against every Clippers season (players first, then coaches).
// A league-wide retirement (retired_number_league) is kept as the source has it and resolved against everyone we know.
// An honoree that doesn't resolve keeps personKey null: reported as unmatched, never written, never guessed.
import { normalizePersonName } from '../player-match.js';
import type { CoachSeasonRow, CoachStintRow, ContractRow, ExecRow, RosterRow, SalaryRow } from './bbref-tables.js';
import type { DbPlayer, PersonRow } from './people.js';
import type { PickRow } from './picks.js';
import type { MergedMove } from './reconcile-moves.js';
import type { ContractSnapshotRow, ExecTermRow, HonorRow, PayrollSeasonRow, SalarySeasonRow } from './types.js';
import type { Honor } from './wiki-team.js';

/** Without player_seasons rows, a season listing fewer salaries than this is partial. */
export const PARTIAL_WITHOUT_ROSTER = 10;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

// ---- salaries and payroll -------------------------------------------------------------------------------------------

export interface SalaryPage {
  seasonId: number;
  /** Source key, e.g. `bbref:LAC-2005`. */
  source: string;
  rows: SalaryRow[];
}

/**
 * `playersBySeason`: players with at least one game for the Clippers, by season (Part 1's player_seasons); a season
 * missing from it falls back to the PARTIAL_WITHOUT_ROSTER rule. A player listed twice on one page counts once.
 */
export function buildSalaries(pages: SalaryPage[], playersBySeason: Map<number, number>): { salaries: SalarySeasonRow[]; payroll: PayrollSeasonRow[] } {
  const salaries: SalarySeasonRow[] = [];
  const payroll: PayrollSeasonRow[] = [];
  for (const page of [...pages].sort((a, b) => a.seasonId - b.seasonId)) {
    const seen = new Set<string>();
    const rows = page.rows.filter((r) => !seen.has(r.bbrefId) && seen.add(r.bbrefId));
    if (!rows.length) continue;
    for (const r of rows) salaries.push({ seasonId: page.seasonId, personKey: r.bbrefId, amountUsd: r.amountUsd, source: page.source });
    const rosterPlayers = playersBySeason.get(page.seasonId) ?? null;
    payroll.push({
      seasonId: page.seasonId,
      listedPlayers: rows.length,
      rosterPlayers,
      listedTotalUsd: rows.reduce((a, r) => a + r.amountUsd, 0),
      isPartial: rosterPlayers != null ? rows.length < rosterPlayers : rows.length < PARTIAL_WITHOUT_ROSTER,
    });
  }
  return { salaries, payroll };
}

// ---- contracts --------------------------------------------------------------------------------------------------------

/** One row per player per season of the snapshot. A player listed twice keeps his first row; the rest are reported. */
export function buildContracts(rows: ContractRow[], fetchedAt: string | null): { contracts: ContractSnapshotRow[]; duplicates: string[] } {
  if (!fetchedAt) return { contracts: [], duplicates: [] };
  const seen = new Set<string>();
  const duplicates: string[] = [];
  const contracts: ContractSnapshotRow[] = [];
  for (const r of rows) {
    if (seen.has(r.bbrefId)) { duplicates.push(`${r.name} (${r.bbrefId})`); continue; }
    seen.add(r.bbrefId);
    for (const s of r.seasons) {
      contracts.push({ personKey: r.bbrefId, seasonId: s.seasonId, amountUsd: s.amountUsd, guaranteedUsd: r.guaranteedUsd, option: s.option, fetchedAt });
    }
  }
  return { contracts, duplicates };
}

// ---- coaches ----------------------------------------------------------------------------------------------------------

export interface PlayoffRecord { wins: number; losses: number }

/** Ruling R6: a single-coach season gets that season's playoff record from Part 1; anything else stays null. */
export function buildCoachSeasons(rows: CoachSeasonRow[], playoffs: Map<number, PlayoffRecord>): CoachSeasonRow[] {
  const perSeason = new Map<number, number>();
  for (const r of rows) perSeason.set(r.seasonId, (perSeason.get(r.seasonId) ?? 0) + 1);
  return rows.map((r) => {
    const p = perSeason.get(r.seasonId) === 1 ? playoffs.get(r.seasonId) : undefined;
    return { ...r, playoffWins: p?.wins ?? null, playoffLosses: p?.losses ?? null };
  });
}

/**
 * Coaches page tenures against the per-season rows: a stint whose seasons are all cached must sum to its regular-season
 * W-L. BBRef's From/To are season END years (parseCoachStints keeps them as written), so a stint covers seasons
 * from - 1 .. to - 1 (start years). Returns one line per mismatch, for the report.
 */
export function checkCoachStints(seasons: CoachSeasonRow[], stints: CoachStintRow[], cached: Set<number>): string[] {
  const out: string[] = [];
  for (const st of stints) {
    const years: number[] = [];
    for (let y = st.fromSeasonId - 1; y <= st.toSeasonId - 1; y++) years.push(y);
    if (!years.every((y) => cached.has(y))) continue;
    const mine = seasons.filter((c) => c.bbrefId === st.bbrefId && years.includes(c.seasonId));
    const w = mine.reduce((a, c) => a + c.wins, 0);
    const l = mine.reduce((a, c) => a + c.losses, 0);
    if (w !== st.wins || l !== st.losses) {
      out.push(`${st.name} (${st.bbrefId}) ${years[0]}–${years.at(-1)}: stint ${st.wins}-${st.losses}, seasons ${w}-${l}`);
    }
  }
  return out;
}

// ---- executives --------------------------------------------------------------------------------------------------------

/** BBRef dates that aren't a full YYYY-MM-DD (e.g. "1970") are unknown: null. */
export function buildExecTerms(rows: ExecRow[]): { terms: ExecTermRow[]; partialDates: string[] } {
  const partialDates: string[] = [];
  const date = (d: string | null, who: string) => {
    if (d == null) return null;
    if (ISO_DATE.test(d)) return d;
    partialDates.push(`${who}: "${d}"`);
    return null;
  };
  const terms = rows.map((r) => ({
    personKey: r.bbrefId, name: r.name, title: r.title, startDate: date(r.start, r.name), endDate: date(r.end, r.name),
  }));
  return { terms, partialDates };
}

// ---- honors -------------------------------------------------------------------------------------------------------------

interface Named { key: string; name: string }

function unique(list: Named[], name: string): string | null {
  const n = normalizePersonName(name);
  if (!n) return null;
  const keys = new Set(list.filter((x) => normalizePersonName(x.name) === n).map((x) => x.key));
  return keys.size === 1 ? [...keys][0] : null;
}

export interface HonorContext {
  rosterBySeason: Map<number, RosterRow[]>;
  coachSeasons: CoachSeasonRow[];
  execTerms: ExecTermRow[];
  /** Every person row built so far (for league-wide retirements). */
  people: PersonRow[];
}

export function resolveHonors(honors: Honor[], ctx: HonorContext): HonorRow[] {
  const roster = (s: number): Named[] => (ctx.rosterBySeason.get(s) ?? []).map((r) => ({ key: r.bbrefId, name: r.name }));
  const allRoster: Named[] = [...ctx.rosterBySeason.values()].flat().map((r) => ({ key: r.bbrefId, name: r.name }));
  const coaches = (s: number | null): Named[] =>
    ctx.coachSeasons.filter((c) => s == null || c.seasonId === s).map((c) => ({ key: c.bbrefId, name: c.name }));
  const execsIn = (s: number): Named[] => ctx.execTerms
    .filter((e) => e.personKey && (e.startDate == null || e.startDate <= `${s + 1}-06-30`) && (e.endDate == null || e.endDate >= `${s}-07-01`))
    .map((e) => ({ key: e.personKey as string, name: e.name }));

  return honors.map((h) => {
    let personKey: string | null;
    if (h.honor === 'retired_number_league') {
      personKey = unique(ctx.people.map((p) => ({ key: p.personKey, name: p.displayName })), h.name);
    } else if (h.seasonId == null) {
      personKey = unique(allRoster, h.name) ?? unique(coaches(null), h.name);
    } else if (h.honor === 'coy') {
      personKey = unique(coaches(h.seasonId), h.name);
    } else if (h.honor === 'eoy') {
      personKey = unique(execsIn(h.seasonId), h.name);
    } else {
      personKey = unique(roster(h.seasonId), h.name);
    }
    return { ...h, personKey };
  });
}

// ---- people --------------------------------------------------------------------------------------------------------------

/** BBRef id spaces: coaches end in "c" ("riverdo01c"), executives in "x" ("donoved99x"), players in two digits. */
export function kindOfBbrefId(id: string): PersonRow['kind'] {
  if (/\d{2}c$/.test(id)) return 'coach';
  if (/\d{2}x$/.test(id)) return 'executive';
  return 'player';
}

export interface PeopleSources {
  moves: MergedMove[];
  picks: PickRow[];
  /** Draft row names by `${year}-${overall}` (for selections with no other person row). */
  draftNames: Map<string, string>;
  coachSeasons: CoachSeasonRow[];
  execTerms: ExecTermRow[];
  salaries: Array<{ bbrefId: string; name: string }>;
  contracts: Array<{ bbrefId: string; name: string }>;
  dbPlayers: DbPlayer[];
}

/**
 * `base` (matched roster people) plus a row for every other person a written row points at: coaches, executives,
 * salary and contract players, move parts (a BBRef id, or `nba:<id>` when no person row carries that NBA.com id yet)
 * and draft selections. Only what a source states: name, id, and the Part 1 player an NBA.com id belongs to.
 */
export function completePeople(base: PersonRow[], src: PeopleSources): PersonRow[] {
  const byKey = new Map(base.map((p) => [p.personKey, p]));
  const baseKeys = new Set(base.map((p) => p.personKey));
  const nbaHeld = new Set(base.map((p) => p.nbaPersonId).filter((x): x is number => x != null));
  const playerByNba = new Map<number, string>();
  const nbaClaims = new Map<number, number>();
  for (const p of src.dbPlayers) if (p.nba_person_id != null) nbaClaims.set(p.nba_person_id, (nbaClaims.get(p.nba_person_id) ?? 0) + 1);
  for (const p of src.dbPlayers) if (p.nba_person_id != null && nbaClaims.get(p.nba_person_id) === 1) playerByNba.set(p.nba_person_id, p.player_id);

  const add = (personKey: string, kind: PersonRow['kind'], displayName: string, nbaPersonId: number | null = null) => {
    const nba = nbaPersonId != null && !nbaHeld.has(nbaPersonId) ? nbaPersonId : null;
    const had = byKey.get(personKey);
    if (had) {
      // A later ref (a move NBA.com and BBRef both list) may be the first to carry this person's NBA.com id.
      if (had.nbaPersonId == null && nba != null && !baseKeys.has(personKey)) {
        nbaHeld.add(nba);
        byKey.set(personKey, { ...had, nbaPersonId: nba, playerId: playerByNba.get(nba) ?? null });
      }
      return;
    }
    if (!displayName) return;
    if (nba != null) nbaHeld.add(nba);
    byKey.set(personKey, {
      personKey, kind, displayName, birthdate: null, nbaPersonId: nba, playerId: nba != null ? playerByNba.get(nba) ?? null : null,
    });
  };

  // Move refs naming a BBRef id first (they may carry the NBA.com id too), then `nba:` rows only for ids no row holds.
  const refs = src.moves.flatMap((m) => m.parts.map((p) => p.person).filter((r) => r != null));
  for (const r of refs) if (r.bbrefId) add(r.bbrefId, kindOfBbrefId(r.bbrefId), r.name, r.nbaPersonId ?? null);
  for (const c of src.coachSeasons) add(c.bbrefId, 'coach', c.name);
  for (const e of src.execTerms) if (e.personKey) add(e.personKey, 'executive', e.name);
  for (const r of [...src.salaries, ...src.contracts]) add(r.bbrefId, 'player', r.name);
  for (const r of refs) {
    if (r.bbrefId || r.nbaPersonId == null || nbaHeld.has(r.nbaPersonId)) continue;
    add(`nba:${r.nbaPersonId}`, 'player', r.name, r.nbaPersonId);
  }
  for (const p of src.picks) {
    if (!p.selectedPersonKey || p.overall == null) continue;
    const name = src.draftNames.get(`${p.year}-${p.overall}`);
    if (name) add(p.selectedPersonKey, 'player', name);
  }
  return [...byKey.values()];
}
