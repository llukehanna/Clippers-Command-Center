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

interface TitleSide {
  abbreviation: string | null
  score: number | null
}

/** Browser tab title during a game, Clippers first: "LAC 84–78 DEN · Q3 7:42". */
export function liveTabTitle(g: {
  period: number | null
  clock: string | null
  home: TitleSide
  away: TitleSide
}): string {
  const lacHome = g.home.abbreviation === 'LAC'
  const lac = lacHome ? g.home : g.away
  const opp = lacHome ? g.away : g.home
  const when = [periodLabel(g.period), clockLabel(g.clock)].filter(Boolean).join(' ')
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
