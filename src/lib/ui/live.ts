// Live-game labels shared by the scoreboard, sticky bar and tab title.

import { parseTimestamp } from './time'

export function periodLabel(period: number | null | undefined): string {
  if (period == null || period <= 0) return 'Pregame'
  if (period <= 4) return `Q${period}`
  if (period === 5) return 'OT'
  return `${period - 4}OT`
}

/** "PT07M42.00S" or "7:42" → "7:42". */
export function clockLabel(clock: string | null | undefined): string {
  if (!clock) return ''
  const iso = /^PT(?:(\d+)M)?(?:([\d.]+)S)?$/.exec(clock)
  if (!iso) return clock
  const mins = parseInt(iso[1] ?? '0', 10)
  const secs = Math.floor(parseFloat(iso[2] ?? '0'))
  return `${mins}:${String(secs).padStart(2, '0')}`
}

/**
 * A period break while the game is still on: the clock reads 0:00 at the end
 * of a period ("Halftime", "End of Q3", "End of OT"). Null while the clock runs
 * (or before tip), so callers show the clock instead. A game that has gone
 * final never reaches here — its status, not the clock, says so.
 */
export function breakLabel(period: number | null | undefined, clock: string | null | undefined): string | null {
  if (period == null || period <= 0 || !clock) return null
  // Exactly zero: "PT00M00.40S" still has 0.4 s to play, though clockLabel floors it to 0:00.
  const parts = clock.match(/[\d.]+/g)
  if (!parts || parts.some((p) => parseFloat(p) !== 0)) return null
  if (period === 2) return 'Halftime'
  return `End of ${periodLabel(period)}`
}

/** "Q3 7:42", or the break ("Halftime") when the period has ended. */
export function gameMomentLabel(period: number | null | undefined, clock: string | null | undefined): string {
  return breakLabel(period, clock) ?? [periodLabel(period), clockLabel(clock)].filter(Boolean).join(' ')
}

interface TitleSide {
  abbreviation: string | null
  score: number | null
}

/** Browser tab title during a game, Clippers first: "LAC 84–78 DEN · Q3 7:42" (or "· Final"). */
export function liveTabTitle(g: {
  status?: string | null
  period: number | null
  clock: string | null
  home: TitleSide
  away: TitleSide
}): string {
  const lacHome = g.home.abbreviation === 'LAC'
  const lac = lacHome ? g.home : g.away
  const opp = lacHome ? g.away : g.home
  const when = g.status === 'final' ? 'Final' : gameMomentLabel(g.period, g.clock)
  return `LAC ${lac.score ?? 0}–${opp.score ?? 0} ${opp.abbreviation ?? 'OPP'} · ${when}`
}

/** Whole days/hours/minutes until tip-off; null once it has passed. */
export function countdownParts(
  targetIso: string,
  now: Date,
): { days: number; hours: number; minutes: number } | null {
  const target = parseTimestamp(targetIso)
  if (!target) return null
  const diff = target.getTime() - now.getTime()
  if (diff <= 0) return null
  const totalMinutes = Math.floor(diff / 60_000)
  return {
    days: Math.floor(totalMinutes / 1440),
    hours: Math.floor((totalMinutes % 1440) / 60),
    minutes: totalMinutes % 60,
  }
}

// A DATA_DELAYED snapshot older than this (vs. server time) is a leftover from
// a finished game, not a delayed live one — treat it as no game.
const STALE_SNAPSHOT_IDLE_MS = 6 * 60 * 60 * 1000

export type ResolvedLiveState = 'LIVE' | 'DATA_DELAYED' | 'NO_ACTIVE_GAME'

export function resolveLiveState(
  data:
    | {
        state?: string
        game?: unknown
        snapshot_captured_at?: string | null
        meta?: { generated_at?: string | null } | null
      }
    | undefined,
): ResolvedLiveState {
  const state = data?.state
  if ((state !== 'LIVE' && state !== 'DATA_DELAYED') || !data?.game) return 'NO_ACTIVE_GAME'
  if (state === 'DATA_DELAYED' && data.snapshot_captured_at && data.meta?.generated_at) {
    const captured = parseTimestamp(data.snapshot_captured_at)
    const generated = parseTimestamp(data.meta.generated_at)
    if (captured && generated && generated.getTime() - captured.getTime() > STALE_SNAPSHOT_IDLE_MS) return 'NO_ACTIVE_GAME'
  }
  return state
}

/**
 * A game is on: /api/live has one and it isn't over. /live keeps showing a
 * game for half an hour after the buzzer (its state stays LIVE), but the
 * header's "Live" chip and the nav's live dot stop at the final.
 */
export function gameIsOn(data: (NonNullable<Parameters<typeof resolveLiveState>[0]> & { game?: { status?: string } | null }) | undefined): boolean {
  return resolveLiveState(data) !== 'NO_ACTIVE_GAME' && data?.game?.status !== 'final'
}
