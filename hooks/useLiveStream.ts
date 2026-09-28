'use client'

import * as React from 'react'
import { payloadReceivedAt, useLiveData } from '@/hooks/useLiveData'
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
  offsetSample,
  pageFramePlayed,
  pageTotalScore,
  parseStoredDelay,
  parseStoredOffset,
  pickFrame,
  pickIndex,
  pickOffset,
  pushFramePlayed,
  SYNC_OFFSET_STORAGE_KEY,
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
 * Spoiler frames for one game (`key`). Each frame keeps its play time (server
 * clock) and its arrival (device clock) apart, and each is compared only in
 * its own clock at pick time (src/lib/live/spoiler.ts): the offset estimate
 * converts the device's "now", never an arrival, so an over-estimate can only
 * make a frame show later. Replayed hub messages keep their own play times.
 */
type Frames<T> = { key: string; list: Frame<T>[] } | null

function withFrame<T>(frames: Frames<T>, key: string, frame: Frame<T>, now: number): Frames<T> {
  return { key, list: addFrame(frames && frames.key === key ? frames.list : [], frame, now) }
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
  // The clock offset a synced delay was measured under (null for a preset or
  // the slider): frames are picked with the larger of it and the current
  // estimate, so a later, smaller estimate can't run the page early.
  const [offsetAtSync, setOffsetAtSync] = React.useState<number | null>(() => {
    if (typeof window === 'undefined') return null
    try {
      return parseStoredOffset(window.localStorage.getItem(SYNC_OFFSET_STORAGE_KEY))
    } catch {
      return null
    }
  })
  const saveDelay = React.useCallback((ms: number, syncOffset: number | null) => {
    setDelayMs(ms)
    setOffsetAtSync(syncOffset)
    try {
      window.localStorage.setItem(DELAY_STORAGE_KEY, String(ms))
      if (syncOffset === null) window.localStorage.removeItem(SYNC_OFFSET_STORAGE_KEY)
      else window.localStorage.setItem(SYNC_OFFSET_STORAGE_KEY, String(syncOffset))
    } catch {
      // Private mode or blocked storage: the delay just won't persist.
    }
  }, [])
  // A preset or the slider: whole seconds to the nearest, no synced offset.
  const setDelay = React.useCallback((ms: number) => saveDelay(clampDelay(ms), null), [saveDelay])
  // A delayed page steps through its buffer once a second.
  const tickMs = delayMs > 0 ? 1_000 : 5_000
  const now = useNow(tickMs)?.getTime() ?? null
  const [pushFrames, setPushFrames] = React.useState<Frames<LiveStateDoc>>(null)
  const [pageFrames, setPageFrames] = React.useState<Frames<LivePayload>>(null)
  // Clock-offset samples (device receive time − server stamp, spec §7.3): the
  // current socket's `hub_at`s, and /api/live's `meta.generated_at`s so a page
  // without push still corrects for a fast device clock.
  const [hubSamples, setHubSamples] = React.useState<number[]>([])
  const [pollSamples, setPollSamples] = React.useState<number[]>([])
  // `receivedAt`: device clock, recorded where reading the clock is legal.
  const [pushed, setPushed] = React.useState<{ gameId: string; doc: LiveStateDoc; receivedAt: number } | null>(null)
  const [latency, setLatency] = React.useState<LatencySample | null>(null)
  const [espn, setEspn] = React.useState<{ gameId: string; score: EspnScore; receivedAt: number } | null>(null)
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
  const pushReceivedAt = pushed && pushed.gameId === gameId ? pushed.receivedAt : null

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
        const receivedAt = Date.now()
        setPushed({ gameId, doc: result.state, receivedAt })
        if (typeof msg.hub_at === 'number') {
          samples = addOffsetSample(samples, offsetSample(receivedAt, msg.hub_at))
          setHubSamples(samples)
        }
        const doc = result.state
        const frame = { played: pushFramePlayed(doc.observed_at, msg.hub_at), arrived: receivedAt, value: doc }
        setPushFrames((f) => withFrame(f, gameId, frame, receivedAt))
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
        if (score && !stopped) setEspn({ gameId: game_id, score, receivedAt: Date.now() })
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
  const backupReceivedAt = backupScore && espn ? espn.receivedAt : null

  const shown = React.useMemo(() => {
    let data = base
    // When what's on screen reached this device (device clock), whichever tier supplied it.
    let receivedAt = base ? payloadReceivedAt(base) : undefined
    if (data && pushLive && pushDoc) {
      data = overlayLiveDoc(data, pushDoc)
      receivedAt = pushReceivedAt ?? undefined
    }
    // overlayEspn hands back the same object when ESPN is behind us (or can't
    // apply), so the chip only claims the backup feed when it actually changed
    // what's on screen.
    let usedBackup = false
    if (data && backupScore) {
      const withBackup = overlayEspn(data, backupScore)
      usedBackup = withBackup !== data
      if (usedBackup) receivedAt = backupReceivedAt ?? undefined
      data = withBackup
    }
    return { data, usedBackup, receivedAt }
  }, [base, pushLive, pushDoc, pushReceivedAt, backupScore, backupReceivedAt])

  // ── Spoiler sync (spec §7.3) ──
  // Each new /api/live payload adds a clock-offset sample (the "store
  // information from previous renders" pattern, like followChip above). The
  // receive time was recorded by the fetcher; generated_at can be older than
  // the response (a CDN-cached copy), which only makes the sample larger, and
  // the smallest sample wins.
  const [seenBase, setSeenBase] = React.useState<LivePayload | undefined>(undefined)
  if (base !== seenBase) {
    setSeenBase(base)
    const r = base ? payloadReceivedAt(base) : undefined
    if (base && r !== undefined) setPollSamples((s) => addOffsetSample(s, offsetSample(r, base.meta?.generated_at)))
  }
  // Device clock minus the server's; 0 until a sample. Each source keeps its
  // last 20 samples; every sample over-estimates the offset, so the smallest
  // wins. Only ever applied to "now" (see Frames). Number(): the React
  // Compiler can't infer clockOffset's return type, so without it it treats
  // the value as mutable once pickFrame receives it and can't keep `sync`
  // memoized (react-hooks/preserve-manual-memoization).
  const offset = Number(clockOffset([...hubSamples, ...pollSamples]))
  // What frames are picked with: never less than the offset a synced delay was measured under.
  const frameOffset = Number(pickOffset(offset, offsetAtSync))

  // Page frames are keyed by the on-screen game's own id: a game /api/live
  // serves without an NBA id (no push, gameId null) is still delayed.
  const pageKey = shown.data?.game ? String(shown.data.game.game_id) : null

  // Record each new on-screen payload with its play time (none for an ESPN
  // backup overlay) and when it reached this device — recorded where reading
  // the clock is legal, not the last useNow tick, which a throttled or frozen
  // tab can leave far behind.
  const [seenShown, setSeenShown] = React.useState<LivePayload | undefined>(undefined)
  if (shown.data !== seenShown) {
    setSeenShown(shown.data)
    const d = shown.data
    const arrived = shown.receivedAt
    if (pageKey && d?.game && arrived !== undefined) {
      const frame = { played: pageFramePlayed(d.observed_at, shown.usedBackup), arrived, value: d }
      setPageFrames((f) => withFrame(f, pageKey, frame, arrived))
    }
  }

  // With a delay set, show the newest frame at least that old: a pushed doc
  // over the current /api/live base while push is live, else a whole page
  // payload. Nothing that old yet → hold rather than show a newer score.
  // Before useNow has mounted there's no clock to judge by: show the loading
  // state. That render only has a game when SWR already had /api/live cached
  // (a client-side navigation — the TopBar polls it on every page), never
  // during hydration, so the first client render still matches the server's.
  const delayOn = delayMs > 0 && pageKey !== null && now !== null
  const onPush = Boolean(pushLive && base && gameId && pushFrames?.key === gameId)
  // A position, not the frame: the delayed page re-picks every second, and
  // while the same pushed frame is picked the overlaid payload stays the same
  // object (rebuilt only when the base or the buffer changes).
  // (Number(): as with the offset, the React Compiler can't infer the return type.)
  const pushIdx = delayOn && onPush && pushFrames ? Number(pickIndex(pushFrames.list, now, frameOffset, delayMs)) : -1
  const delayedPush = React.useMemo(() => {
    const f = pushIdx >= 0 ? pushFrames?.list[pushIdx] : undefined
    return base && f ? overlayLiveDoc(base, f.value) : undefined
  }, [base, pushFrames, pushIdx])
  let out = shown.data
  let holding = false
  if (delayMs > 0 && pageKey) {
    if (now === null) {
      out = undefined
    } else if (onPush) {
      if (delayedPush) out = delayedPush
      else holding = true
    } else {
      const f = pageFrames?.key === pageKey ? pickFrame(pageFrames.list, now, frameOffset, delayMs) : null
      if (f) out = f.value
      else holding = true
    }
  }
  if (holding) out = undefined

  const sync = React.useCallback((): number | null => {
    const tap = Date.now()
    const d =
      pushLive && gameId && pushFrames?.key === gameId
        ? syncDelay(pushFrames.list, tap, offset, (doc) => doc.home_score + doc.away_score)
        : pageKey && pageFrames?.key === pageKey
          ? syncDelay(pageFrames.list, tap, offset, pageTotalScore)
          : null
    // Already whole seconds (rounded up); kept with the offset it was measured under.
    if (d !== null) saveDelay(d, offset)
    return d
  }, [offset, pushLive, pushFrames, pageFrames, gameId, pageKey, saveDelay])

  return {
    data: out,
    error,
    // The tier (push/poll/backup) describes the live feed; whether a game is
    // on (idle at the final) follows the delayed payload, or the chip would
    // vanish before the delayed scoreboard reaches the buzzer.
    source: pickSource({
      shown: out,
      pushFetchedAt: pushLive && pushDoc ? pushDoc.fetched_at : null,
      now: now ?? 0,
      backup: shown.usedBackup,
    }),
    latency,
    spoiler: { delayMs, setDelay, sync, holding },
  }
}
