// scripts/lib/franchise/wiki-draft.ts
// Wikipedia "<YYYY> NBA draft" pages: every pick with its provenance ("from X via Y"), and the
// draft lottery table.
//
// The selections table is the page's first table with Round/Pick/Player/Team columns (later tables
// are side drafts: 1971 hardship, 1975 supplementary, 1976 ABA dispersal). "Pick" is the overall
// pick number on every page (1970–2026 checked). The team cell is "[[Team]] <small>(from [[A|a]] via
// [[B|b]])</small>"; recent pages also write "(from A to B to C)", "(from A, B and C)", and a draft-day
// trade as "(traded to X)", "(rights traded to X via Y)" or "…), traded to X". Footnotes ({{refn}},
// {{#tag:ref}}) sit inside the {{small}} and are dropped.
//
// parseDraftPage returns { picks, forfeited, unparsed }: the plan's signature returned DraftPickRow[]
// only, but a row we can't read must never be silently dropped, so it comes back in `unparsed` (the row
// as plain text) for the import report, and a forfeited pick (a row with a team and no selection) comes
// back in `forfeited`. UnparsedLine.index is the overall pick number (the table row number when the row
// has none, e.g. 1974's supplemental picks).
//
// Team names are resolved for the season that just ended (draft in June Y -> season Y-1), then the
// next season (an expansion team drafting before its first season), then the link target as a
// current article title.
import { franchiseFromName } from './team-names.js';
import type { FranchiseId } from './types.js';
import type { WikiUnparsed } from './wiki-season.js';
import { linkTargets, plainText, readTable, replaceTemplates, section, stripComments, stripRefs, tables, type Cell } from './wikitext.js';

export interface DraftPickRow {
  year: number;
  round: number;
  overall: number;
  name: string;
  /** The team that made the pick. */
  teamFranchise: FranchiseId;
  /** Earlier owners, original first: "from Cleveland via Phoenix" -> [CLE, PHX]. */
  chain: FranchiseId[];
  /** "(traded to X via Y)": owners after the pick was made (draft-day trades), final owner last -> [Y, X]. */
  tradedTo: FranchiseId[];
}

/** A pick the league took away ("forfeited due to …"): a table row with no selection. */
export interface ForfeitedPick {
  year: number;
  round: number | null;
  teamFranchise: FranchiseId;
}

export interface DraftPage {
  picks: DraftPickRow[];
  forfeited: ForfeitedPick[];
  unparsed: WikiUnparsed[];
}

export interface LotteryRow {
  year: number;
  franchise: FranchiseId;
  preSlot: number | null;
  /** Chance of the #1 pick, 0–1. */
  oddsFirst: number | null;
  pickWon: number;
}

class Unreadable extends Error {}

/** Link targets are current article titles: resolved against the current eras when the season's names miss. */
const LATEST = 9999;

// ---- teams -------------------------------------------------------------------

/** "LA Clippers" / "L.A. Clippers" -> "Los Angeles Clippers". */
function expandLA(s: string): string {
  return s.replace(/^\s*(?:the\s+)?L\.?\s?A\.?\s+/i, 'Los Angeles ');
}

/** A team as written: a link (target first, then label) or plain text; season Y-1, then Y. */
function resolveTeam(raw: string, year: number): FranchiseId | null {
  const text = raw.replace(/[–—]/g, '-').trim(); // "Kansas City–Omaha Kings"
  const link = linkTargets(text)[0];
  const seasons = [year - 1, year];
  if (link) {
    const target = link.target.replace(/#.*$/, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    for (const s of seasons) {
      const id = franchiseFromName(target, s) ?? franchiseFromName(expandLA(link.label), s);
      if (id != null) return id;
    }
    return franchiseFromName(target, LATEST);
  }
  const plain = expandLA(plainText(text));
  for (const s of seasons) {
    const id = franchiseFromName(plain, s);
    if (id != null) return id;
  }
  return null;
}

function team(text: string, year: number): FranchiseId {
  const id = resolveTeam(text, year);
  if (id == null) throw new Unreadable(`unknown team "${plainText(text)}"`);
  return id;
}

// ---- cells -------------------------------------------------------------------

/** Header text with {{tooltip|Rnd.|…}} / {{abbr|…}} shown as their visible text. */
function headerLabel(text: string): string {
  return plainText(replaceTemplates(stripRefs(text), (name, args) => (/^(?:tooltip|abbr|abbrlink)$/i.test(name) ? args[0] ?? '' : '')))
    .toLowerCase();
}

const positional = (args: string[]) => args.filter((a) => !/^\s*[a-z_]+\s*=/i.test(a)).map((a) => a.trim());

/** "{{sortname|Sean|May}}*", "[[Joe Smith (basketball)|Joe Smith]]<sup>+</sup>" -> the name alone. */
function playerName(text: string): string {
  const s = replaceTemplates(stripRefs(stripComments(text)), (name, args) => {
    const p = positional(args);
    if (/^sortname$/i.test(name)) return `${p[0] ?? ''} ${p[1] ?? ''}`;
    if (/^(?:nowrap|nobr)$/i.test(name)) return p[0] ?? '';
    return '';
  }).replace(/<sup\b[^>]*>[\s\S]*?<\/sup\s*>/gi, '');
  return plainText(s).replace(/[\s*^+~#†‡§¤]+$/u, '').replace(/^[\s*^+~#†‡§¤]+/u, '').trim();
}

/** The team cell's wikitext with refs, footnote templates and tags gone; {{small|…}} kept as its content. */
function teamCellText(text: string): string {
  return replaceTemplates(stripRefs(stripComments(text)), (name, args) => (/^small$/i.test(name) ? teamCellText(args.join('|')) : ''))
    .replace(/<\/?(?:small|span|sup|sub)\b[^>]*>/gi, '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/'{2,}/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface Provenance {
  teamFranchise: FranchiseId;
  chain: FranchiseId[];
  tradedTo: FranchiseId[];
}

/** "A, B and C", "A via B", "A to B to C" -> the teams in order. `unmask` restores the masked links of each name. */
function teamList(text: string, year: number, unmask: (x: string) => string): FranchiseId[] {
  return text.split(/\s*,\s*(?:and\s+)?|\s+(?:and|via|to)\s+/i).map((x) => team(unmask(x), year));
}

const TRADED_WORDS = String.raw`(?:(?:rights|later)\s+)?traded (?:back )?to\b`;
/** "(rights traded to X)", "(traded to X via Y)", "(later traded to X)", "(traded back to X)". */
const TRADED = new RegExp(String.raw`^${TRADED_WORDS}\s+([\s\S]+?)(?:\s+via\s+([\s\S]+))?$`, 'i');
/** Where a "traded to" clause starts after a "from" clause: "(from A, traded to B)", "(… ; later traded to C)". */
const TRADED_SPLIT = new RegExp(String.raw`(?<!\b(?:rights|later))(?:\s*[,;]\s*|\s+)(?=${TRADED_WORDS})`, 'i');

/**
 * "[[Team]] (from [[A|a]] via [[B|b]])", "(from A to B to C)", "(from A, B and C)", "(from A, traded to B)",
 * "(rights traded to X)", "(traded to X via Y)", and "[[Team]] (from A), traded to X".
 */
function provenance(cell: string, year: number): Provenance {
  // Links are masked so a "(…)" inside one ("[[Charlotte Hornets (1988–2002)|…]]") isn't read as a note.
  const links: string[] = [];
  const masked = teamCellText(cell).replace(/\[\[[^\]]*\]\]/g, (l) => `\u0000${links.push(l) - 1}\u0000`);
  const unmask = (x: string) => x.replace(/\u0000(\d+)\u0000/g, (_, n: string) => links[Number(n)]);
  const notes = [...masked.matchAll(/\(([^()]*)\)/g)].map((m) => m[1]);
  const [main, ...tail] = masked.replace(/\([^()]*\)/g, ' ').split(TRADED_SPLIT);
  if (!plainText(unmask(main))) throw new Unreadable('no team');
  const out: Provenance = { teamFranchise: team(unmask(main), year), chain: [], tradedTo: [] };
  const clauses = [...notes, ...tail].flatMap((n) => n.split(TRADED_SPLIT));
  for (const raw of clauses) {
    const c = raw.trim().replace(/^[\s,;]+|[\s,;.]+$/g, '');
    let m: RegExpExecArray | null;
    if ((m = /^from\s+([\s\S]+)$/i.exec(c))) {
      if (out.chain.length) throw new Unreadable(`second "from" in "${plainText(unmask(c))}"`);
      out.chain = teamList(m[1], year, unmask);
    } else if ((m = TRADED.exec(c))) {
      out.tradedTo.push(...(m[2] ? teamList(m[2], year, unmask) : []), team(unmask(m[1]), year));
    } else {
      throw new Unreadable(`unknown note "(${plainText(unmask(c))})"`);
    }
  }
  return out;
}

const int = (text: string): number | null => {
  const t = plainText(text).replace(/^\|+/, '').trim();
  return /^\d+$/.test(t) ? Number(t) : null;
};

// ---- picks -------------------------------------------------------------------

interface Columns {
  round: number;
  pick: number;
  player: number;
  team: number;
}

function columns(header: Cell[]): Columns | null {
  const labels = header.map((c) => headerLabel(c.text));
  const at = (re: RegExp) => labels.findIndex((l) => re.test(l));
  const cols = { round: at(/^(?:rnd\.?|round)$/), pick: at(/^pick$/), player: at(/^player$/), team: at(/^(?:nba )?team$/) };
  return Object.values(cols).every((i) => i >= 0) ? cols : null;
}

/** The selections table and its column positions: the first table with Round/Pick/Player/Team headers. */
function selectionsTable(wikitext: string): { rows: Cell[][]; cols: Columns } | null {
  for (const t of tables(stripComments(wikitext))) {
    const rows = readTable(t);
    const hi = rows.findIndex((r) => r.length > 0 && r.every((c) => c.header));
    if (hi < 0) continue;
    const cols = columns(rows[hi]);
    if (cols) return { rows: rows.slice(hi + 1), cols };
  }
  return null;
}

export function parseDraftPage(wikitext: string, year: number): DraftPage {
  const out: DraftPage = { picks: [], forfeited: [], unparsed: [] };
  const found = selectionsTable(wikitext);
  if (!found) return out;
  const { rows, cols } = found;
  rows.forEach((row, i) => {
    if (row.every((c) => !plainText(c.text))) return;
    const overall = row[cols.pick] ? int(row[cols.pick].text) : null;
    try {
      // A forfeited pick: one cell "[[Team]] (forfeited due to …)", sometimes with "Forfeited pick" as the player.
      const forfeit = row.find((c) => /\bforfeit/i.test(teamCellText(c.text)) && linkTargets(c.text).length);
      if (forfeit && (overall == null || /forfeit/i.test(playerName(row[cols.player]?.text ?? '')))) {
        // The cell's attributes can be left in its text when malformed (a curly quote in style="…”).
        const main = teamCellText(forfeit.text).replace(/^[^[\]{}|]*=[^[\]{}|]*\|/, '').replace(/\([^()]*\)/g, ' ');
        out.forfeited.push({ year, round: int(row[cols.round].text), teamFranchise: team(main, year) });
        return;
      }
      if (row.length <= Math.max(...Object.values(cols))) throw new Unreadable(`${row.length} cell(s)`);
      const round = int(row[cols.round].text);
      if (round == null || overall == null) throw new Unreadable('no round or pick number');
      const name = playerName(row[cols.player].text);
      if (!name) throw new Unreadable('no player');
      const prov = provenance(row[cols.team].text, year);
      out.picks.push({ year, round, overall, name, ...prov });
    } catch (e) {
      if (!(e instanceof Unreadable)) throw e;
      const text = row.map((c, k) => (k === cols.player ? playerName(c.text) : plainText(c.text))).filter(Boolean).join(' | ');
      out.unparsed.push({ source: `${year} NBA draft`, index: overall ?? i + 1, date: null, text, reason: e.message });
    }
  });
  return out;
}

// ---- lottery -----------------------------------------------------------------

const HIGHLIGHT = /background(?:-color)?\s*:\s*#?(?:ff9|ffff99)\b/i;

/**
 * A probability cell: its value text and whether it's highlighted as the pick won. Attributes with an
 * unclosed quote (`style="background:#ff9;| 13.4%`, 2021–2025) aren't split off by readTable, so a
 * leading "attrs|" in the text is read here too.
 */
function probCell(c: Cell): { text: string; won: boolean } {
  const m = /^([^|[\]{}]*=[^|[\]{}]*)\|([\s\S]*)$/.exec(c.text);
  const attrs = m ? `${c.attrs} ${m[1]}` : c.attrs;
  const text = m ? m[2] : c.text;
  return { text, won: HIGHLIGHT.test(attrs) || text.includes('^') };
}

/** ".140" / "14.0%" -> 0.14; anything else (a dash, "<0.1%") -> null. */
function fraction(text: string): number | null {
  const t = plainText(text).replace(/^\|+/, '').replace(/\^/g, '').trim();
  let m = /^(\d*\.\d+|[01])$/.exec(t);
  if (m) return Number(m[1]);
  m = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (m) return Number((Number(m[1]) / 100).toFixed(6));
  return null;
}

/**
 * The "Draft lottery" section's probability table: one row per lottery team in pre-lottery order
 * (worst record first), then record, lottery chances, and the chance of each pick 1st..14th, with the
 * pick the team won highlighted (background #ff9 / #FFFF99, older pages also "^"). [] when the page has
 * no such section. preSlot is the row's position. The return type has no room for an unread row, so a
 * team row whose team or won pick can't be read throws rather than being left out.
 */
export function parseLotterySection(wikitext: string, year: number): LotteryRow[] {
  const text = stripComments(wikitext).replace(/<span\b[^>]*>\s*<\/span>/gi, '');
  const body = section(text, 'Draft lottery');
  if (body == null) return [];
  for (const t of tables(body)) {
    const rows = readTable(t);
    if (!rows.some((r) => r.some((c) => c.header && /^1st$/i.test(plainText(c.text))))) continue;
    const out: LotteryRow[] = [];
    for (const row of rows) {
      const own = row.filter((c) => !c.spanned);
      if (own.length < 4 || own.slice(1).some((c) => c.header) || !linkTargets(own[0].text).length) continue;
      const slot = out.length + 1;
      const franchise = resolveTeam(stripRefs(own[0].text), year);
      if (franchise == null) throw new Error(`${year} draft lottery: unknown team "${plainText(own[0].text)}" (row ${slot})`);
      const probs = own.slice(3).map(probCell);
      const won = probs.flatMap((c, i) => (c.won ? [i + 1] : []));
      if (won.length !== 1) throw new Error(`${year} draft lottery: ${won.length} picks marked won for "${plainText(own[0].text)}"`);
      out.push({ year, franchise, preSlot: slot, oddsFirst: fraction(probs[0].text), pickWon: won[0] });
    }
    return out;
  }
  return [];
}
