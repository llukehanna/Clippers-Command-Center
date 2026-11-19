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

export function spanLabel(a: string, b: string): string {
  const y = yearsBetween(a, b);
  if (y >= 1) {
    const half = Math.round(y * 2) / 2;
    const whole = Math.floor(half);
    return half % 1 ? `${whole}½ years` : `${whole} year${whole === 1 ? '' : 's'}`;
  }
  return `${Math.round(y * 12)} months`;
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
