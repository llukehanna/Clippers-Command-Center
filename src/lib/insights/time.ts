// src/lib/insights/time.ts
// Pure date phrasing for insight cards. No imports, no DB, no timezone drift.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const parts = (iso: string): [number, number, number] => {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return [y, m, d];
};

export function yearsBetween(a: string, b: string): number {
  return (Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / (365.25 * 864e5);
}

/** A gap as a count of one unit, rounded DOWN so it never overstates. */
export interface Span { n: number; unit: 'year' | 'month' | 'week' | 'day'; half: boolean }

/** Whole calendar months from a to b, rounded down (Mar 26 to Nov 15 is 7). */
export function monthsBetween(a: string, b: string): number {
  const [y1, m1, d1] = parts(a);
  const [y2, m2, d2] = parts(b);
  return (y2 - y1) * 12 + (m2 - m1) - (d2 < d1 ? 1 : 0);
}

const daysBetween = (a: string, b: string): number =>
  Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / 864e5);

/**
 * The gap from a to b, never more than it is: from a year up, whole half-years
 * rounded down (1 year 9 months is 1½); under a year, whole months; under a
 * month, weeks from 14 days, else days (at least 1).
 */
export function gapSpan(a: string, b: string): Span {
  const m = monthsBetween(a, b);
  if (m >= 12) {
    const halves = Math.floor(m / 6);
    return { n: Math.floor(halves / 2), unit: 'year', half: halves % 2 === 1 };
  }
  if (m >= 1) return { n: m, unit: 'month', half: false };
  const days = Math.max(1, daysBetween(a, b));
  if (days >= 14) return { n: Math.floor(days / 7), unit: 'week', half: false };
  return { n: days, unit: 'day', half: false };
}

/** The same rounding for a bare year count (when only frame.years is known). */
export function yearsSpan(y: number): Span {
  const eps = 1e-9;
  if (y >= 1) {
    const halves = Math.floor(y * 2 + eps);
    return { n: Math.floor(halves / 2), unit: 'year', half: halves % 2 === 1 };
  }
  const m = Math.floor(y * 12 + eps);
  if (m >= 1) return { n: m, unit: 'month', half: false };
  const days = Math.max(1, Math.floor(y * 365.25 + eps));
  if (days >= 14) return { n: Math.floor(days / 7), unit: 'week', half: false };
  return { n: days, unit: 'day', half: false };
}

/** "8½" / "5" — the span's count. */
export const spanCount = (s: Span): string => (s.half ? `${s.n}½` : String(s.n));

/** "8½ years", "1 year", "9 months", "2 weeks", "1 day". */
export function spanText(s: Span): string {
  const plural = s.half || s.n !== 1;
  return `${spanCount(s)} ${s.unit}${plural ? 's' : ''}`;
}

export function spanLabel(a: string, b: string): string {
  return spanText(gapSpan(a, b));
}

export function fmtDate(iso: string): string {
  const [y, m, d] = parts(iso);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function fmtShort(iso: string): string {
  const [, m, d] = parts(iso);
  return `${MONTHS[m - 1]} ${d}`;
}

/** 2025 -> '2025–26' (en dash). */
export function seasonText(id: number): string {
  return `${id}–${String((id + 1) % 100).padStart(2, '0')}`;
}
