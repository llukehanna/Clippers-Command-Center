// Date/time parsing and formatting. Game days are YYYY-MM-DD strings; tip
// times arrive as Postgres timestamps ("2026-10-22 02:30:00+00"), which
// Safari's Date parser rejects — always go through parseTimestamp.

const TZ = 'America/Los_Angeles'

export function parseTimestamp(ts: string | null | undefined): Date | null {
  if (!ts) return null
  const iso = ts
    .trim()
    .replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, '$1T$2')
    .replace(/([+-]\d{2})$/, '$1:00')
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

function day(date: string): Date {
  return new Date(`${date.slice(0, 10)}T12:00:00Z`)
}

/** The current calendar year in Pacific time (the app's clock). */
export function currentYear(now: Date = new Date()): number {
  return Number(now.toLocaleDateString('en-US', { year: 'numeric', timeZone: TZ }))
}

/** Dates outside the current year carry the year, so "Feb 8" is never ambiguous. */
const yearIfNeeded = (d: Date, now?: Date): { year?: 'numeric' } =>
  d.getUTCFullYear() === currentYear(now) ? {} : { year: 'numeric' }

/** "Wed, Oct 21" this year; "Wed, Feb 8, 2023" otherwise. */
export function formatDay(date: string, now?: Date): string {
  const d = day(date)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', ...yearIfNeeded(d, now), timeZone: 'UTC' })
}

/** "Oct 21" this year; "Feb 8, 2023" otherwise. */
export function formatDayShort(date: string, now?: Date): string {
  const d = day(date)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...yearIfNeeded(d, now), timeZone: 'UTC' })
}

/** Compact chart-axis label: "Oct 21" this year; "Feb 8 ’23" otherwise. */
export function formatDayTick(date: string, now?: Date): string {
  const d = day(date)
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  return d.getUTCFullYear() === currentYear(now) ? md : `${md} ’${String(d.getUTCFullYear()).slice(2)}`
}

/** "Wednesday, October 21, 2026" */
export function formatDayLong(date: string): string {
  return day(date).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

/** "7:30 PM PT"; "TBD" when unknown. */
export function formatTip(ts: string | null | undefined): string {
  const d = parseTimestamp(ts)
  if (!d) return 'TBD'
  return `${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ })} PT`
}

/** Seconds/minutes/hours ago, compact: "4s", "3m", "2h". */
export function ageLabel(fromIso: string | null | undefined, now: Date = new Date()): string | null {
  const d = parseTimestamp(fromIso)
  if (!d) return null
  const s = Math.max(0, Math.round((now.getTime() - d.getTime()) / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  return `${Math.floor(s / 86400)}d`
}
