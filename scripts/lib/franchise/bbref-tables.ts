// scripts/lib/franchise/bbref-tables.ts
// Parsers for the Basketball-Reference tables the franchise pipeline reads.
// Cells are found by data-stat, never by column position. Unknown is null, never 0.
import { parse, type HTMLElement } from 'node-html-parser';

/** BBRef hides many tables inside HTML comments; drop the markers so they parse as markup. */
export function uncomment(html: string): string {
  return html.replace(/<!--/g, '').replace(/-->/g, '');
}

export interface RosterRow { bbrefId: string; name: string; number: string | null; birthdate: string | null }
export interface SalaryRow { bbrefId: string; name: string; amountUsd: number }
export interface DraftRow { year: number; round: number; overall: number; name: string; bbrefId: string | null }
export type ContractOption = 'player' | 'team' | 'early_termination';
export interface ContractRow {
  bbrefId: string; name: string;
  seasons: Array<{ seasonId: number; amountUsd: number; option: ContractOption | null }>;
  guaranteedUsd: number | null;
}
export interface CoachSeasonRow {
  seasonId: number; bbrefId: string; name: string; games: number; wins: number; losses: number;
  playoffWins: number | null; playoffLosses: number | null; order: number;
}
export interface CoachStintRow {
  bbrefId: string; name: string; fromSeasonId: number; toSeasonId: number;
  games: number; wins: number; losses: number; playoffWins: number | null; playoffLosses: number | null;
}
export interface ExecRow {
  bbrefId: string | null; name: string; title: string | null; start: string | null; end: string | null;
  notes: string | null;
}

// ---- helpers ---------------------------------------------------------------

function doc(html: string): HTMLElement {
  return parse(uncomment(html));
}

/** Data rows of the table with this id (header and over-header rows are skipped). */
function dataRows(root: HTMLElement, tableId: string | RegExp): HTMLElement[] {
  const tables = root.querySelectorAll('table').filter((t) => {
    const id = t.getAttribute('id') ?? '';
    return typeof tableId === 'string' ? id === tableId : tableId.test(id);
  });
  const rows: HTMLElement[] = [];
  for (const t of tables) {
    for (const tr of t.querySelectorAll('tr')) {
      if (tr.querySelector('th[scope="col"]')) continue;
      if ((tr.getAttribute('class') ?? '').includes('thead')) continue;
      rows.push(tr);
    }
  }
  return rows;
}

function cell(row: HTMLElement, stat: string): HTMLElement | null {
  return row.querySelector(`[data-stat="${stat}"]`);
}

function text(row: HTMLElement, stat: string): string | null {
  const c = cell(row, stat);
  if (!c) return null;
  const t = c.text.replace(/ /g, ' ').trim();
  return t === '' ? null : t;
}

function intOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/[,$]/g, ''));
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/** "$1,350,000" or a csk="1350000" attribute -> integer dollars. */
function money(c: HTMLElement | null): number | null {
  if (!c) return null;
  const csk = c.getAttribute('csk');
  if (csk && /^\d+$/.test(csk)) return Number(csk);
  const t = c.text.trim();
  if (!t) return null;
  const n = Number(t.replace(/[$,]/g, ''));
  return Number.isFinite(n) ? Math.round(n) : null;
}

function playerId(c: HTMLElement | null): string | null {
  if (!c) return null;
  const append = c.getAttribute('data-append-csv');
  if (append) return append;
  const href = c.querySelector('a')?.getAttribute('href') ?? '';
  return /\/players\/[a-z]\/([^/.]+)\.html/.exec(href)?.[1] ?? null;
}

function linkName(c: HTMLElement | null): string {
  const a = c?.querySelector('a');
  return (a ? a.text : c?.text ?? '').replace(/ /g, ' ').trim();
}

// ---- roster / salaries -----------------------------------------------------

export function parseRoster(html: string): RosterRow[] {
  const out: RosterRow[] = [];
  for (const tr of dataRows(doc(html), 'roster')) {
    const p = cell(tr, 'player');
    const bbrefId = playerId(p);
    if (!p || !bbrefId) continue;
    const csk = cell(tr, 'birth_date')?.getAttribute('csk') ?? '';
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(csk);
    out.push({
      bbrefId,
      name: linkName(p),
      number: text(tr, 'number'),
      birthdate: m ? `${m[1]}-${m[2]}-${m[3]}` : null,
    });
  }
  return out;
}

export function parseSalaries(html: string): SalaryRow[] {
  const out: SalaryRow[] = [];
  for (const tr of dataRows(doc(html), /^salaries/)) {
    const p = cell(tr, 'player');
    const bbrefId = playerId(p);
    const amountUsd = money(cell(tr, 'salary'));
    if (!p || !bbrefId || amountUsd == null) continue;
    out.push({ bbrefId, name: linkName(p), amountUsd });
  }
  return out;
}

// ---- draft -----------------------------------------------------------------

export function parseFranchiseDraft(html: string): DraftRow[] {
  const out: DraftRow[] = [];
  for (const tr of dataRows(doc(html), 'draft')) {
    const year = intOrNull(text(tr, 'year_id'));
    const round = intOrNull(text(tr, 'round'));
    const overall = intOrNull(text(tr, 'pick_overall'));
    const p = cell(tr, 'player');
    if (year == null || round == null || overall == null || !p) continue;
    out.push({ year, round, overall, name: linkName(p), bbrefId: playerId(p) });
  }
  return out;
}

// ---- contracts -------------------------------------------------------------

const OPTION_CLASS: Array<[string, ContractOption]> = [
  ['salary-pl', 'player'], ['salary-tm', 'team'], ['salary-et', 'early_termination'],
];

export function parseContracts(html: string): ContractRow[] {
  const root = doc(html);
  const table = root.querySelector('table#contracts');
  if (!table) return [];
  // y1..yN headers carry the season label, e.g. "2026-27" -> 2026.
  const yearOf = new Map<string, number>();
  for (const th of table.querySelectorAll('th[scope="col"]')) {
    const stat = th.getAttribute('data-stat') ?? '';
    const m = /^(\d{4})-\d{2}$/.exec(th.text.trim());
    if (/^y\d+$/.test(stat) && m) yearOf.set(stat, Number(m[1]));
  }
  const out: ContractRow[] = [];
  for (const tr of dataRows(root, 'contracts')) {
    const p = cell(tr, 'player');
    if (!p) continue;
    const bbrefId = p.getAttribute('csk') && /^[a-z]+\d{2}$/.test(p.getAttribute('csk')!)
      ? p.getAttribute('csk')!
      : playerId(p);
    if (!bbrefId) continue;
    const seasons: ContractRow['seasons'] = [];
    for (const [stat, seasonId] of yearOf) {
      const c = cell(tr, stat);
      const amountUsd = money(c);
      if (!c || amountUsd == null) continue;
      const cls = (c.getAttribute('class') ?? '').split(/\s+/);
      const option = OPTION_CLASS.find(([k]) => cls.includes(k))?.[1] ?? null;
      seasons.push({ seasonId, amountUsd, option });
    }
    seasons.sort((a, b) => a.seasonId - b.seasonId);
    out.push({ bbrefId, name: linkName(p), seasons, guaranteedUsd: money(cell(tr, 'remain_gtd')) });
  }
  return out;
}

// ---- coaches ---------------------------------------------------------------

/**
 * Per-season coach rows from a team-season page ("Coach: A (22-39), B (9-12)").
 * The franchise coaches page only has multi-season stints; see parseCoachStints.
 * Playoff splits are not on the team page, so they are null.
 */
export function parseCoaches(html: string): CoachSeasonRow[] {
  const root = parse(html);
  const title = root.querySelector('meta[property="og:title"]')?.getAttribute('content')
    ?? root.querySelector('title')?.text ?? '';
  let seasonId: number | null = null;
  const t = /\b(\d{4})-\d{2}\b/.exec(title);
  if (t) seasonId = Number(t[1]);
  else {
    const c = /\/teams\/[A-Z]{3}\/(\d{4})\.html/.exec(root.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '');
    if (c) seasonId = Number(c[1]) - 1;
  }
  if (seasonId == null) return [];
  const p = root.querySelectorAll('p').find((el) => el.querySelector('strong')?.text.trim() === 'Coach:');
  if (!p) return [];
  const out: CoachSeasonRow[] = [];
  const re = /<a href="\/coaches\/([^"/.]+)\.html">([^<]+)<\/a>\s*\((\d+)-(\d+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p.innerHTML))) {
    const wins = Number(m[3]);
    const losses = Number(m[4]);
    out.push({
      seasonId, bbrefId: m[1], name: m[2].trim(), games: wins + losses, wins, losses,
      playoffWins: null, playoffLosses: null, order: out.length,
    });
  }
  return out;
}

/** Franchise coaches page: one row per coach with from/to seasons and regular + playoff totals. */
export function parseCoachStints(html: string): CoachStintRow[] {
  const out: CoachStintRow[] = [];
  for (const tr of dataRows(doc(html), 'coaches')) {
    const c = cell(tr, 'coach');
    const href = c?.querySelector('a')?.getAttribute('href') ?? '';
    const bbrefId = /\/coaches\/([^/.]+)\.html/.exec(href)?.[1];
    const from = intOrNull(text(tr, 'year_min'));
    const to = intOrNull(text(tr, 'year_max'));
    const games = intOrNull(text(tr, 'g'));
    const wins = intOrNull(text(tr, 'wins'));
    const losses = intOrNull(text(tr, 'losses'));
    if (!c || !bbrefId || from == null || to == null || games == null || wins == null || losses == null) continue;
    out.push({
      bbrefId, name: linkName(c), fromSeasonId: from, toSeasonId: to, games, wins, losses,
      playoffWins: intOrNull(text(tr, 'wins_playoffs')), playoffLosses: intOrNull(text(tr, 'losses_playoffs')),
    });
  }
  return out;
}

// ---- executives ------------------------------------------------------------

export function parseExecutives(html: string): ExecRow[] {
  const out: ExecRow[] = [];
  for (const tr of dataRows(doc(html), 'executives')) {
    const c = cell(tr, 'exec');
    if (!c) continue;
    const href = c.querySelector('a')?.getAttribute('href') ?? '';
    const end = text(tr, 'date_end');
    out.push({
      bbrefId: /\/executives\/([^/.]+)\.html/.exec(href)?.[1] ?? null,
      name: linkName(c),
      title: null, // the page has no title column
      start: text(tr, 'date_start'),
      end: end && end.toLowerCase() !== 'present' ? end : null,
      notes: text(tr, 'notes'),
    });
  }
  return out;
}
