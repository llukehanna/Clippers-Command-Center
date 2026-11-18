// scripts/lib/franchise/bbref-moves.ts
// Basketball-Reference transaction pages (teams/<T>/<year>_transactions.html) -> structured moves.
// A rule table, one rule per sentence shape. People and teams come from the sentence's links, never
// from its text: each link is swapped for a {P0}/{T1}/{C2}/{L3} token before the rules run.
// Anything no rule matches is returned as unparsed, never stored as prose.
import { HTMLElement, parse, type Node } from 'node-html-parser';
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { bbrefMoveKey } from './keys.js';
import { franchiseFromName } from './team-names.js';
import type { FranchiseId, MoveKind, MovePart, ParsedMove, PersonRef, PickRef, UnparsedLine } from './types.js';

const LAC = NBA_TEAM_IDS.LAC;

/** A link in the sentence: P = player, T = team, C = coach, L = anything else (G League team, ...). */
export interface Ref { kind: 'P' | 'T' | 'C' | 'L'; id: string | null; name: string }

export interface RuleMatch {
  m: RegExpExecArray;
  refs: Ref[];
  date: string;
  seasonId: number;
}

export interface MoveRule {
  kind: MoveKind;
  pattern: RegExp;
  build(m: RuleMatch): Omit<ParsedMove, 'sourceKey' | 'involvesClippers' | 'complete'>;
}

/** Thrown by a rule (or its helpers) when the sentence has the rule's shape but a piece can't be read. */
export class Unreadable extends Error {}

// ---- tokens ------------------------------------------------------------------

const P = String.raw`\{P(\d+)\}`;
const T = String.raw`\{T(\d+)\}`;
const C = String.raw`\{C(\d+)\}`;
const ORD = String.raw`(\d+)(?:st|nd|rd|th)`;

function clean(s: string): string {
  return s.replace(/ /g, ' ').replace(/\s+/g, ' ');
}

function classify(a: HTMLElement): Ref {
  const href = a.getAttribute('href') ?? '';
  const name = clean(a.text).trim();
  let m = /^\/players\/[a-z]\/([^/.]+)\.html$/.exec(href);
  if (m) return { kind: 'P', id: m[1], name };
  m = /^\/coaches\/([^/.]+)\.html$/.exec(href);
  if (m) return { kind: 'C', id: m[1], name };
  if (a.hasAttribute('data-attr-from') || a.hasAttribute('data-attr-to') || href.startsWith('/teams/')) {
    return { kind: 'T', id: null, name };
  }
  return { kind: 'L', id: null, name };
}

/** The sentence with links swapped for tokens, the same sentence as plain text, and the links. */
function tokenize(p: HTMLElement): { tokens: string; plain: string; refs: Ref[] } {
  const refs: Ref[] = [];
  let tokens = '';
  let plain = '';
  const walk = (n: Node) => {
    if (n instanceof HTMLElement && n.tagName === 'A') {
      const ref = classify(n);
      tokens += `{${ref.kind}${refs.length}}`;
      plain += ref.name;
      refs.push(ref);
      return;
    }
    if (n.childNodes.length === 0) {
      tokens += n.text;
      plain += n.text;
      return;
    }
    for (const c of n.childNodes) walk(c);
  };
  for (const c of p.childNodes) walk(c);
  return { tokens: clean(tokens).trim(), plain: clean(plain).trim(), refs };
}

/** The main sentence: everything before the first full stop outside parentheses. The rest are notes. */
function mainSentence(tokens: string): string {
  let depth = 0;
  for (let i = 0; i < tokens.length; i++) {
    const ch = tokens[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (ch === '.' && depth === 0 && (i + 1 === tokens.length || /\s/.test(tokens[i + 1]))) {
      return tokens.slice(0, i).trim();
    }
  }
  return tokens.trim();
}

// ---- pieces ------------------------------------------------------------------

function ref(rm: RuleMatch, idx: string, kind: Ref['kind']): Ref {
  const r = rm.refs[Number(idx)];
  if (!r || r.kind !== kind) throw new Unreadable(`expected a ${kind} link at ${idx}`);
  return r;
}

function person(rm: RuleMatch, idx: string): PersonRef {
  const r = ref(rm, idx, 'P');
  if (!r.id) throw new Unreadable('player link without id');
  return { bbrefId: r.id, name: r.name };
}

function coach(rm: RuleMatch, idx: string): PersonRef {
  const r = ref(rm, idx, 'C');
  return { bbrefId: r.id!, name: r.name };
}

/**
 * A team link -> franchise id. An unknown name makes the whole sentence unparsed, never a null side.
 * From May on, a name may already be next season's: an expansion team in its expansion draft, or
 * trading on draft night before its first season ("the Charlotte Bobcats", June 2004).
 */
function team(rm: RuleMatch, idx: string): FranchiseId {
  const r = ref(rm, idx, 'T');
  let id = franchiseFromName(r.name, rm.seasonId);
  if (id == null && rm.date >= `${rm.seasonId + 1}-05-01`) id = franchiseFromName(r.name, rm.seasonId + 1);
  if (id == null) throw new Unreadable(`unknown team "${r.name}" in season ${rm.seasonId}`);
  return id;
}

type Asset = Omit<MovePart, 'from' | 'to'>;

const ASSET_PICK = new RegExp(String.raw`^a (\d{4}) ${ORD} round draft pick(?: \((?:${P}|([^(){}]+?)) was later selected\))?$`);
const ASSET_FUTURE_PICK = new RegExp(String.raw`^a future (?:${ORD} round )?draft pick$`);
const ASSET_CASH = /^(?:(?:\$[\d.,]+\s?(?:[KkMm]{1,2})?\s+)?cash|\$[\d.,]+\s?(?:[KkMm]{1,2})?)$/;

function asset(rm: RuleMatch, item: string): Asset {
  let m: RegExpExecArray | null;
  if ((m = new RegExp(`^${P}$`).exec(item))) return { kind: 'player', person: person(rm, m[1]) };
  // A coach traded for: "for Paul Silas" (1980), linked to his coach page.
  if ((m = new RegExp(`^${C}$`).exec(item))) return { kind: 'other', person: coach(rm, m[1]), text: 'Head Coach' };
  if ((m = ASSET_PICK.exec(item))) {
    const pick: PickRef = { year: Number(m[1]), round: Number(m[2]) };
    if (m[3]) pick.selected = person(rm, m[3]);
    else if (m[4]) pick.selected = { name: m[4].trim() };
    return { kind: 'pick', pick };
  }
  if ((m = ASSET_FUTURE_PICK.exec(item))) {
    // Year (and maybe round) unknown: 0 means unknown. Left for overrides.
    return { kind: 'pick', pick: { year: 0, round: m[1] ? Number(m[1]) : 0, vague: true }, text: item, gap: 'pick_unidentified' };
  }
  if (ASSET_CASH.test(item)) return { kind: 'cash', text: item };
  if (item === 'future considerations') return { kind: 'other', text: item };
  throw new Unreadable(`unknown asset "${item}"`);
}

/** "A, B and C" -> assets. Splits only on ", " and " and " so "$1,247" stays whole. */
function assets(rm: RuleMatch, list: string): Asset[] {
  const items = list.split(/,\s+(?:and\s+)?|\s+and\s+/).map((s) => s.trim());
  if (items.some((s) => s === '')) throw new Unreadable(`empty item in "${list}"`);
  return items.map((s) => asset(rm, s));
}

function move(from: FranchiseId | null, to: FranchiseId | null, list: Asset[]): MovePart[] {
  return list.map((a) => ({ from, to, ...a }));
}

const player = (rm: RuleMatch, idx: string): Asset => ({ kind: 'player', person: person(rm, idx) });

/** One player moving in one direction: signings, waivers, releases, claims. */
function single(kind: MoveKind, pattern: RegExp, dir: 'in' | 'out'): MoveRule {
  return {
    kind,
    pattern,
    build: (rm) => {
      const other = rm.m[2] != null ? team(rm, rm.m[2]) : null;
      const [from, to] = dir === 'in' ? [other, LAC] : [LAC, other];
      return { date: rm.date, kind, parts: move(from, to, [player(rm, rm.m[1])]) };
    },
  };
}

// ---- rules -------------------------------------------------------------------

export const RULES: MoveRule[] = [
  {
    // "Traded A and B to the T for C and a 2005 2nd round draft pick (X was later selected)"
    kind: 'trade',
    pattern: new RegExp(String.raw`^Traded (.+?) to the ${T}(?: for (.+))?$`),
    build: (rm) => {
      const other = team(rm, rm.m[2]);
      const parts = move(LAC, other, assets(rm, rm.m[1]));
      if (rm.m[3] != null) parts.push(...move(other, LAC, assets(rm, rm.m[3])));
      return { date: rm.date, kind: 'trade', parts };
    },
  },
  {
    // "As part of a 3-team trade, the T1 traded A to the T2; the T2 traded B to the T3; and the T3 traded C to the T1"
    kind: 'trade',
    pattern: /^As part of a (\d+)-team trade, (.+)$/,
    build: (rm) => {
      const parts: MovePart[] = [];
      for (const clause of rm.m[2].split(/;\s+(?:and\s+)?/)) {
        const c = new RegExp(String.raw`^the ${T} traded (.+) to the ${T}$`).exec(clause.trim());
        if (!c) throw new Unreadable(`unknown clause "${clause}"`);
        parts.push(...move(team(rm, c[1]), team(rm, c[3]), assets(rm, c[2])));
      }
      if (!parts.some((p) => p.from === LAC || p.to === LAC)) throw new Unreadable('no Clippers side');
      return { date: rm.date, kind: 'trade', parts };
    },
  },
  {
    kind: 'trade',
    pattern: new RegExp(String.raw`^Acquired player rights to ${P} from the ${T}$`),
    build: (rm) => ({
      date: rm.date, kind: 'trade',
      parts: [{ from: team(rm, rm.m[2]), to: LAC, kind: 'draft_rights', person: person(rm, rm.m[1]) }],
    }),
  },
  {
    kind: 'sale',
    pattern: new RegExp(String.raw`^Sold player rights to ${P} to the ${T}$`),
    build: (rm) => ({
      date: rm.date, kind: 'sale',
      parts: [{ from: LAC, to: team(rm, rm.m[2]), kind: 'draft_rights', person: person(rm, rm.m[1]) }],
    }),
  },
  {
    // "Drafted A in the 1st round (12th pick) of the 2005 NBA Draft"
    kind: 'draft',
    pattern: new RegExp(String.raw`^Drafted ${P} in the ${ORD} round \(${ORD} pick\) of the (\d{4}) NBA Draft$`),
    build: (rm) => ({ date: rm.date, kind: 'draft', parts: move(null, LAC, [player(rm, rm.m[1])]) }),
  },
  {
    // "Signed A as a veteran free agent and sent B to the T as compensation"
    kind: 'signing',
    pattern: new RegExp(String.raw`^Signed ${P} as a veteran free agent and sent (.+) to the ${T} as compensation$`),
    build: (rm) => ({
      date: rm.date, kind: 'signing',
      parts: [...move(null, LAC, [player(rm, rm.m[1])]), ...move(LAC, team(rm, rm.m[3]), assets(rm, rm.m[2]))],
    }),
  },
  single('signing', new RegExp(String.raw`^Signed ${P}(?: as an? (?:free agent|veteran free agent|unrestricted free agent)| to (?:a multi-year contract|an Exhibit 10 contract|a contract for the rest of the season))?$`), 'in'),
  single('ten_day', new RegExp(String.raw`^Signed ${P} to (?:a|a \d+(?:st|nd|rd|th)|the first of two|two) 10-day contracts?(?:, then signed to a contract for the rest of the season)?$`), 'in'),
  single('two_way', new RegExp(String.raw`^Signed ${P} to a two-way contract$`), 'in'),
  single('conversion', new RegExp(String.raw`^Converted ${P} from a two-way contract to a regular contract$`), 'in'),
  single('waiver', new RegExp(String.raw`^Waived ${P}$`), 'out'),
  single('release', new RegExp(String.raw`^Released ${P}$`), 'out'),
  single('claim', new RegExp(String.raw`^Claimed ${P} on waivers from the ${T}$`), 'in'),
  single('claim', new RegExp(String.raw`^${P} claimed on waivers by the ${T}$`), 'out'),
  single('retirement', new RegExp(String.raw`^${P} retired$`), 'out'),
  single('expansion_draft', new RegExp(String.raw`^Lost ${P} to the ${T} in the NBA expansion draft$`), 'out'),
  {
    // "A signed as a veteran free agent with the T; received B as compensation"
    kind: 'signing',
    pattern: new RegExp(String.raw`^${P} signed as an? (?:unrestricted|veteran) free agent with the ${T}(?:; received (.+) as compensation)?$`),
    build: (rm) => {
      const other = team(rm, rm.m[2]);
      const parts = move(LAC, other, [player(rm, rm.m[1])]);
      if (rm.m[3] != null) parts.push(...move(other, LAC, assets(rm, rm.m[3])));
      return { date: rm.date, kind: 'signing', parts };
    },
  },
  {
    // "Received B as compensation for the T signing A as a veteran free agent"
    kind: 'signing',
    pattern: new RegExp(String.raw`^Received (.+) as compensation for the ${T} signing ${P} as a veteran free agent$`),
    build: (rm) => {
      const other = team(rm, rm.m[2]);
      return {
        date: rm.date, kind: 'signing',
        parts: [...move(LAC, other, [player(rm, rm.m[3])]), ...move(other, LAC, assets(rm, rm.m[1]))],
      };
    },
  },
  {
    kind: 'hire',
    pattern: new RegExp(String.raw`^Hired ${C} as Head Coach$`),
    build: (rm) => ({ date: rm.date, kind: 'hire', parts: [{ from: null, to: LAC, kind: 'other', person: coach(rm, rm.m[1]), text: 'Head Coach' }] }),
  },
  {
    // The only unlinked people BBRef names: interim coaches. No id, so the name is all we have.
    kind: 'hire',
    pattern: /^Appointed ([A-Z][^{}]*?) as Interim Head Coach$/,
    build: (rm) => ({ date: rm.date, kind: 'hire', parts: [{ from: null, to: LAC, kind: 'other', person: { name: rm.m[1] }, text: 'Interim Head Coach' }] }),
  },
  {
    kind: 'fire',
    pattern: new RegExp(String.raw`^Fired ${C} as Head Coach$`),
    build: (rm) => ({ date: rm.date, kind: 'fire', parts: [{ from: LAC, to: null, kind: 'other', person: coach(rm, rm.m[1]), text: 'Head Coach' }] }),
  },
  {
    kind: 'other',
    pattern: new RegExp(String.raw`^${C} resigns as Head Coach$`),
    build: (rm) => ({ date: rm.date, kind: 'other', parts: [{ from: LAC, to: null, kind: 'other', person: coach(rm, rm.m[1]), text: 'Resigned as Head Coach' }] }),
  },
];

/** Recognized sentences that are out of scope (spec non-goal: G League moves). Not moves, not unparsed. */
export const SKIP_PATTERNS: RegExp[] = [
  /^Assigned \{P\d+\} to the \{L\d+\} of the G-League$/,
  /^Recalled \{P\d+\} from the \{L\d+\} of the G-League$/,
];

// ---- page --------------------------------------------------------------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "July 14, 2004" -> "2004-07-14"; anything else (BBRef writes "November ?, 1993") -> null. */
function isoDate(text: string): string | null {
  const m = /^([A-Z][a-z]+) (\d{1,2}), (\d{4})$/.exec(clean(text).trim());
  const month = m ? MONTHS.indexOf(m[1]) + 1 : 0;
  if (!m || month === 0) return null;
  return `${m[3]}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function keyTokens(parts: MovePart[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p.pick) out.push(p.pick.vague ? `pickfuture${p.pick.round ? `r${p.pick.round}` : ''}` : `pick${p.pick.year}r${p.pick.round}`);
    else if (p.person?.bbrefId) out.push(p.person.bbrefId);
    else if (p.person) out.push(`name:${p.person.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  }
  return out;
}

export interface SkippedLine extends UnparsedLine {
  /** g_league: out of scope (spec non-goal). duplicate: BBRef lists the same move twice under one date. */
  reason: 'g_league' | 'duplicate';
}

export interface TransactionPage {
  moves: ParsedMove[];
  unparsed: UnparsedLine[];
  /** Lines deliberately not turned into moves, kept so totals can be checked. */
  skipped: SkippedLine[];
}

export function parseTransactionPage(html: string, seasonId: number, page: string): TransactionPage {
  const out: TransactionPage = { moves: [], unparsed: [], skipped: [] };
  let index = 0;
  for (const li of parse(html).querySelectorAll('ul.page_index > li')) {
    const date = isoDate(li.querySelector('span')?.text ?? '');
    for (const p of li.querySelectorAll('p.transaction')) {
      const i = index++;
      const { tokens, plain, refs } = tokenize(p);
      const line: UnparsedLine = { source: page, index: i, date, text: plain };
      const main = mainSentence(tokens);
      if (SKIP_PATTERNS.some((re) => re.test(main))) {
        out.skipped.push({ ...line, reason: 'g_league' });
        continue;
      }
      const built = date == null ? null : buildMove(main, refs, date, seasonId);
      if (!built) {
        out.unparsed.push(line);
        continue;
      }
      const sourceKey = bbrefMoveKey(built.date, built.kind, keyTokens(built.parts));
      const seen = out.moves.find((x) => x.sourceKey === sourceKey);
      if (seen) {
        // The same move listed twice is dropped; two different moves sharing a key can't be told apart.
        if (JSON.stringify(seen.parts) === JSON.stringify(built.parts)) out.skipped.push({ ...line, reason: 'duplicate' });
        else out.unparsed.push(line);
        continue;
      }
      out.moves.push({ sourceKey, ...built, involvesClippers: true, complete: built.parts.every((x) => !x.gap) });
    }
  }
  return out;
}

function buildMove(main: string, refs: Ref[], date: string, seasonId: number) {
  for (const rule of RULES) {
    const m = rule.pattern.exec(main);
    if (!m) continue;
    try {
      return rule.build({ m, refs, date, seasonId });
    } catch (e) {
      if (e instanceof Unreadable) return null;
      throw e;
    }
  }
  return null;
}
