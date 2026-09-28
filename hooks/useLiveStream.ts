'use client'

import * as React from 'react'
import { useLiveData } from '@/hooks/useLiveData'
import { useNow } from '@/hooks/useNow'
import { useVisibleWithGrace } from '@/hooks/useVisibleWithGrace'
import { applyMessage, type LiveMessage } from '@/src/lib/live/protocol'
import { overlayLiveDoc } from '@/src/lib/live/payload'
import { espnScoreboardUrl, overlayEspn, parseEspnScoreboard, type EspnScore } from '@/src/lib/live/espn-backup'
import {
  BACKUP_POLL_MS,
  FLAP_PAUSE_MS,
  HIDDEN_CLOSE_MS,
  PING_EVERY_MS,
  TIP_REFETCH_MS,
  hubSocketUrl,
  isFlapping,
  isPushFresh,
  needsBackup,
  pickSource,
  pushIsCurrent,
  reconnectDelay,
  socketIsSilent,
  streamGameId,
  tipRefetchExpired,
  type FeedSource,
} from '@/src/lib/live/stream'
import type { LiveStateDoc } from '@/src/lib/types/live-state'
import type { LivePayload } from '@/src/lib/ui/types'

const HUB_URL = process.env.NEXT_PUBLIC_LIVE_HUB_URL ?? ''

export interface LatencySample {
  observed_at: string | null  // the real play (NBA wall clock)
  fetched_at: string          // the runner saw it
  hub_at: number | null       // the hub relayed it
  received_at: number         // this browser got it (local clock)
}

export interface LiveStream {
  data: LivePayload | undefined
  error: unknown
  source: FeedSource
  latency: LatencySample | null
}

/** How often the push watchdog checks that the hub is still talking. */
const WATCHDOG_CHECK_MS = 5_000

/**
 * /live's connection manager (spec §6.2): WebSocket push from the live hub,
 * /api/live polling underneath (slowed to the 30 s chip budget while push is
 * live), and ESPN's public scoreboard if our runner goes stale.
 */
export function useLiveStream(): LiveStream {
  const now = useNow(5_000)?.getTime() ?? null
  const [pushed, setPushed] = React.useState<{ gameId: string; doc: LiveStateDoc } | null>(null)
  const [latency, setLatency] = React.useState<LatencySample | null>(null)
  const [espn, setEspn] = React.useState<{ gameId: string; score: EspnScore } | null>(null)
  // The newest doc per game, read when a socket (re)connects so the hub's
  // replay can't roll the page back to older states.
  const lastDoc = React.useRef<{ gameId: string; doc: LiveStateDoc } | null>(null)

  // True only while a hub socket is open and still answering.
  const [connected, setConnected] = React.useState(false)
  // The poll budget follows the gated "push is live" value below. It needs the
  // polled payload to compute, so it's carried over from the previous render
  // (React's "store information from previous renders" pattern).
  const [followChip, setFollowChip] = React.useState(false)
  const { data: base, error, mutate } = useLiveData({ follow: followChip ? 'chip' : 'cadence' })
  const gameId = streamGameId(base)
  const visible = useVisibleWithGrace(HIDDEN_CLOSE_MS)
  const pushDoc = pushed && pushed.gameId === gameId ? pushed.doc : null

  // Tier 1: push.
  React.useEffect(() => {
    if (!HUB_URL || !gameId || !visible) return
    let ws: WebSocket | null = null
    let state: LiveStateDoc | null = lastDoc.current?.gameId === gameId ? lastDoc.current.doc : null
    let attempt = 0
    let stopped = false
    let retry: ReturnType<typeof setTimeout> | undefined
    let lastHeard = Date.now()
    const drops: number[] = []

    const scheduleRetry = () => {
      if (stopped) return
      drops.push(Date.now())
      retry = setTimeout(connect, isFlapping(drops, Date.now()) ? FLAP_PAUSE_MS : reconnectDelay(attempt++))
    }

    // One exit path for a closed, errored or silent socket: stop counting it
    // as live, refresh the poll tier right away, and reconnect.
    const drop = (socket: WebSocket) => {
      if (socket !== ws) return
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
      ws = null
      try {
        socket.close()
      } catch {
        // Already closed.
      }
      setConnected(false)
      if (stopped) return
      void mutate()
      scheduleRetry()
    }

    const connect = () => {
      lastHeard = Date.now()
      try {
        ws = new WebSocket(hubSocketUrl(HUB_URL, gameId))
      } catch {
        // A bad URL or a blocked scheme throws synchronously; treat it as a drop.
        ws = null
        scheduleRetry()
        return
      }
      const socket = ws
      socket.onopen = () => {
        attempt = 0
        lastHeard = Date.now()
        setConnected(true)
      }
      socket.onmessage = (event) => {
        lastHeard = Date.now()
        if (typeof event.data !== 'string' || event.data === 'pong') return
        let msg: LiveMessage
        try {
          msg = JSON.parse(event.data) as LiveMessage
        } catch {
          return
        }
        const result = applyMessage(state, msg)
        if (result.needKeyframe) socket.send('resync')
        if (!result.applied || !result.state) return
        state = result.state
        lastDoc.current = { gameId, doc: result.state }
        setPushed({ gameId, doc: result.state })
        setLatency({
          observed_at: result.state.observed_at,
          fetched_at: result.state.fetched_at,
          hub_at: msg.hub_at ?? null,
          received_at: Date.now(),
        })
      }
      socket.onclose = () => drop(socket)
      socket.onerror = () => drop(socket)
    }

    connect()
    const ping = setInterval(() => {
      if (ws?.readyState === WebSocket.OPEN) ws.send('ping')
    }, PING_EVERY_MS)
    // A half-open connection (sleeping laptop, dead NAT mapping) can stay
    // "open" for minutes, and a connect attempt can hang. No message and no
    // pong for two ping intervals: close it and take the normal reconnect path.
    const watchdog = setInterval(() => {
      if (ws && socketIsSilent(lastHeard, Date.now())) drop(ws)
    }, WATCHDOG_CHECK_MS)
    return () => {
      stopped = true
      clearTimeout(retry)
      clearInterval(ping)
      clearInterval(watchdog)
      if (ws) drop(ws)
    }
  }, [gameId, visible, mutate])

  // Pre-tip → tip: the hub knows the game started before /api/live does.
  // Refetch every few seconds (the pre-tip response is CDN-cached for only
  // 2 s) until the page has the game's identity to overlay — for at most
  // 2 minutes, after which the normal poll cadence takes over.
  const tipped = Boolean(pushDoc && pushDoc.status !== 'scheduled' && !base?.game)
  React.useEffect(() => {
    if (!tipped) return
    const started = Date.now()
    void mutate()
    const id = setInterval(() => {
      if (tipRefetchExpired(started, Date.now())) clearInterval(id)
      else void mutate()
    }, TIP_REFETCH_MS)
    return () => clearInterval(id)
  }, [tipped, mutate])

  // Push is overlaid only while the socket is up, the doc is fresh, and it's
  // at least as new as the polled snapshot (strictly newer while delayed).
  const pushLive = Boolean(
    connected && base && pushDoc && now !== null && isPushFresh(pushDoc, now) && pushIsCurrent(pushDoc, base),
  )
  if (pushLive !== followChip) setFollowChip(pushLive)

  // Tier 3: ESPN backup while our runner is stale.
  const backupWanted = needsBackup(base, pushLive)
  const backupGame = backupWanted ? base?.game ?? null : null
  React.useEffect(() => {
    const g = backupGame
    if (!g?.game_date || !g.home.abbreviation || !g.away.abbreviation) return
    const { game_id, game_date } = g
    const home = g.home.abbreviation
    const away = g.away.abbreviation
    let stopped = false
    const tick = async () => {
      try {
        const res = await fetch(espnScoreboardUrl(game_date), { signal: AbortSignal.timeout(4_000) })
        if (!res.ok) return
        const score = parseEspnScoreboard(await res.json(), home, away)
        if (score && !stopped) setEspn({ gameId: game_id, score })
      } catch {
        // Best effort: the delayed banner is already showing.
      }
    }
    void tick()
    const id = setInterval(tick, BACKUP_POLL_MS)
    return () => {
      stopped = true
      clearInterval(id)
    }
  }, [backupGame])

  const backupScore = backupWanted && espn && espn.gameId === base?.game?.game_id ? espn.score : null

  const shown = React.useMemo(() => {
    let data = base
    if (data && pushLive && pushDoc) data = overlayLiveDoc(data, pushDoc)
    // overlayEspn hands back the same object when ESPN is behind us (or can't
    // apply), so the chip only claims the backup feed when it actually changed
    // what's on screen.
    let usedBackup = false
    if (data && backupScore) {
      const withBackup = overlayEspn(data, backupScore)
      usedBackup = withBackup !== data
      data = withBackup
    }
    return { data, usedBackup }
  }, [base, pushLive, pushDoc, backupScore])

  return {
    data: shown.data,
    error,
    source: pickSource({
      shown: shown.data,
      pushFetchedAt: pushLive && pushDoc ? pushDoc.fetched_at : null,
      now: now ?? 0,
      backup: shown.usedBackup,
    }),
    latency,
  }
}
