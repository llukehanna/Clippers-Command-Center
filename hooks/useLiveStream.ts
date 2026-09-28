'use client'

import * as React from 'react'
import { useLiveData } from '@/hooks/useLiveData'
import { useNow } from '@/hooks/useNow'
import { useVisibleWithGrace } from '@/hooks/useVisibleWithGrace'
import { applyMessage, type LiveMessage } from '@/src/lib/live/protocol'
import { overlayLiveDoc } from '@/src/lib/live/payload'
import {
  addFrame,
  addOffsetSample,
  clampDelay,
  clockOffset,
  DELAY_STORAGE_KEY,
  frameTime,
  parseStoredDelay,
  pickFrame,
  syncDelay,
  type Frame,
} from '@/src/lib/live/spoiler'
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

export interface SpoilerState {
  /** 0 = off. */
  delayMs: number
  setDelay(ms: number): void
  /** Sets the delay from the newest buffered basket; returns it, or null if none is buffered. */
  sync(): number | null
  /** A delay is set but nothing that old is buffered yet: show a hold state, not a newer score. */
  holding: boolean
}

/**
 * Spoiler frames for one game. `at` is in the hub's clock (device time minus
 * the measured clock offset), not the device's: the hub's replay on connect
 * arrives all at once with each message's original `hub_at`, so the offset is
 * only known well once the replay's newest message is in. Keying frames on the
 * hub's clock and converting "now" with the current offset at render time lets
 * every frame benefit as the estimate improves, and keeps replayed frames at
 * the time their plays happened instead of bunching them at arrival.
 */
type Frames<T> = { gameId: string; list: Frame<T>[] } | null

function withFrame<T>(frames: Frames<T>, gameId: string, frame: Frame<T>, now: number): Frames<T> {
  return { gameId, list: addFrame(frames && frames.gameId === gameId ? frames.list : [], frame, now) }
}

export interface LiveStream {
  data: LivePayload | undefined
  error: unknown
  source: FeedSource
  latency: LatencySample | null
  spoiler: SpoilerState
}

/** How often the push watchdog checks that the hub is still talking. */
const WATCHDOG_CHECK_MS = 5_000

/**
 * /live's connection manager (spec §6.2): WebSocket push from the live hub,
 * /api/live polling underneath (slowed to the 30 s chip budget while push is
 * live), and ESPN's public scoreboard if our runner goes stale.
 */
export function useLiveStream(): LiveStream {
  const [delayMs, setDelayMs] = React.useState(() => {
    if (typeof window === 'undefined') return 0
    try {
      return parseStoredDelay(window.localStorage.getItem(DELAY_STORAGE_KEY))
    } catch {
      return 0
    }
  })
  const setDelay = React.useCallback((ms: number) => {
    const v = clampDelay(ms)
    setDelayMs(v)
    try {
      window.localStorage.setItem(DELAY_STORAGE_KEY, String(v))
    } catch {
      // Private mode or blocked storage: the delay just won't persist.
    }
  }, [])
  // A delayed page steps through its buffer once a second.
  const tickMs = delayMs > 0 ? 1_000 : 5_000
  const now = useNow(tickMs)?.getTime() ?? null
  const [pushFrames, setPushFrames] = React.useState<Frames<LiveStateDoc>>(null)
  const [pageFrames, setPageFrames] = React.useState<Frames<LivePayload>>(null)
  // Device clock minus the hub's (spec §7.3); 0 until the hub has stamped a message.
  const [offset, setOffset] = React.useState(0)
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
    let samples: number[] = []
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
        const receivedAt = Date.now()
        if (typeof msg.hub_at === 'number') {
          samples = addOffsetSample(samples, receivedAt - msg.hub_at)
          setOffset(clockOffset(samples))
        }
        // Frames are keyed in the hub's clock (see Frames). A play can't be
        // later than the hub relayed it — true of the replay's old messages
        // too, which is what keeps them at their own time.
        const doc = result.state
        const hubNow = receivedAt - clockOffset(samples)
        const at = frameTime(doc.observed_at, 0, typeof msg.hub_at === 'number' ? msg.hub_at : hubNow)
        setPushFrames((f) => withFrame(f, gameId, { at, value: doc }, hubNow))
        setLatency({
          observed_at: result.state.observed_at,
          fetched_at: result.state.fetched_at,
          hub_at: msg.hub_at ?? null,
          received_at: receivedAt,
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
  // Primitive deps: every poll hands back a new game object, and restarting
  // (and clearing) the backup on each one would flicker the ESPN score.
  const backupId = backupGame?.game_id ?? null
  const backupDate = backupGame?.game_date ?? null
  const backupHome = backupGame?.home.abbreviation ?? null
  const backupAway = backupGame?.away.abbreviation ?? null
  React.useEffect(() => {
    if (!backupId || !backupDate || !backupHome || !backupAway) return
    const game_id = backupId
    const game_date = backupDate
    const home = backupHome
    const away = backupAway
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
      // Backup no longer needed (or a different game): drop the cached ESPN
      // score so a later backup episode can't flash an old one.
      setEspn(null)
    }
  }, [backupId, backupDate, backupHome, backupAway])

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

  // Spoiler sync (spec §7.3). "Now" in the frames' clock (the hub's).
  const frameNow = now === null ? null : now - offset

  // Record each new on-screen payload (the "store information from previous
  // renders" pattern, like followChip above). Waits for useNow to mount, so
  // the first payload isn't skipped. Render can't read the clock, and `now` is
  // the last tick, which can predate this payload's arrival; a frame stamped
  // with it could show up to a tick early. One tick later is when it had
  // arrived by, so that bounds the arrival cap, and it stamps an ESPN backup
  // overlay (no play time: it counts from when it arrived).
  const [seenShown, setSeenShown] = React.useState<LivePayload | undefined>(undefined)
  if (shown.data !== seenShown && frameNow !== null) {
    setSeenShown(shown.data)
    const d = shown.data
    if (gameId && d?.game) {
      const arrivedBy = frameNow + tickMs
      const at = shown.usedBackup ? arrivedBy : frameTime(d.observed_at, 0, arrivedBy)
      setPageFrames((f) => withFrame(f, gameId, { at, value: d }, frameNow))
    }
  }

  // With a delay set, show the newest frame at least that old: a pushed doc
  // over the current /api/live base while push is live, else a whole page
  // payload. Nothing that old yet → hold rather than show a newer score.
  // Before useNow has mounted there's no clock to judge by: show the loading
  // state. That render only has a game when SWR already had /api/live cached
  // (a client-side navigation — the TopBar polls it on every page), never
  // during hydration, so the first client render still matches the server's.
  let out = shown.data
  let holding = false
  if (delayMs > 0 && gameId && shown.data?.game) {
    if (frameNow === null) {
      out = undefined
    } else if (pushLive && base && pushFrames?.gameId === gameId) {
      const f = pickFrame(pushFrames.list, frameNow, delayMs)
      if (f) out = overlayLiveDoc(base, f.value)
      else holding = true
    } else {
      const f = pageFrames?.gameId === gameId ? pickFrame(pageFrames.list, frameNow, delayMs) : null
      if (f) out = f.value
      else holding = true
    }
  }

  const sync = React.useCallback((): number | null => {
    const tap = Date.now() - offset
    const d =
      pushLive && pushFrames?.gameId === gameId
        ? syncDelay(pushFrames.list, tap, (doc) => doc.home_score + doc.away_score)
        : pageFrames?.gameId === gameId
          ? syncDelay(pageFrames.list, tap, (p) => (p.game ? (p.game.home.score ?? 0) + (p.game.away.score ?? 0) : null))
          : null
    if (d !== null) setDelay(d)
    return d
  }, [offset, pushLive, pushFrames, pageFrames, gameId, setDelay])

  return {
    data: holding ? undefined : out,
    error,
    // Describes the live feed, not the delayed frame.
    source: pickSource({
      shown: shown.data,
      pushFetchedAt: pushLive && pushDoc ? pushDoc.fetched_at : null,
      now: now ?? 0,
      backup: shown.usedBackup,
    }),
    latency,
    spoiler: { delayMs, setDelay, sync, holding },
  }
}
