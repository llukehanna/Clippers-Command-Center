// scripts/lib/franchise/protections.ts
// Pick protection phrases -> structured ranges. Strict on purpose: only the few shapes below are
// read; anything else returns null and is settled by a manual override instead of a guess.
//
//   "top-N protected"                                   -> [{ year: 0, range: '1-N' }]
//   "N–M protected"                                     -> [{ year: 0, range: 'N-M' }]
//   "unprotected"                                       -> []
//   "top-N protected in YYYY, top-M protected in YYYY"  -> one entry per year (two or more, years ascending)
//
// year 0 means "the pick's own year". `text` is our own normalized wording, never the source prose.

export interface Protection {
  year: number;
  range: string; // '1-14'
  then: string | null;
}

const MAX_PICK = 60;
const TOP = String.raw`top[- ](\d{1,2}) protected`;
const DASH = '[-–—]';

function valid(lo: number, hi: number): boolean {
  return lo >= 1 && hi <= MAX_PICK && lo <= hi;
}

export function parseProtections(text: string): { protections: Protection[]; text: string } | null {
  const s = text.trim().replace(/\s+/g, ' ').toLowerCase();

  if (s === 'unprotected') return { protections: [], text: 'Unprotected' };

  let m = new RegExp(`^${TOP}$`).exec(s);
  if (m) {
    const n = Number(m[1]);
    return valid(1, n) ? { protections: [{ year: 0, range: `1-${n}`, then: null }], text: `Top-${n} protected` } : null;
  }

  m = new RegExp(String.raw`^(\d{1,2}) ?${DASH} ?(\d{1,2}) protected$`).exec(s);
  if (m) {
    const lo = Number(m[1]);
    const hi = Number(m[2]);
    return valid(lo, hi) ? { protections: [{ year: 0, range: `${lo}-${hi}`, then: null }], text: `${lo}–${hi} protected` } : null;
  }

  const items = s.split(/, (?:and )?| and /);
  if (items.length < 2) return null;
  const protections: Protection[] = [];
  for (const item of items) {
    const im = new RegExp(String.raw`^${TOP} in (\d{4})$`).exec(item);
    if (!im) return null;
    const n = Number(im[1]);
    const year = Number(im[2]);
    if (!valid(1, n)) return null;
    if (protections.length && year <= protections[protections.length - 1].year) return null;
    protections.push({ year, range: `1-${n}`, then: null });
  }
  const parts = protections.map((p) => `top-${p.range.slice(2)} protected in ${p.year}`).join(', ');
  return { protections, text: parts[0].toUpperCase() + parts.slice(1) };
}
