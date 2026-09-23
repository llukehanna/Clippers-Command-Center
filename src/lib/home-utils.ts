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
 * Format a UTC datetime string as Pacific time with timezone short name.
 * Returns "TBD" when utcStr is null.
 *
 * Always formats in America/Los_Angeles so server-rendered output (UTC on
 * Vercel) matches client hydration and fans see Clippers local tip-off time.
 *
 * Example: "2026-03-14T23:30:00Z" → "4:30 PM PDT"
 */
export function formatGameTime(utcStr: string | null): string {
  if (utcStr === null) return 'TBD'
  return new Date(utcStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Los_Angeles',
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

/**
 * NBA season start year for a given date. Seasons roll over on July 1:
 * Jul 2026–Jun 2027 → 2026 (the 2026-27 season).
 */
export function seasonStartYear(date: Date = new Date()): number {
  const year = date.getUTCFullYear()
  return date.getUTCMonth() >= 6 ? year : year - 1
}

/**
 * Human season label from a season start year, e.g. 2025 → "2025-26".
 */
export function formatSeasonLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`
}
