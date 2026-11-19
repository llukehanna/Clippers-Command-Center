// scripts/lib/insights/engine/dates.ts
// Calendar math and copy formats ("Dec 28, 2025", "Mar 2021"). Pure.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);

export function isIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = ms(s);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === s;
}

export function daysBetween(from: string, to: string): number {
  return Math.round((ms(to) - ms(from)) / 86_400_000);
}

export function yearsBetween(from: string, to: string): number {
  return daysBetween(from, to) / 365.25;
}

export function addDays(date: string, n: number): string {
  return new Date(ms(date) + n * 86_400_000).toISOString().slice(0, 10);
}

export function fmtDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

export function monthYear(iso: string): string {
  const [y, m] = iso.slice(0, 10).split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

/** Today's calendar date in Los Angeles — the default as-of (games are dated by arena date). */
export function laToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/** The default postgame window in days: finals dated (asOf − days, asOf]. One source for the engine, the CLI and verify. */
export const DEFAULT_POSTGAME_DAYS = 3;
