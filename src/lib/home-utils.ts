// src/lib/home-utils.ts
// Utility functions for the Between-Games Home Dashboard.

/**
 * Format a date-only string (e.g. "2026-03-14") as "Sat, Mar 14".
 *
 * Uses T12:00:00 suffix to avoid timezone-induced day shifts when constructing
 * the Date from a date-only string (which would otherwise be treated as UTC
 * midnight, potentially rolling back a day in negative-offset timezones).
 */
export function formatGameDate(dateStr: string): string {
  const date = new Date(dateStr + 'T12:00:00')
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
}

/**
 * Format a UTC datetime string as a locale time with timezone short name.
 * Returns "TBD" when utcStr is null.
 *
 * Example: "2026-03-14T23:30:00Z" → "3:30 PM PST"
 */
export function formatGameTime(utcStr: string | null): string {
  if (utcStr === null) return 'TBD'
  return new Date(utcStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  })
}

/**
 * Returns true if at least one game in the array has a non-null odds object.
 * Used to determine whether to render odds columns in the schedule table.
 */
export function hasAnyOdds(games: Array<{ odds: unknown | null }>): boolean {
  return games.some((g) => g.odds !== null)
}
