// scripts/lib/franchise/wikitext.ts
// A small reader for the bits of MediaWiki wikitext the franchise pipeline needs: headings, tables
// (with rowspan), links, templates and refs. No library; only the shapes the Clippers pages use.

/** Removes <!-- comments -->. */
export function stripComments(s: string): string {
  return s.replace(/<!--[\s\S]*?(?:-->|$)/g, '');
}

/** Removes <ref>…</ref> and <ref …/>. */
export function stripRefs(s: string): string {
  return s.replace(/<ref\b[^>]*\/>/gi, '').replace(/<ref\b[^>]*>[\s\S]*?<\/ref\s*>/gi, '');
}

/**
 * Replaces each top-level {{template}} (nested ones included) with what `replace` returns for it
 * (default: nothing). `name` is the trimmed text before the first pipe; `args` the raw pipe-split rest.
 */
export function replaceTemplates(s: string, replace: (name: string, args: string[], raw: string) => string = () => ''): string {
  let out = '';
  let i = 0;
  while (i < s.length) {
    const start = s.indexOf('{{', i);
    if (start < 0) break;
    out += s.slice(i, start);
    let depth = 0;
    let j = start;
    for (; j < s.length; j++) {
      if (s.startsWith('{{', j)) { depth++; j++; }
      else if (s.startsWith('}}', j)) { depth--; j++; if (depth === 0) break; }
    }
    if (depth !== 0) { out += s.slice(start); i = s.length; break; } // unclosed: keep as text
    const raw = s.slice(start, j + 1);
    const parts = splitTopLevel(raw.slice(2, -2), '|');
    out += replace(parts[0].trim(), parts.slice(1), raw);
    i = j + 1;
  }
  return out + s.slice(i);
}

/** Splits on `sep` where it isn't inside [[ ]] or {{ }}. */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < s.length; i++) {
    const two = s.slice(i, i + 2);
    if (two === '[[' || two === '{{') { depth++; cur += two; i++; continue; }
    if ((two === ']]' || two === '}}') && depth > 0) { depth--; cur += two; i++; continue; }
    if (depth === 0 && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out;
}

const HEADING = /^(={2,6})\s*(.*?)\s*\1\s*$/;

/** Body of the first "== heading ==" (any level 2–6), up to the next heading of the same or a higher level. */
export function section(wikitext: string, heading: string): string | null {
  const lines = wikitext.split('\n');
  const want = heading.trim().toLowerCase();
  for (let i = 0; i < lines.length; i++) {
    const m = HEADING.exec(lines[i]);
    if (!m || m[2].trim().toLowerCase() !== want) continue;
    const level = m[1].length;
    let end = lines.length;
    for (let k = i + 1; k < lines.length; k++) {
      const h = HEADING.exec(lines[k]);
      if (h && h[1].length <= level) { end = k; break; }
    }
    return lines.slice(i + 1, end).join('\n').trim();
  }
  return null;
}

/** Every {| … |} table in the text (top-level only; the Clippers pages nest none). */
export function tables(text: string): string[] {
  const out: string[] = [];
  const lines = text.split('\n');
  let cur: string[] | null = null;
  for (const line of lines) {
    const t = line.trimStart();
    if (cur == null) {
      if (t.startsWith('{|')) cur = [line];
      continue;
    }
    cur.push(line);
    if (t.startsWith('|}')) { out.push(cur.join('\n')); cur = null; }
  }
  if (cur) out.push(cur.join('\n'));
  return out;
}

export interface Cell {
  text: string;
  header: boolean;
  rowspan: number;
  colspan: number;
  /** True when this is a copy of a rowspan cell from a row above. */
  spanned: boolean;
}

const ATTRS = /^\s*(?:[a-z-]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'|]+)\s*)+$/i;

function makeCell(raw: string, header: boolean): Cell {
  const parts = splitTopLevel(raw, '|');
  let attrs = '';
  let text = raw;
  if (parts.length > 1 && ATTRS.test(parts[0])) {
    attrs = parts[0];
    text = parts.slice(1).join('|');
  }
  const span = (name: string) => {
    const m = new RegExp(`${name}\\s*=\\s*["']?(\\d+)`, 'i').exec(attrs);
    return m ? Math.max(1, Number(m[1])) : 1;
  };
  return { text: text.trim(), header, rowspan: span('rowspan'), colspan: span('colspan'), spanned: false };
}

/** Lines, with a {{template}} or <ref> that runs over several lines joined back onto the line it started on. */
function logicalLines(text: string): string[] {
  const out: string[] = [];
  let buf: string | null = null;
  const open = (s: string) =>
    (s.match(/\{\{/g)?.length ?? 0) - (s.match(/\}\}/g)?.length ?? 0) +
    (s.match(/<ref\b[^>]*[^/]>/gi)?.length ?? 0) - (s.match(/<\/ref\s*>/gi)?.length ?? 0);
  for (const line of text.split('\n')) {
    buf = buf == null ? line : `${buf} ${line}`;
    if (open(buf) <= 0) { out.push(buf); buf = null; }
  }
  if (buf != null) out.push(buf);
  return out;
}

/** Rows of cells, rowspan cells copied (with spanned: true) into the rows they cover. Empty rows are skipped. */
export function readTable(table: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  const endRow = () => { if (row.length) rows.push(row); row = []; };
  for (const line of logicalLines(table)) {
    const t = line.trimStart();
    if (t.startsWith('{|') || t.startsWith('|+')) continue;
    if (t.startsWith('|}')) break;
    if (t.startsWith('|-')) { endRow(); continue; }
    if (t.startsWith('|') || t.startsWith('!')) {
      const header = t.startsWith('!');
      const body = t.slice(1);
      const raws = header ? splitTopLevel(body, '!!').flatMap((c) => splitTopLevel(c, '||')) : splitTopLevel(body, '||');
      for (const r of raws) row.push(makeCell(r, header));
      continue;
    }
    if (row.length) row[row.length - 1].text = `${row[row.length - 1].text}\n${line}`.trim();
  }
  endRow();
  for (const r of rows) for (const c of r) c.text = c.text.trim();

  // Rowspan: pending[col] = the cell above that still covers this column.
  const pending = new Map<number, { cell: Cell; left: number }>();
  const out: Cell[][] = [];
  for (const cells of rows) {
    const res: Cell[] = [];
    let col = 0;
    const fill = () => {
      while (pending.has(col)) {
        const p = pending.get(col)!;
        res.push({ ...p.cell, spanned: true });
        if (--p.left === 0) pending.delete(col);
        col += p.cell.colspan;
      }
    };
    const added: Array<[number, Cell]> = [];
    for (const c of cells) {
      fill();
      res.push(c);
      if (c.rowspan > 1) added.push([col, c]);
      col += c.colspan;
    }
    for (const k of [...pending.keys()].sort((a, b) => a - b)) {
      if (k < col) continue;
      col = k;
      fill();
    }
    for (const [k, c] of added) pending.set(k, { cell: c, left: c.rowspan - 1 });
    out.push(res);
  }
  return out;
}

/** Cells of each |- row as raw wikitext; rowspan respected. */
export function tableRows(table: string): string[][] {
  return readTable(table).map((r) => r.map((c) => c.text));
}

/** Each [[target|label]] link in the cell. Label defaults to the target. */
export function linkTargets(cell: string): Array<{ target: string; label: string }> {
  const out: Array<{ target: string; label: string }> = [];
  for (const m of cell.matchAll(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g)) {
    const target = m[1].trim();
    out.push({ target, label: (m[2] ?? m[1]).trim() });
  }
  return out;
}

/** Text a reader would see: refs, templates, comments and tags gone; links as their labels; bold/italic quotes gone. */
export function plainText(s: string): string {
  return replaceTemplates(stripRefs(stripComments(s)))
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, t: string, l?: string) => (l ?? t).trim())
    .replace(/'{2,}/g, '')
    .replace(/<br\s*\/?>|<hr\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}
