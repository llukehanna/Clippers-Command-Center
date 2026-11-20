// "Now"-dependent rendering on prerendered pages. A page is built once and
// served until the next rebuild, so whatever flips at a known instant (a game
// ending, a season rolling over) is described as a window of time: the build
// (and the browser's first render, so hydration matches) shows the build-time
// arrangement, and once mounted the browser's clock decides (ClockWindow in
// components/ui/clock.tsx).

import { parseTimestamp } from './time'

export interface ClockWindowSpec {
  /** Shown from this instant (ms, inclusive). */
  from?: number
  /** Shown until this instant (ms, exclusive). */
  until?: number
  /** Before the clock is known (build, first render). Default: shown unless `from` is set. */
  initial?: boolean
}

export function inClockWindow(w: ClockWindowSpec, now: number | null): boolean {
  if (now == null) return w.initial ?? w.from == null
  return (w.from == null || now >= w.from) && (w.until == null || now < w.until)
}

/** A game this long after its scheduled tip has certainly ended (triple overtime runs about 3¼ h). */
export const GAME_OVER_AFTER_MS = 4 * 3_600_000
const DAY_MS = 86_400_000

interface Timed {
  game_date: string
  start_time_utc: string | null
}

/**
 * When a game the build listed as upcoming has surely ended: four hours after
 * tip, or (tip time unknown) the morning after its game day. Normally the
 * rebuild after the final lands well before this; it covers a late or failed one.
 */
export function gameOverAt(g: Timed): number {
  const tip = parseTimestamp(g.start_time_utc)
  if (tip) return tip.getTime() + GAME_OVER_AFTER_MS
  return Date.parse(`${g.game_date.slice(0, 10)}T12:00:00Z`) + DAY_MS
}

/** gameOverAt for an ordered list, never decreasing: a game counts as over only once every earlier one is. */
export function gamesOverAt(games: Timed[]): number[] {
  let max = -Infinity
  return games.map((g) => (max = Math.max(max, gameOverAt(g))))
}

/**
 * When item `i` of an ordered game list is on screen, for a view that shows
 * `size` items starting `offset` places after the first game not yet over
 * (hero: offset 0, size 1; the list under it: offset 1). `overAt` is gamesOverAt.
 */
export function slotWindow(overAt: number[], i: number, offset: number, size: number): ClockWindowSpec {
  if (i < offset) throw new RangeError(`slot ${i} is before offset ${offset}`)
  const w: ClockWindowSpec = { until: overAt[i - offset] }
  const before = i - offset - size
  if (before >= 0) w.from = overAt[before]
  return w
}

type Identified = { game_id: number | string }

/** The next game, then the rest of the schedule without it (the next game may be a preseason one the schedule omits). */
export function heroCandidates<T extends Identified>(next: T | null, upcoming: T[]): T[] {
  if (!next) return upcoming
  return [next, ...upcoming.filter((g) => String(g.game_id) !== String(next.game_id))]
}

/** The first game not yet over at `now`; the first game before the clock is known. */
export function pickNextGame<T extends Timed>(games: T[], now: number | null): T | null {
  if (now == null) return games[0] ?? null
  const overAt = gamesOverAt(games)
  return games.find((_, i) => now < overAt[i]) ?? null
}

/** When a game is on (tip until it has surely ended); first paint follows the status the build saw. */
export function liveWindow(g: Timed, status: string): ClockWindowSpec | null {
  const tip = parseTimestamp(g.start_time_utc)
  const initial = status === 'in_progress'
  if (tip) return { from: tip.getTime(), until: gameOverAt(g), initial }
  return initial ? { until: gameOverAt(g), initial } : null
}

/** The instant season `seasonId` stops being the calendar season (July 1 UTC, as seasonStartYear). */
export function seasonRolloverAt(seasonId: number): number {
  return Date.UTC(seasonId + 1, 6, 1)
}
