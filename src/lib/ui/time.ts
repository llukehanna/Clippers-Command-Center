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

/** "Wed, Oct 21" */
export function formatDay(date: string): string {
  return day(date).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** "Oct 21" */
export function formatDayShort(date: string): string {
  return day(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
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
