// scripts/lib/franchise/wiki-season.ts
// Wikipedia Clippers season pages: the ===Trades=== table -> structured trades.
//
// Each trade is a date cell plus one "To '''[[Team]]'''<hr>…" cell per side. A rowspan date can cover
// several trades on one day (a two-team deal and then a three-team deal), so within one date a new
// trade starts at a second Clippers side or at a "Three-team trade" label row. Entries are one per
// line (<br>, <hr>, newline or "*" bullet), sometimes several per line ("[[A]], [[B]] & 1986 …").
//
// parseSeasonTrades returns { moves, unparsed }: the plan's signature returned ParsedMove[] only, but a
// trade we can't read must never be silently dropped, so it comes back in `unparsed` (whole trade, as
// plain text) for the import report. UnparsedLine.index is the trade's 1-based position in the section,
// the same n as in its would-be sourceKey `wiki:<page>#<n>`.
import { NBA_TEAM_IDS } from '../nba-teams.js';
import { franchiseFromName } from './team-names.js';
import type { FranchiseId, MoveKind, MovePart, ParsedMove, PickRef, SwapRef, UnparsedLine } from './types.js';
import { linkTargets, plainText, readTable, replaceTemplates, section, stripComments, stripRefs, tables, type Cell } from './wikitext.js';

const LAC = NBA_TEAM_IDS.LAC;
/** Link targets are current article titles: resolved against the current eras when the season's names miss. */
const LATEST = 9999;

export interface WikiUnparsed extends UnparsedLine {
  /** Why the trade wasn't read (for the report; not stored). */
  reason: string;
}

export interface SeasonTrades {
  moves: ParsedMove[];
  unparsed: WikiUnparsed[];
}

class Unreadable extends Error {}

// ---- teams -------------------------------------------------------------------

function norm(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** "LA Clippers" / "L.A. Clippers" -> "Los Angeles Clippers". */
function expandLA(s: string): string {
  return s.replace(/^\s*(?:the\s+)?L\.?\s?A\.?\s+/i, 'Los Angeles ');
}

/** A team as written in a cell: a link (resolved on its target first) or plain text. */
function resolveTeam(text: string, seasonId: number): FranchiseId | null {
  const link = linkTargets(text)[0];
  if (link) {
    const target = link.target.replace(/#.*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    return franchiseFromName(target, seasonId) ?? franchiseFromName(expandLA(link.label), seasonId) ?? franchiseFromName(target, LATEST);
  }
  return franchiseFromName(expandLA(plainText(text)), seasonId);
}

interface Side {
  team: FranchiseId;
  /** Names the cell used for the team, to settle "(from Los Angeles)" among the trade's sides. */
  names: string[];
  /** The cell's wikitext; entries are read from it once the whole trade is known. */
  raw: string;
}

/** "(from X)": a franchise name, or a city shared by two franchises ("Los Angeles") settled among the sides. */
function fromTeam(x: string, sides: Side[], seasonId: number): FranchiseId {
  if (linkTargets(x).length) {
    const id = resolveTeam(x, seasonId);
    if (id != null) return id;
  }
  const name = expandLA(plainText(x));
  const id = franchiseFromName(name, seasonId);
  if (id != null) return id;
  const n = norm(name);
  const hits = new Set(sides.filter((s) => s.names.some((m) => norm(m) === n || norm(m).startsWith(`${n} `))).map((s) => s.team));
  if (hits.size === 1) return [...hits][0];
  throw new Unreadable(`unknown team "(from ${x})"`);
}

// ---- cells -------------------------------------------------------------------

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * "June 28, [[2017–18 NBA season|2017]]", "February 6, {{nbay|2019|end}}", or "July 8" with no year
 * (2023–24): June to December is the season's start year, January to May the next.
 */
function cellDate(text: string, seasonId: number): string | null {
  const s = plainText(replaceTemplates(stripRefs(text), (name, args) => {
    if (!/^nbay$/i.test(name) || !/^\d{4}$/.test(args[0]?.trim() ?? '')) return '';
    return String(Number(args[0]) + (args[1]?.trim() === 'end' ? 1 : 0));
  }));
  const m = /^([A-Za-z]+)\.? (\d{1,2})(?:, (\d{4}))?$/.exec(s);
  const month = m ? MONTHS.indexOf(m[1].toLowerCase()) + 1 : 0;
  if (!m || month === 0) return null;
  const year = m[3] ? Number(m[3]) : month >= 6 ? seasonId : seasonId + 1;
  return `${year}-${String(month).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

/** Footnotes ({{efn…}}, <ref group=…>) as raw notes, then citation refs and other templates removed. */
function clean(raw: string, notes: string[]): string {
  let s = stripComments(raw).replace(/<ref\b[^>]*\bgroup\s*=[^>]*>([\s\S]*?)<\/ref\s*>/gi, (_, n: string) => {
    notes.push(plainText(n));
    return '';
  });
  s = replaceTemplates(s, (name, args) => {
    if (/^efn/i.test(name)) notes.push(plainText(args.filter((a) => !/^\s*name\s*=/.test(a)).join('|')));
    return '';
  });
  return stripRefs(s);
}

const TO_CELL = /^To\b\s*([\s\S]*?)\s*(?:<hr\s*\/?>|-{4,})([\s\S]*)$/i;

function isLabel(c: Cell): boolean {
  return /^\S+-team trade$/i.test(plainText(c.text));
}

// ---- entries -----------------------------------------------------------------

type Asset = Omit<MovePart, 'from' | 'to'> & { origin?: string; signRight?: boolean };

const R = String.raw`(first|second|third|fourth|fifth|sixth|seventh|1st|2nd|3rd|4th|5th|6th|7th)`;
const ROUNDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  '1st': 1, '2nd': 2, '3rd': 3, '4th': 4, '5th': 5, '6th': 6, '7th': 7,
};
const round = (r: string) => ROUNDS[r.toLowerCase()];
const COUNT: Record<string, number> = { two: 2, three: 3, '2': 2, '3': 3 };
const PROT = '(protected|unprotected|conditional)';
const RD = String.raw`[- ]round`;
const PICKWORD = String.raw`(?:draft )?(?:pick|choice)`;

/** "protected" with no detail is a pick whose protections nobody recorded. "unprotected" is recorded. */
function protect(p: { protectionsText?: string }, word: string | undefined): { gap?: 'protections_unknown' } {
  if (!word) return {};
  p.protectionsText = word.toLowerCase();
  return word.toLowerCase() === 'unprotected' ? {} : { gap: 'protections_unknown' };
}

function tricode(t: string | undefined): FranchiseId | undefined {
  if (!t) return undefined;
  const id = NBA_TEAM_IDS[t];
  if (id == null || t !== t.toUpperCase()) throw new Unreadable(`unknown tricode "${t}"`);
  return id;
}

function pick(year: number, r: number, extra: Partial<PickRef> = {}): PickRef {
  return { year, round: r, ...extra };
}

/** A pick we can't pin down; any protection word is kept, but the gap is the missing identity. */
function vague(item: string, year: number, r: number, n = 1, prot?: string): Asset[] {
  return Array.from({ length: n }, () => {
    const p = pick(year, r, { vague: true });
    protect(p, prot);
    return { kind: 'pick' as const, pick: p, text: item, gap: 'pick_unidentified' as const };
  });
}

/** Phrases that name several picks or swaps ("1990 & 1992 first-round draft picks"); replaced by {Kn} before splitting on "and". */
const COMPOUND: Array<[RegExp, (m: RegExpExecArray) => Asset[]]> = [
  [new RegExp(String.raw`(\d{4})((?:\s*(?:,|&|and)\s*\d{4})+) ${R}${RD} ${PICKWORD}s`, 'gi'), (m) =>
    [m[1], ...m[2].split(/\s*(?:,|&|and)\s*/).filter(Boolean)].map((y) => ({ kind: 'pick', pick: pick(Number(y), round(m[3])) }))],
  [new RegExp(String.raw`(\d{4}) ${R}(?:${RD})? (?:&|and) ${R}${RD} ${PICKWORD}s`, 'gi'), (m) =>
    [m[2], m[3]].map((r) => ({ kind: 'pick', pick: pick(Number(m[1]), round(r)) }))],
  [new RegExp(String.raw`(\d{4}) ${R}${RD} (?:&|and) (\d{4}) ${R}${RD} ${PICKWORD}s`, 'gi'), (m) =>
    [[m[1], m[2]], [m[3], m[4]]].map(([y, r]) => ({ kind: 'pick', pick: pick(Number(y), round(r)) }))],
  // "Right to swap first-round picks in 2023 and 2025"
  [new RegExp(String.raw`right to swap ${R}${RD} (?:draft )?picks in (\d{4}) and (\d{4})`, 'gi'), (m) =>
    [swap(Number(m[2]), round(m[1])), swap(Number(m[3]), round(m[1]))]],
];

const ITEM_RULES: Array<[RegExp, (m: RegExpExecArray, item: string, ctx: LineCtx) => Asset[]]> = [
  [/^\{L(\d+)\}$/, (m, _, c) => [{ kind: 'player', person: { name: c.link(m[1]) } }]],
  [/^coach \{L(\d+)\}$/i, (m, _, c) => [{ kind: 'other', person: { name: c.link(m[1]) }, text: 'Head Coach' }]],
  [/^(?:the )?draft rights to \{L(\d+)\}$/i, (m, _, c) => [{ kind: 'draft_rights', person: { name: c.link(m[1]) } }]],
  [/^(?:the )?right to sign \{L(\d+)\} as an? (?:veteran )?free agent$/i, (m, _, c) =>
    [{ kind: 'player', person: { name: c.link(m[1]) }, signRight: true }]],
  [/^cash(?: considerations?)?$/i, () => [{ kind: 'cash', text: 'cash' }]],
  [/^(?:an? )?(?:future|draft) considerations?$/i, (_, item) => [{ kind: 'other', text: item.toLowerCase() }]],
  [/^\{K(\d+)\}$/, (m, _, c) => c.compound[Number(m[1])]],
  // "2018 first-round pick", "1971 2nd round draft pick", "2024 POR second-round pick", "Protected 2022 second-round pick"
  [new RegExp(String.raw`^(?:${PROT} )?(\d{4}) (?:([A-Za-z]{3}) )?(?:${PROT} )?${R}${RD} ${PICKWORD}$`, 'i'), (m) => {
    const p = pick(Number(m[2]), round(m[5]));
    const gap = protect(p, m[1] ?? m[4]);
    const orig = tricode(m[3]);
    if (orig != null) p.originalFranchiseId = orig;
    return [{ kind: 'pick', pick: p, ...gap }];
  }],
  // "Two 1979 second round draft picks"
  [new RegExp(String.raw`^(two|three) (\d{4}) ${R}${RD} ${PICKWORD}s$`, 'i'), (m) =>
    Array.from({ length: COUNT[m[1].toLowerCase()] }, () => ({ kind: 'pick' as const, pick: pick(Number(m[2]), round(m[3])) }))],
  // "Future draft pick", "Two future second-round draft picks", "A future protected first-round draft pick"
  [new RegExp(String.raw`^(?:(two|three) )?future (?:${PROT} )?(?:${R}${RD} )?${PICKWORD}s?$`, 'i'), (m, item) =>
    vague(item, 0, m[3] ? round(m[3]) : 0, m[1] ? COUNT[m[1].toLowerCase()] : 1, m[2])],
  // "A second-round draft pick" (no year)
  [new RegExp(String.raw`^${R}${RD} ${PICKWORD}$`, 'i'), (m, item) => vague(item, 0, round(m[1]))],
  // "15th pick in the 1970 NBA Draft": every pick up to 17th was a first-rounder from 1970 on.
  [/^(\d+)(?:st|nd|rd|th) pick (?:in|of) the (\d{4}) NBA draft$/i, (m) => {
    if (Number(m[1]) > 17) throw new Unreadable(`round of overall pick ${m[1]} unknown`);
    return [{ kind: 'pick', pick: pick(Number(m[2]), 1) }];
  }],
  // "1989 second or third-round draft pick", "1996 or 1997 second-round draft pick"
  [new RegExp(String.raw`^(\d{4}) (?:conditional )?${R} or ${R}${RD} ${PICKWORD}$`, 'i'), (m, item) => vague(item, Number(m[1]), 0)],
  [new RegExp(String.raw`^\d{4} or \d{4} ${R}${RD} ${PICKWORD}$`, 'i'), (m, item) => vague(item, 0, round(m[1]))],
  // Swaps: "Option to swap 2011 second-round draft picks", "Right to swap first-round picks in 2023 and 2025",
  // "2021 LAC first-round pick swap", "2030 second-round pick swap right", "2029 protected right to swap first-round picks"
  [new RegExp(String.raw`^(?:option|right) to swap (\d{4}) ${R}${RD} (?:draft )?picks$`, 'i'), (m) => [swap(Number(m[1]), round(m[2]))]],
  [new RegExp(String.raw`^(\d{4}) (?:([A-Za-z]{3}) )?(?:${PROT} )?${R}${RD} (?:draft )?pick swap(?: right)?$`, 'i'), (m) =>
    [swap(Number(m[1]), round(m[4]), m[3], tricode(m[2]))]],
  [new RegExp(String.raw`^(\d{4}) (?:${PROT} )?right to swap ${R}${RD} (?:draft )?picks$`, 'i'), (m) => [swap(Number(m[1]), round(m[3]), m[2])]],
];

/** A swap right; its two franchises are filled in once the part's from/to are known. */
function swap(year: number, r: number, prot?: string, a?: FranchiseId): Asset {
  const s = { year, round: r, franchiseA: a ?? 0, franchiseB: 0 } as SwapRef;
  const gap = protect(s, prot);
  return { kind: 'swap', swap: s, ...gap };
}

interface LineCtx {
  link(n: string): string;
  compound: Asset[][];
}

// Parentheticals that annotate an entry without changing it.
const ANNOTATION = /^(?:sign-and-trade|two-way contract|#\d+|No\. ?\d+|\d{4} (?:#|No\. ?)\d+|\d+(?:st|nd|rd|th) pick)$/i;

/** One entry line -> assets, each tagged with the line's "(from X)" text if any. */
function lineAssets(line: string): Asset[] {
  const links: Array<{ target: string; label: string }> = [];
  let s = line.replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, t: string, l?: string) => {
    links.push({ target: t.trim(), label: (l ?? t).trim() });
    return `{L${links.length - 1}}`;
  });
  const linkText = (x: string) => x.replace(/\{L(\d+)\}/g, (_, n: string) => `[[${links[Number(n)].target}|${links[Number(n)].label}]]`);
  s = plainText(s); // {Ln} tokens carry no markup, so they survive
  let origin: string | undefined;
  s = s.replace(/\s*\(from ([^()]+)\)\s*\.?\s*$/i, (_, x: string) => {
    origin = linkText(x.trim());
    return '';
  });
  s = s.replace(/\s*\(([^()]*)\)/g, (all, inner: string) => {
    const label = inner.replace(/\{L(\d+)\}/g, (_, n: string) => links[Number(n)].label).trim();
    return ANNOTATION.test(label) ? '' : all;
  });
  s = s.replace(/\s+as compensation\.?$/i, '').replace(/\.$/, '').trim();
  const compound: Asset[][] = [];
  for (const [re, build] of COMPOUND) {
    s = s.replace(re, (...args) => {
      const m = args.slice(0, -2) as unknown as RegExpExecArray;
      compound.push(build(m));
      return `{K${compound.length - 1}}`;
    });
  }
  const ctx: LineCtx = { link: (n) => links[Number(n)].label, compound };
  const items = s.split(/\s*,\s*(?:and\s+|&\s+)?|\s+&\s+|\s+and\s+/).map((x) => x.trim());
  if (items.some((x) => x === '')) throw new Unreadable(`empty item in "${line}"`);
  const out: Asset[] = [];
  for (const raw of items) {
    const item = raw.replace(/^(?:an?|the)\s+/i, '');
    const rule = ITEM_RULES.find(([re]) => re.test(item));
    if (!rule) throw new Unreadable(`unknown entry "${linkText(item)}"`);
    for (const a of rule[1](rule[0].exec(item)!, item, ctx)) out.push(origin ? { ...a, origin } : a);
  }
  return out;
}

/** The cell's entries: one per line, "<br>", "<hr>" or "*" bullet. Struck-through entries (<s>…</s>) are no longer part of the trade. */
function entryLines(body: string): string[] {
  return body
    .replace(/<s>[\s\S]*?<\/s>/gi, '')
    .split(/<br\s*\/?>|<hr\s*\/?>|\n/i)
    .map((l) => l.replace(/^[\s*#:]+/, '').trim())
    .filter((l) => plainText(l) !== '');
}

// ---- trades ------------------------------------------------------------------

interface Group {
  dateCell: Cell | null;
  sides: Side[];
  extra: string[];
  cells: Cell[];
}

function groupHasLac(g: Group): boolean {
  return g.sides.some((s) => s.team === LAC);
}

export function parseSeasonTrades(wikitext: string, seasonId: number, page: string): SeasonTrades {
  const out: SeasonTrades = { moves: [], unparsed: [] };
  const body = section(stripComments(wikitext), 'Trades');
  if (body == null) return out;

  const groups: Group[] = [];
  for (const table of tables(body)) {
    let cur: Group | null = null;
    for (const row of readTable(table)) {
      const own = row.filter((c) => !c.spanned);
      if (own.length === 0) continue;
      const toCells = own.filter((c) => TO_CELL.test(stripRefs(c.text).trim()));
      // The table's own header row ("Date | Trade | Ref.").
      if (toCells.length === 0 && own.every((c) => c.header) && !own.some((c) => cellDate(c.text, seasonId))) continue;

      const first = row[0];
      const firstIsDate = !TO_CELL.test(stripRefs(first.text).trim()) && !isLabel(first);
      const sides: Side[] = toCells.map((c) => {
        const notes: string[] = [];
        const m = TO_CELL.exec(clean(c.text, notes).trim())!;
        const header = m[1].replace(/'{2,}/g, '').trim();
        const team = resolveTeam(header, seasonId);
        const link = linkTargets(header)[0];
        const names = [plainText(header), ...(link ? [link.label, link.target.replace(/#.*$/, '')] : [])];
        return { team: team ?? -1, names, raw: c.text };
      });
      const label = own.some(isLabel);
      const prev = cur as Group | null;
      const startNew =
        prev == null ||
        (firstIsDate && !first.spanned) ||
        (label && prev.sides.length > 0) ||
        (sides.some((s) => s.team === LAC) && groupHasLac(prev));
      const g: Group = startNew ? { dateCell: firstIsDate ? first : (prev?.dateCell ?? null), sides: [], extra: [], cells: [] } : prev!;
      if (startNew) groups.push(g);
      cur = g;
      g.sides.push(...sides);
      g.cells.push(...own);
      for (const c of own) {
        if (toCells.includes(c) || isLabel(c) || (firstIsDate && c === first)) continue;
        const t = plainText(c.text);
        if (t) g.extra.push(t);
      }
    }
  }

  groups.forEach((g, i) => {
    const n = i + 1;
    const date = g.dateCell ? cellDate(g.dateCell.text, seasonId) : null;
    try {
      if (date == null) throw new Unreadable('no date');
      if (g.extra.length) throw new Unreadable(`unexpected cell "${g.extra[0]}"`);
      const built = buildTrade(g, seasonId);
      out.moves.push({
        sourceKey: `wiki:${page}#${n}`,
        date,
        kind: built.kind,
        parts: built.parts,
        involvesClippers: true,
        complete: built.parts.every((p) => !p.gap),
        ...(built.notes.length ? { notes: built.notes } : {}),
      });
    } catch (e) {
      if (!(e instanceof Unreadable)) throw e;
      const text = [g.dateCell, ...g.cells.filter((c) => c !== g.dateCell)].filter(Boolean).map((c) => plainText(c!.text)).filter(Boolean).join(' | ');
      out.unparsed.push({ source: page, index: n, date, text, reason: e.message });
    }
  });
  return out;
}

function buildTrade(g: Group, seasonId: number): { kind: MoveKind; parts: MovePart[]; notes: string[] } {
  if (g.sides.length < 2) throw new Unreadable(`${g.sides.length} side(s)`);
  const bad = g.sides.find((s) => s.team === -1);
  if (bad) throw new Unreadable(`unknown team "${bad.names[0]}"`);
  if (!groupHasLac(g)) throw new Unreadable('no Clippers side');
  const multi = g.sides.length > 2;
  const notes: string[] = [];
  const parts: MovePart[] = [];
  let signing = false;
  for (const side of g.sides) {
    const body = TO_CELL.exec(clean(side.raw, notes).trim())![2];
    const counterparty = multi ? null : g.sides.find((s) => s !== side)!.team;
    const lines = entryLines(body);
    if (lines.length === 0) throw new Unreadable(`empty side "${side.names[0]}"`);
    for (const line of lines) {
      for (const a of lineAssets(line)) {
        const { origin, signRight, ...asset } = a;
        let from: FranchiseId | null = counterparty;
        if (origin) {
          const x = fromTeam(origin, g.sides, seasonId);
          if (x === side.team) throw new Unreadable(`"(from ${origin})" names the receiving team`);
          if (multi || x === counterparty) from = x;
          else if (asset.kind === 'pick' && asset.pick!.originalFranchiseId == null) asset.pick!.originalFranchiseId = x; // a pick another team once owned
          else if (asset.kind !== 'pick') from = x;
        }
        if (signRight) {
          // Matches the BBRef shape: the signing team gets the player from nowhere (he's a free agent);
          // the other way, he leaves the Clippers.
          signing = true;
          from = side.team === LAC ? null : LAC;
        }
        if (asset.kind === 'swap') {
          const s = asset.swap!;
          s.franchiseA = s.franchiseA || (from ?? 0);
          s.franchiseB = side.team;
          if (!s.franchiseA) throw new Unreadable('swap with unknown giver');
        }
        parts.push({ from, to: side.team, ...asset });
      }
    }
  }
  return { kind: signing ? 'signing' : 'trade', parts, notes: notes.filter(Boolean) };
}
