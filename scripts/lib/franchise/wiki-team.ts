// scripts/lib/franchise/wiki-team.ts
// The "Los Angeles Clippers" Wikipedia article: retired numbers, individual awards, All-Star Weekend,
// Hall of Famers and head coaches.
//
// Award lists are "'''[[Award]]'''" headings, each followed by "*[[Player]] – 2014, 2016" or
// "– 2012–2014" lines. Wikipedia names an award by the year it was given (the season's END year), so
// seasonId = year - 1. Categories with no honor code (Sportsmanship, Hustle, Teammate of the Year,
// Slam Dunk) are listed in skippedCategories, never silently dropped.
//
// Beyond the plan's interface: Hall of Famers (honor 'hall_of_fame', seasonId null, detail = induction
// year) go into `awards`, and `skippedCategories` reports the award headings that have no honor code.
// The real article's "Head coaches" section is only a {{main|…}} pointer, so coaches is usually empty;
// BBRef's coach pages (Task 4) are the coach source.
import { linkTargets, plainText, readTable, section, stripComments, stripRefs, tables } from './wikitext.js';

export interface Honor {
  seasonId: number | null;
  name: string;
  honor: string;
  detail: string | null;
}

export interface TeamArticle {
  retired: Honor[];
  awards: Honor[];
  allStars: Honor[];
  coaches: Array<{ name: string; from: number; to: number | null }>;
  /** Award headings read but not mapped to an honor code. */
  skippedCategories: string[];
}

/** Checked in order: the All-Star MVP before plain MVP, and so on. */
const CATEGORY_CODES: Array<[RegExp, string]> = [
  [/all-star game most valuable player|all-star game mvp/i, 'all_star_mvp'],
  [/all-star (?:selections|game)/i, 'all_star'],
  [/most valuable player/i, 'mvp'],
  [/rookie of the year/i, 'roy'],
  [/defensive player of the year/i, 'dpoy'],
  [/sixth man/i, 'smoy'],
  [/most improved/i, 'mip'],
  [/coach of the year/i, 'coy'],
  [/executive of the year/i, 'eoy'],
  [/clutch player/i, 'clutch'],
  [/all-nba first/i, 'all_nba_1'],
  [/all-nba second/i, 'all_nba_2'],
  [/all-nba third/i, 'all_nba_3'],
  [/all-defensive first/i, 'all_defense_1'],
  [/all-defensive second/i, 'all_defense_2'],
  [/all-rookie first/i, 'all_rookie_1'],
  [/all-rookie second/i, 'all_rookie_2'],
];

function categoryCode(label: string): string | null {
  return CATEGORY_CODES.find(([re]) => re.test(label))?.[1] ?? null;
}

/** "2014, 2016" / "2012–2014" / "2020–2021, 2024" -> [2014, 2016] / [2012, 2013, 2014] / … */
function years(text: string, line: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/\s*,\s*/)) {
    const m = /^(\d{4})(?:\s*[–-]\s*(\d{4}))?$/.exec(part.trim());
    if (!m) throw new Error(`parseTeamArticle: unreadable years in "${line}"`);
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    for (let y = a; y <= b; y++) out.push(y);
  }
  return out;
}

/** "'''[[Award]]'''" headings and the "*[[Player]] – years" lines under them. */
function categoryHonors(body: string | null, skipped: string[]): Honor[] {
  const out: Honor[] = [];
  if (body == null) return out;
  let code: string | null = null;
  for (const raw of stripRefs(body).split('\n')) {
    const line = raw.trim();
    const heading = /^'''(.+)'''$/.exec(line);
    if (heading) {
      const label = plainText(heading[1]);
      code = categoryCode(label);
      if (code == null) skipped.push(label);
      continue;
    }
    if (!line.startsWith('*') || code == null) continue;
    const m = /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/.exec(line);
    if (!m) throw new Error(`parseTeamArticle: no player link in "${line}"`);
    const name = (m[2] ?? m[1]).trim();
    const rest = plainText(line.slice(m.index + m[0].length)).replace(/^[\s–—-]+/, '');
    for (const y of years(rest, line)) out.push({ seasonId: y - 1, name, honor: code, detail: null });
  }
  return out;
}

/** Retired numbers: table rows (number cell + player link) and prose ("[[Bill Russell]]'s No. 6"). */
function retiredNumbers(body: string | null): Honor[] {
  const out: Honor[] = [];
  if (body == null) return out;
  const text = stripRefs(body);
  for (const t of tables(text)) {
    for (const row of readTable(t)) {
      const num = row.find((c) => /^\d{1,2}$/.test(plainText(c.text)));
      const link = row.map((c) => linkTargets(c.text)[0]).find(Boolean);
      if (num && link) out.push({ seasonId: null, name: link.label, honor: 'retired_number', detail: plainText(num.text) });
    }
  }
  let prose = text;
  for (const t of tables(text)) prose = prose.replace(t, '');
  for (const m of prose.matchAll(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]'s No\. (\d{1,2})\b/g)) {
    out.push({ seasonId: null, name: (m[2] ?? m[1]).trim(), honor: 'retired_number', detail: m[3] });
  }
  return out;
}

/** Hall of Famers table: rows with a person link and an induction year in the last cell. */
function hallOfFame(body: string | null): Honor[] {
  const out: Honor[] = [];
  if (body == null) return out;
  for (const t of tables(stripRefs(body))) {
    for (const row of readTable(t)) {
      if (row.every((c) => c.header)) continue;
      const year = plainText(row[row.length - 1].text);
      const link = row.map((c) => linkTargets(c.text)[0]).find(Boolean);
      if (link && /^\d{4}$/.test(year)) out.push({ seasonId: null, name: link.label, honor: 'hall_of_fame', detail: year });
    }
  }
  return out;
}

/** Lines (list items or one-line table rows) with a person link and a "1972–1976" / "2020–present" range. */
function headCoaches(body: string | null): TeamArticle['coaches'] {
  const out: TeamArticle['coaches'] = [];
  if (body == null) return out;
  for (const line of stripRefs(body).split('\n')) {
    const link = linkTargets(line)[0];
    const m = /(\d{4})\s*[–-]\s*(\d{4}|present)/i.exec(plainText(line));
    if (link && m) out.push({ name: link.label, from: Number(m[1]), to: /present/i.test(m[2]) ? null : Number(m[2]) });
  }
  return out;
}

export function parseTeamArticle(wikitext: string): TeamArticle {
  const w = stripComments(wikitext);
  const skippedCategories: string[] = [];
  const awards = categoryHonors(section(w, 'Individual awards'), skippedCategories);
  const allStars = categoryHonors(section(w, 'NBA All-Star Weekend'), skippedCategories);
  return {
    retired: retiredNumbers(section(w, 'Retired numbers')),
    awards: [...awards, ...hallOfFame(section(w, 'Basketball Hall of Famers'))],
    allStars,
    coaches: headCoaches(section(w, 'Head coaches')),
    skippedCategories,
  };
}
