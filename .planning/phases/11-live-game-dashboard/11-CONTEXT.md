# Phase 11: Live Game Dashboard - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the Live Game Dashboard UI — the primary product experience. Covers the live page (`app/live/page.tsx`) and all new components it requires: scoreboard band, key metrics row, box score module, insight tile rotation, other-games side rail, and three page states (LIVE / DATA_DELAYED / NO_ACTIVE_GAME).

Data comes exclusively from `/api/live` via the existing `useLiveData` SWR hook. No direct CDN or external API calls from the page. All reusable primitives (BoxScoreTable, StatCard, StaleBanner, skeletons) already exist from Phase 10 and are refined by Phase 10.1.

Out of scope: Home dashboard, player pages, schedule, history, odds betting UI, new API routes.

</domain>

<decisions>
## Implementation Decisions

### Box score team display
- Two stacked team sections in a single box score module — Clippers first, opponent second.
- Clear visual divider between the two sections (thin horizontal line or section label row, not a full card border).
- Not tabs — all rows visible at once. Not side-by-side — avoids horizontal overflow at 1280px.
- Rationale: fastest scanning, no hidden information, best for laptop widths, keeps density without clutter.
- Team totals row appears below each team's player rows, before the divider.

### No-active-game state
- When `state = "NO_ACTIVE_GAME"`: render a premium idle state, not an error, not a stub, not a copy of Home.
- Show:
  1. A restrained header: "No live Clippers game right now" — calm, not dramatic.
  2. Next scheduled Clippers game: opponent, date/time, home/away indicator (sourced from API if available, otherwise omit gracefully).
  3. A single supporting line: "Live stats and insights appear here automatically during games." — editorial, not instructional.
- No countdown timer, no duplicate of Home dashboard content, no "coming soon" UI.
- This state should feel like an intentional pregame/idle mode — polished, not broken.

### Insight tile rotation
- Auto-rotation: cycle through available insights every 8 seconds using a subtle fade transition.
- Rotation is independent of the 12-second SWR refresh — a separate timer managed in the component.
- Show 2–3 tiles visually at one time (the tile area has a fixed height, single tile fills it but the rotation implies a set).
- On SWR refresh: if the insight set changes, reconcile cleanly — do not reset the rotation timer mid-cycle; finish the current cycle, then adopt the new set.
- If only 1–2 insights exist, do not force unnecessary rotation (single insight can stay static).
- No manual prev/next arrows for MVP.
- Transition: `opacity` fade over ~200ms — no slide, no position shift.

### Other games panel
- If `other_games` is an empty array (current MVP state): hide the panel entirely. The main content column expands naturally to fill the available width.
- No stub state, no "coming soon", no placeholder panel.
- If `other_games` has entries: render as a compact secondary side rail to the right of the box score (4 of 12 columns). Each row shows: matchup, score, status/clock, and the Clippers-relevant note when available.
- Layout adjusts dynamically based on whether the side rail is present.

### Page states
- `state = "LIVE"`: full dashboard — scoreboard, key metrics, box score, insight tiles, other-games rail (if populated).
- `state = "DATA_DELAYED"`: same layout as LIVE, `StaleBanner` mounts below the scoreboard with last-updated timestamp. Data still renders from cached snapshot.
- `state = "NO_ACTIVE_GAME"`: idle state per above — scoreboard area replaced with next-game card, metrics/box score/insights omitted.

### Claude's Discretion
- Exact scoreboard band layout proportions and spacing (within design system constraints)
- Whether the "next game" info in the no-game state fetches from `/api/home` or is embedded in `/api/live`'s response shape
- Rotation timer implementation (useEffect + setInterval vs. custom hook)
- Exact divider treatment between Clippers and opponent box score sections
- Whether key_metrics scrolls horizontally on narrow viewports or wraps
- Skeleton shape and column count for the key metrics row loading state

</decisions>

<specifics>
## Specific Ideas

- "Premium idle state" for no-game: think of it as the locker room before tip-off — calm, expectant, not empty. Apple Sports handles this well: clean type, next game info, nothing else.
- Box score stacked order (LAC then opponent) mirrors how fans read a box score — your team first, always.
- Insight tile area: fixed height container. Tile content fades in/out within it. The container height never changes, so surrounding layout stays stable.
- Other games: when populated, it should read like a compact sidebar ticker — small text, score, status, note. Dense but not cluttered.

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `hooks/useLiveData.ts`: SWR hook polling `/api/live` at 12s — Phase 11 imports and consumes this directly. Returns `{ data, error, isLoading }`. `data` has `state`, `game`, `key_metrics`, `box_score`, `insights`, `other_games`, `odds`, `meta`.
- `components/box-score/BoxScoreTable.tsx`: Takes `columns`, `rows`, `maxHeight`, `className`. Supports sticky header and sort. Phase 11 calls it twice (once per team) or builds a wrapper that calls it twice with a divider.
- `components/stat-card/StatCard.tsx`: `label` / `value` / `delta` / `context` / `positive`. Used for key metrics row. Already styled to Phase 10.1 spec.
- `components/stat-card/StatCardSkeleton.tsx`: Matches StatCard dimensions — use for key metrics loading state.
- `components/box-score/BoxScoreSkeleton.tsx`: Loading state for box score — use during initial load.
- `components/stale-banner/StaleBanner.tsx`: Props-driven, amber wash banner. Mount when `meta.stale === true`.
- `components/nav/LiveDot.tsx` (in nav): Already polls `/api/live` separately — Phase 11 doesn't re-implement this.
- `components/ui/`: shadcn primitives (Badge, Skeleton, etc.) available.

### Established Patterns
- `app/live/page.tsx` is already a `'use client'` component — Phase 11 replaces its stub body.
- All token utilities available via Tailwind: `bg-surface`, `bg-surface-alt`, `text-foreground`, `text-muted-foreground`, `text-positive`, `text-negative`, `border-white/[0.06]`, etc.
- `tabular-nums` is global on `body` — numbers in the box score and scoreboard render correctly by default.
- Dark-only design: no light mode variants needed. `:root` and `.dark` are identical.
- `format` helpers for time/minutes parsing already exist in API layer — Phase 11 may need a lightweight format utility for display (e.g., `"PT34M12S"` → `"34:12"`).

### Integration Points
- `app/live/page.tsx`: the entry point. Replace stub with full Client Component implementation.
- `app/globals.css`: all design tokens already defined — no new CSS variables needed.
- `/api/live`: fully implemented, returns the spec-compliant shape. Key fields: `state`, `game.home`, `game.away`, `game.period`, `game.clock`, `key_metrics[]`, `box_score.teams[]`, `insights[]`, `other_games[]`, `odds`, `meta`.
- No new API routes needed for this phase.

</code_context>

<deferred>
## Deferred Ideas

- Manual prev/next navigation for insight tiles — could be added in a future refinement phase if needed.
- Countdown timer to next game in the no-game state — deferred, avoid complexity for MVP idle state.
- Momentum/game state chart (referenced in WIREFRAMES.md lower section) — lower-context module, not in Phase 11 requirements; defer to a future phase if desired.
- Quarter splits chart — same as above.
- Player highlight cards in sidebar — referenced in wireframe lower section; defer.
- Other games populated from a real source — requires Phase 7 completion and non-LAC snapshot storage; out of scope for Phase 11 UI work.

</deferred>

---

*Phase: 11-live-game-dashboard*
*Context gathered: 2026-03-06*
