# Live v2 — Real-time Data Path, Call Cadence & Live Features — Design Spec

*2026-09-27 · companion to `2026-09-27-insights-engine-design.md` (shares its play-by-play parser and `pbp_events`)*

## Goal

Make `/live` the screen a Clippers fan keeps open instead of ESPN: updates that are never behind the fan's TV, for **$0/month**, plus three features built on the same event stream: **game flow + win probability**, the **rotation clipboard**, and **spoiler sync**.

"Real-time" here has a concrete meaning. Broadcast TV runs ~5–10 s behind the arena and streams 20–60 s behind. A data path that lands on the fan's screen within ~3 s of the NBA feed is already ahead of every screen they watch on; beyond that, speed is invisible and *alignment* (spoiler sync) is what matters.

**Success looks like:**

- Pipeline latency (NBA feed changes → fan's screen) **p50 ≤ 2.5 s, p95 ≤ 5 s** on the push path; p50 ≤ 5 s on the polling fallback.
- **$0/month** at up to ~1,000 concurrent fans, with no free-tier limit crossed (a Vercel Hobby overage pauses the whole site for 30 days).
- Neon stays under its 0.5 GB storage cap: live data adds < 1 MB per game.
- A dead poller, dead push hub or blocked NBA feed degrades visibly (banner) — never silently stale, never blank.
- Spoiler sync: with a delay set, nothing on the page, in the tab title or in the sticky score reveals a play before the fan's own screen shows it.

## Decisions

| Decision | Choice | Status |
|---|---|---|
| Budget | $0 — free tiers only | Luke |
| Scope | Real-time data path + cadence; game flow/WP; rotation clipboard; spoiler sync. Catch-me-up, alerts, shot chart are the next spec (they reuse this stream) | Luke ("build the spec") |
| Poller | Keep the GitHub Actions game-night runner as the single poller; move its cadence from fixed 12 s to the adaptive state machine in §3 | **Proposed** — see ToS risk §11 |
| Fan-out | **Push over WebSocket from a Cloudflare Durable Object** (free tier); Vercel `/api/live` becomes initial load + fallback | **Proposed** — adds a free Cloudflare account |
| Backup feed | Browser polls ESPN's public scoreboard directly (CORS `*`) only when our runner is stale | **Proposed** |
| Snapshots | Stop writing a full-box `live_snapshots` row every poll; one `live_state` row per game, rewritten on change | **Proposed** |

## 1. What the research found (constraints that shape the design)

**Sources**

| Source | Browser-callable? | Caching seen | Notes |
|---|---|---|---|
| `cdn.nba.com/static/json/liveData/{scoreboard,boxscore,playbyplay}` | **No** — CORS allows only `https://www.nba.com` | unmeasured (see §10 spike) | Richest feed: `oncourt`, `timeoutsRemaining`, `inBonus`, shot x/y, `timeActual`, substitutions. Akamai 403s some IPs: GitHub runners get through (Sept 24 backfill ingested 1,320 games); Luke's home IP is currently blocked. **Poll politely, from one place.** |
| ESPN `site.api.espn.com/.../nba/scoreboard`, `/summary?event=` | **Yes** — `access-control-allow-origin: *` | `max-age=4` / `max-age=1` | Summary is 414 KB raw / 44 KB gz — too heavy to poll per-client. Scoreboard is small. Has per-play `winprobability`. |
| ESPN `sports.core.api.espn.com/v2/.../events/{id}/competitions/{id}/{status,plays,probabilities,officials}` | **Yes** — CORS `*` | `max-age=900` on a finished game; live TTL unmeasured | Tiny (status 317 B), paginated plays. Unofficial. |
| stats.nba.com | No (blocks cloud IPs) | — | Precompute only, never on the live path. |

**Free tiers (fetched 2026-09-27)**

| Platform | Limit that matters here |
|---|---|
| Vercel Hobby | **1M Edge Requests/mo — a CDN cache hit still counts.** ~15 games/mo → ~66k requests/game → ~6 req/s total. Per-client polling at 3 s caps out at ~15 full-game fans. Overage = features paused 30 days, not billed. Cron: once/day max (can't poll). SSE/WebSockets bill memory for the whole connection and cut at 300 s. Request collapsing is documented only for ISR. |
| Neon Free | 100 CU-h/mo (scale-to-zero after 5 min idle), **0.5 GB storage** (writes fail above), 5 GB egress. |
| GitHub Actions (public repo) | Unlimited minutes, 6 h/job, cron ≥ 5 min and can be delayed/dropped. **ToS forbids use "as part of a serverless application"** — grey zone for a poller. |
| Cloudflare Durable Objects (Free, SQLite) | 100k requests/day, 13,000 GB-s/day, 100k row writes/day. **Outgoing WebSocket messages are free**; incoming bill 20:1; hibernated sockets cost nothing. |
| Web Push (VAPID) | Free. iOS 16.4+ only for Home-Screen-installed web apps (the app is already an installable PWA). |

The two decisive facts: **the browser can't read the NBA feed**, so one server-side poller is unavoidable; and **Vercel's Edge Request cap makes client polling the thing that doesn't scale**, so fan-out must be push, from a platform whose free tier doesn't charge per delivered message.

## 2. Architecture

```
                      adaptive 2–30 s (§3)
 cdn.nba.com  ◀────────────────────────────  game-night runner (GitHub Actions, one job per game)
 (pbp, box, scoreboard)                         │  parse → derive (state, flow, WP, lineups, stints)
                                                │
             ┌──────────────────────────────────┼────────────────────────────┐
             ▼                                  ▼                            ▼
   Neon: live_state (1 row/game,       Cloudflare DO "GameRoom"        (next spec) Web Push
         upsert on change)             POST /publish (bearer secret)   from the runner
         pbp_events (append)           ring buffer 150 s + keyframes
             │                                  │ WebSocket push (hibernating)
             ▼                                  ▼
   Vercel GET /api/live  ◀── initial load / fallback ──  Browser  ── backup only ──▶ ESPN scoreboard
   (CDN: s-maxage=2, swr)                                (connection manager §6)    (CORS *, direct)
```

One poller, one derivation, one ordered stream (`seq`). Every consumer — Neon, the hub, later push alerts — gets the same derived state, so the score, box score, flow chart and clipboard can never disagree with each other.

## 3. Call cadence (runner → NBA CDN)

The runner is a state machine. Each poll's result picks the next phase and delay. `playbyplay` is the heartbeat: it is the only feed that tells us *what kind* of moment the game is in (live ball, timeout, review, period break). The box score is fetched **only when the play-by-play has advanced** (its `actionNumber` grew), so an unchanged game costs one request per tick.

| Phase | Entered when | pbp every | box | scoreboard |
|---|---|---|---|---|
| `DORMANT` | no LAC game tipping within 75 min | — (hourly launcher exits) | — | — |
| `PREGAME` | ≤ 75 min to scheduled tip | — (sleep until T−10) | — | T−10 → tip: 30 s |
| `TIP_WATCH` | scheduled tip passed, `gameStatus` still 1 | — | — | **10 s** (tips run 5–15 min late) |
| `LIVE` | `gameStatus` 2, last action is live-ball | **3 s** | on pbp change | 60 s (other games, cross-check) |
| `CLUTCH` | Q4 ≤ 5:00 or OT, margin ≤ 10 | **2 s** | on pbp change | 60 s |
| `STOPPAGE` | last action is `timeout`, `instantreplay`/challenge, or `period` end of Q1/Q3 | **8 s**; back to `LIVE`/`CLUTCH` on the next new action | on pbp change | 60 s |
| `HALFTIME` | `period` end of Q2 | 30 s for 10 min, then 8 s | once at entry | 60 s |
| `FINAL` | `gameStatus` 3 | one last pbp + box → finalize → exit | | |
| `BACKOFF` | fetch error | 3 → 6 → 12 → 24 → 60 s, ±20 % jitter | | |

Rules layered on the table:

1. **Never poll a cached object early.** Each response's `Cache-Control: max-age` minus `Age` sets a floor for that URL's next poll. If the spike (§10) shows Akamai caches pbp for 5 s, the 3 s/2 s rows become 5 s automatically — no wasted requests, no pretend freshness.
2. **Conditional requests.** Send `If-None-Match`/`If-Modified-Since` when the CDN returns validators; a `304` is a no-change tick.
3. **Sustained 403s** (5 in a row): stop hitting the NBA CDN for 5 min and switch the runner's source to ESPN `summary` at 5 s (degraded: score, clock, plays, box with ESPN athletes mapped to NBA ids via `scripts/lib/player-match.ts`; no `oncourt`/`inBonus`). Resume NBA polling after the pause.
4. The phase and the next poll time ride along in every published state as `cadence: {phase, next_ms}` — clients use it for their fallback polling (§6).

**Budget per game** (~2 h 20 min wall clock): pbp ≈ 2,200 requests, box ≈ 600 (one per new action), scoreboard ≈ 150 → **≈ 3,000 requests, ~0.35 req/s**. That is less than one fan with nba.com open. Today's fixed 12 s loop makes ~2,100 requests but pulls all three feeds every tick; the adaptive loop costs ~40 % more requests, most of them small or `304`, and is 4–6× fresher during live play.

The cadence function is pure — `nextPoll(prev: PollContext, result: PollResult) → {phase, delayMs, fetch: {pbp, box, scoreboard}}` — in `scripts/lib/live-cadence.ts`, and it is the unit under test.

## 4. Live state model

The runner derives one `LiveState` per change (`seq` increments by one per publish):

```ts
interface LiveState {
  v: 1
  seq: number                 // monotonic per game
  observed_at: string         // NBA timeActual of the newest action (wall clock of the real play)
  fetched_at: string          // when the runner saw it
  cadence: { phase: Phase; next_ms: number }
  game: { nba_game_id; status; period; clock; home: TeamLine; away: TeamLine }  // TeamLine: score, timeouts_left, in_bonus, fouls_period
  last_plays: Play[]          // newest 15, normalized (insights v2 §1.2 event shape + description, x/y)
  box: BoxRow[]               // compact player rows, incl. oncourt, pf, +/-
  lineups: LineupState        // §7.2
  flow: FlowPoint[]           // §7.1 — full series, ~600 points
  wp: { lac: number; model: 'stern-v1'; sigma: number }   // §7.1
}
```

**Messages** (runner → hub → clients):

- `keyframe` — the full `LiveState`. Sent every 30 s and on every client connect.
- `delta` — `{seq, observed_at, game, new_plays, box_rows_changed, lineups, flow_appended, wp, cadence}`. Only the box rows that changed; `flow` only appends. Typically 1–4 KB.

A client with keyframe *k* plus deltas *k+1…n* has exactly state *n*. A gap in `seq` means "request a keyframe." Pure reducer `applyMessage(state, msg)` in `src/lib/live/protocol.ts`, shared by the client and tests.

## 5. Persistence (runner → Neon)

- **`live_state`** (new): `game_id PK, seq, state JSONB, updated_at`. Upserted when `seq` changes (≈ 600–1,000 writes/game, one row). `/api/live` reads this single row instead of rebuilding the payload from snapshots.
- **`pbp_events`**: appended as new actions arrive (table defined in insights v2 §1.2; whichever spec ships first creates it).
- **`live_snapshots`**: no longer written every poll. One row per period end and one at final (for insight proofs that reference a moment in time). The existing rows (14 today) stay.
- **After finalize:** `live_state.state` is trimmed to the final keyframe; nothing else to prune.

**Storage:** < 1 MB/game → < 100 MB/season. (Today's 12 s full-box snapshots would be ~15–25 MB/game if the runner had run all season — over the 0.5 GB cap before the All-Star break.) Note that the insights v2 deep backfill budgets ~120 MB; together they fit, but the cap is the tightest free-tier limit in the system.

**Compute:** Neon is awake only while the runner is connected (~3 h/game) → ≈ 12 CU-h/mo of 100.

## 6. Fan-out

### 6.1 The hub (Cloudflare Durable Object)

A Worker `ccc-live` in `workers/live-hub/` (wrangler, TypeScript) with one Durable Object per game (`GameRoom`, keyed by `nba_game_id`):

- `POST /publish/:gameId` — runner only, `Authorization: Bearer $LIVE_HUB_SECRET`. Stores the message in a ring buffer (last 150 s of messages plus the keyframes inside that window, in DO SQLite) and broadcasts it to every socket.
- `GET /ws/:gameId` — WebSocket upgrade using the **hibernation API**. Rejects `Origin`s other than `clippers.lukeghanna.com` and localhost (stops hot-linking from eating the quota). On connect it sends the oldest keyframe in the buffer followed by every later message, so the client can render any moment in the last ~120 s immediately (spoiler sync, §7.3).
- Client → hub messages: none except the protocol's ping. Nothing a fan sends is broadcast.

**Budget per game day:** ~1,000 publishes + connections (200 fans × ~3 reconnects = 600) ≈ 1,600 requests of 100k; ~1,000 row writes of 100k; ~1,400 GB-s of 13,000. Outgoing messages are free, so fan count barely moves the numbers. Headroom for ~1,000+ concurrent fans.

Hosting: `live.lukeghanna.com` if the domain's DNS can point at Cloudflare, otherwise the `*.workers.dev` URL (open question §12).

### 6.2 Client connection manager (`hooks/useLiveStream.ts`, replaces `useLiveData` on `/live`)

Three tiers, tried in order, with a visible source indicator:

1. **Push** — WebSocket to the hub. Reconnects with backoff (1 → 2 → 4 → 8 s, max 30 s) and resumes from its last `seq` (the hub replays from the ring buffer, or sends a keyframe).
2. **Poll** — if the socket can't connect within 5 s or drops three times in a minute: `GET /api/live` every `max(cadence.next_ms, 4 s)`. The route returns the `live_state` row with `Cache-Control: public, s-maxage=2, stale-while-revalidate=10` and an `ETag` of `seq`, so all fans in a region share one function call per 2 s. Retries push every 60 s.
3. **Backup** — if the newest state is > 30 s old while the game should be in progress (runner down, delayed cron, NBA feed blocked): poll ESPN's scoreboard directly from the browser every 5 s, match the event by date + team abbreviations, and show score/clock/period only. Runner-derived panels (flow, clipboard, box) show "Paused — backup feed" instead of stale numbers.

Common rules:
- **Page hidden** (`visibilitychange`): close the socket / stop polling after 30 s hidden. On return: reconnect, and the hub's replay gives the page the full catch-up (the hook for the catch-me-up feature in the next spec).
- **Idle days:** no socket. `/live` fetches `/api/live` once and then every 5 min, as today.
- The TopBar's live chip keeps using the cheap `/api/live` poll (5 min idle / 30 s on game day) so every page doesn't open a socket.

**Vercel budget:** with push working, a game costs Vercel ~1 page load + 1 `/api/live` per fan. Worst case — hub down all game, 20 fans polling at 4 s behind the 2 s CDN cache — ≈ 20 × 2,100 = 42k edge requests; survivable once, and the hub being down is a fix-now event.

## 7. Features

### 7.1 Game flow + win probability

- **Flow series** (runner, per scoring action): `{elapsed_sec, margin_lac, wp_lac, action_number}`. Markers: runs ≥ 8–0 (existing definition), timeouts, lead changes, period boundaries, the largest lead each way.
- **Chart** (`components/live/GameFlow.tsx`): margin as an area above/below zero in Clippers/opponent colors, WP as a line on a secondary 0–100 % axis, markers as ticks. Tap/hover a point → the plays around it. Desktop: full width under the scoreboard. Mobile: a compact sparkline in the scoreboard, full chart one tap away.
- **Win-probability model `stern-v1`** (runner, pure `src/lib/live/win-prob.ts`): final margin ~ Normal(m + E·r, σ²·r), so P(LAC wins) = Φ((m + E·r) / (σ·√r)), where m = current LAC margin, r = seconds remaining ÷ 2,880 (in overtime, the OT period's seconds remaining ÷ 2,880; at r = 0 a tie is 0.5, since the game goes to another OT), E = pregame expected LAC margin = −(LAC closing spread) from `odds` (fallback: ±2.5 for home court), σ = calibrated game-margin standard deviation (~12–13).
  - **Calibrated, not asserted:** σ is fit by minimizing Brier score over every league game with play-by-play in the DB (2022-23 onward). The fitted σ, Brier score and a reliability table are written to `app_kv` and shown behind an "About this model" link — a model estimate, labeled as one, never presented as a verified insight.
  - ESPN's per-play WP is logged alongside ours during the preseason spike as a sanity check. It is not displayed.
  - Out of scope for v1: possession and bonus adjustments (they add ~1–2 WP points late; revisit after calibration).
- The existing pregame `WinProbabilityBar` (no-vig moneyline) becomes the flow chart's starting point at 0:00.

### 7.2 Rotation clipboard

Built from the box score (`oncourt`, `foulsPersonal`, `timeoutsRemaining`, `inBonus`) plus play-by-play `substitution` actions. It reuses the stint logic in `scripts/lib/finalize.ts`, extracted into a pure module that is shared with the live runner.

```ts
interface LineupState {
  on_court: { lac: StintPlayer[]; opp: StintPlayer[] }
  // StintPlayer: player_id, name, stint_start_clock, stint_secs, stint_plus_minus, pf, foul_trouble, min, usual_min
  current_unit: { lac_plus_minus: number; secs_together: number }
  units_tonight: Array<{ player_ids: number[]; secs: number; plus_minus: number }>   // LAC five-man units, top 5 by minutes
  timeouts: { lac: number; opp: number }
  bonus: { lac: boolean; opp: boolean }
}
```

- **Foul trouble** is flagged at ≥ 2 fouls in Q1, ≥ 3 in Q2, ≥ 4 in Q3, ≥ 5 in Q4/OT.
- **Minutes vs. usual:** each player's minutes are projected to 48, then compared with their average over the last 10 games (`rolling_player_stats`). A player more than 25 % off his usual is highlighted.
- **Layout** (`components/live/Clipboard.tsx`): two short columns of five on-court players, each with a stint timer, stint +/-, a foul pips row, and a minutes-vs-usual bar. Timeouts and bonus sit in the header. Below: tonight's LAC units ranked by minutes, with +/-. On mobile it is its own tab next to the box score.

### 7.3 Spoiler sync

- **Setting:** a delay of 0–120 s, stored in `localStorage` and set from the scoreboard. It offers presets (TV ≈ 8 s, streaming ≈ 30 s) and a **"Sync to my screen"** button.
- **Sync to my screen:** the fan taps it the moment their screen shows a basket. The client finds the newest scoring play received before the tap and sets `delay = tap_time − (play.observed_at + offset)`, rounded to 1 s (`offset` converts NBA wall-clock time to device time; see §9).
- **Rendering:** the client keeps every message from the last 150 s, keyed by `observed_at`. It renders the newest state whose `observed_at ≤ now − delay`. When the delay is shorter than the pipeline latency, it shows messages as they arrive.
  - Everything reads from the delayed state: the scoreboard, the sticky score, the tab title (`LiveTabTitle`), the flow chart, the clipboard and the insights.
  - One reducer feeds every component, so nothing can leak a play early.
- **Why `observed_at` is the NBA's `timeActual`:** that field is the wall-clock time of the real play, and the fan's delay is measured against the real play. Using it keeps sync correct even when our pipeline is briefly slow.
- **Push alerts:** when they arrive in the next spec, each alert will respect the delay stored with that subscription. The runner holds a per-subscriber send queue.

## 8. Code layout

| Path | Change |
|---|---|
| `scripts/lib/live-cadence.ts` | New: pure phase machine + delay rules (§3) |
| `scripts/lib/live-derive/` | New: `state.ts`, `flow.ts`, `lineups.ts` (stints extracted from `finalize.ts`), `win-prob.ts` re-export |
| `scripts/lib/live-publish.ts` | New: diff previous/next state → `keyframe`/`delta`; POST to hub; upsert `live_state` |
| `scripts/game-night.ts`, `scripts/lib/live-cycle.ts` | The poll loop uses the cadence machine; fetch pbp/box/scoreboard independently; stop per-poll snapshots |
| `scripts/lib/nba-live-client.ts` | Conditional requests, expose `Cache-Control`/`Age`/`ETag` |
| `src/lib/live/protocol.ts`, `win-prob.ts`, `spoiler.ts` | New: shared reducer, model, delay buffer |
| `workers/live-hub/` | New: Worker + `GameRoom` DO, `wrangler.toml`, tests with `@cloudflare/vitest-pool-workers` |
| `app/api/live/route.ts` | Reads `live_state`; CDN caching + ETag; keeps the `NO_ACTIVE_GAME`/`DATA_DELAYED` contract |
| `hooks/useLiveStream.ts` | New: the three-tier connection manager |
| `components/live/GameFlow.tsx`, `Clipboard.tsx`, `SpoilerControl.tsx`, `FeedSource.tsx` | New UI |
| `Docs/DB_SCHEMA.sql` + migration | `live_state` table |
| `.github/workflows/deploy-live-hub.yml` | New: `wrangler deploy` on changes to `workers/live-hub/` (secret `CLOUDFLARE_API_TOKEN`) |

## 9. Failure modes

| Failure | Detection | Behavior |
|---|---|---|
| NBA CDN slow / 5xx | fetch error | Runner `BACKOFF`; clients see `cadence.phase = BACKOFF`, and past 30 s of age the "Feed delayed" banner |
| NBA CDN 403s runner IP | 5 consecutive 403s | Runner switches to ESPN `summary` for 5 min, degraded fields marked; retries NBA |
| Runner not started (cron delayed/dropped) or crashed | state age > 30 s while game should be live | Clients switch to the ESPN backup tier; banner "Backup feed"; manual `workflow_dispatch` recovers |
| Hub down / WebSocket blocked (corporate networks) | connect timeout, repeated drops | Poll tier via Vercel CDN |
| Neon down | runner write fails | Runner keeps publishing to the hub (Neon write retried async); the poll tier shows "Feed delayed" |
| Out-of-order / missed messages | `seq` gap | Client asks the hub for a keyframe |
| Clock skew on fan's device (spoiler sync) | — | The hub stamps each message `sent_at`; the client keeps `offset = local_receive − sent_at` (smoothed) and converts every `observed_at` to device time before comparing with `now − delay` or the sync tap |

## 10. Verification plan

**Phase 0 — feed measurement spike** (preseason, Oct 3–20; any NBA game works). This is a throwaway `workflow_dispatch` job, `feed-probe`, that polls every 1 s for 20 minutes of a live game:
- **Sources polled:** NBA pbp, box and scoreboard; ESPN site `summary`; ESPN core `status` and `plays`.
- **Logged per request:** status, `Cache-Control`, `Age`, `ETag`/`Last-Modified`, content hash, and the newest `timeActual`.
- **What it answers:**
  - How long after the real play each source changes: `timeActual` → first change seen.
  - The CDN TTL, and whether conditional requests return `304`.
  - Whether ESPN core's live TTL is short enough to serve as a backup.
- **Plus one request from a Cloudflare Worker:** does the NBA CDN answer Cloudflare's egress IPs? If it does, the Durable Object could one day do the polling itself (§11).
- **Outcome:** the results set the final constants in §3. The table's numbers are floors until then.

**Tests**
- Unit (Vitest):
  - The cadence machine: every phase transition, the TTL floor, backoff, and the 403 source switch.
  - `applyMessage`: keyframe + deltas reproduce the same state; a `seq` gap triggers a keyframe request.
  - Spoiler buffer selection.
  - Stints, foul trouble and minutes-vs-usual.
  - Flow markers.
  - WP model boundary cases: a tie at 0:00 is 0.5 in OT, and a big lead late approaches 1.
- Hub: `@cloudflare/vitest-pool-workers` tests for publish auth, the origin check, replay on connect, and hibernation round-trip.
- **Replay harness:** the spike records raw responses. `npm run replay-live -- <recording>` feeds them through the runner at 10× into `wrangler dev` plus a local Postgres (the existing fixture flow). Assertion: the client's final state equals the final box score, `seq` is gap-free, and latency is logged at each hop.
- **Calibration check:** `npm run calibrate-wp` prints σ, the Brier score and the reliability table. CI fails if Brier gets worse than the stored value by more than 0.005.

**Live acceptance (preseason Clippers game, or opening night Oct 21 vs SAC)**
- Latency sampled at each hop: `timeActual` → `fetched_at` → hub broadcast → client receive, shown in a dev overlay at `?debug=latency`. Target: pipeline p50 ≤ 2.5 s.
- The Vercel, Cloudflare and Neon usage dashboards are checked the next morning against the §3/§5/§6 budgets.

## 11. Risks

- **GitHub Actions ToS.** A game-time poller is close to the "serverless application" clause. Likely consequence if flagged: the workflow gets disabled, not the account. Mitigations:
  - The backup tier keeps scores flowing if it happens.
  - The spike checks whether a Durable Object can poll the NBA CDN itself (alarms every 2–3 s, parsing within free-tier CPU limits). If it can, the poller moves to Cloudflare and GitHub Actions only handles nightly batch work.
- **Unofficial feeds.** Neither the NBA CDN nor ESPN is licensed. That's acceptable for a free fan app. Anything monetized needs a licensed feed.
- **Neon 0.5 GB.** This is the tightest limit. Live v2 is designed to be small, but the insights v2 backfill and this spec share it. Keep the insights spec's size checkpoint.
- **A second platform.** Cloudflare adds an account, a deploy workflow and a secret. That's the price of push fan-out at $0. Ably's free tier (200 connections, 6M messages/mo) is the fallback plan if Cloudflare is rejected. It needs no deployable code, but caps at 200 fans.

## 12. Open questions for Luke

1. Is adding a free Cloudflare account for the push hub OK? The alternative is polling-only on Vercel, which is fine for ~15 concurrent fans and risks a 30-day site pause beyond that.
2. Is `lukeghanna.com`'s DNS on Cloudflare? That decides whether the hub lives at `live.lukeghanna.com` or `*.workers.dev`.
3. Do you accept the GitHub Actions ToS grey zone for now, given the spike will test moving the poller to Cloudflare?

## 13. Build order

1. **Spike** (§10 phase 0): measure the feeds and fix the constants.
2. **Runner:** cadence machine, `live_state`, snapshot change, `/api/live` reading `live_state` with CDN caching, client cadence hints. This already makes the app 4–6× fresher with no new platform.
3. **Hub + `useLiveStream`** (push, poll and backup tiers).
4. **Features:** game flow + WP (with calibration), clipboard, spoiler sync.
5. **Next spec:** catch-me-up, alerts (web push from the runner), shot chart, and the Tier 2 ideas.
