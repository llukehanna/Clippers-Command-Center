# Phase 11: Live Game Dashboard - Research

**Researched:** 2026-03-06
**Domain:** Next.js React UI — live sports dashboard, SWR polling, Tailwind v4, shadcn/ui primitives
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Box score team display**
- Two stacked team sections in a single box score module — Clippers first, opponent second.
- Clear visual divider between the two sections (thin horizontal line or section label row, not a full card border).
- Not tabs — all rows visible at once. Not side-by-side — avoids horizontal overflow at 1280px.
- Team totals row appears below each team's player rows, before the divider.

**No-active-game state**
- When `state = "NO_ACTIVE_GAME"`: render a premium idle state.
- Show: (1) restrained header "No live Clippers game right now", (2) next scheduled Clippers game if available from API, (3) single supporting line "Live stats and insights appear here automatically during games."
- No countdown timer, no duplicate of Home dashboard content, no "coming soon" UI.

**Insight tile rotation**
- Auto-rotation every 8 seconds using opacity fade (~200ms).
- Rotation timer is independent of the 12-second SWR refresh.
- Show 2–3 tiles visually at one time in a fixed-height container.
- On SWR refresh: finish current cycle before adopting new insight set.
- If only 1–2 insights: no forced rotation (static is fine).
- No manual prev/next arrows for MVP.

**Other games panel**
- If `other_games` is empty: hide the panel entirely. Main content expands.
- If populated: compact side rail to the right (4 of 12 columns). Each row shows matchup, score, status/clock, Clippers-relevant note.

**Page states**
- `state = "LIVE"`: full dashboard — scoreboard, key metrics, box score, insight tiles, other-games rail (if populated).
- `state = "DATA_DELAYED"`: same as LIVE, StaleBanner mounts below scoreboard with last-updated timestamp.
- `state = "NO_ACTIVE_GAME"`: idle state — scoreboard replaced with next-game card, metrics/box score/insights omitted.

### Claude's Discretion
- Exact scoreboard band layout proportions and spacing (within design system constraints)
- Whether the "next game" info in the no-game state fetches from `/api/home` or is embedded in `/api/live`'s response shape
- Rotation timer implementation (useEffect + setInterval vs. custom hook)
- Exact divider treatment between Clippers and opponent box score sections
- Whether key_metrics scrolls horizontally on narrow viewports or wraps
- Skeleton shape and column count for the key metrics row loading state

### Deferred Ideas (OUT OF SCOPE)
- Manual prev/next navigation for insight tiles
- Countdown timer to next game
- Momentum/game state chart
- Quarter splits chart
- Player highlight cards in sidebar
- Other games populated from a real source (requires Phase 7 completion)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| LIVE-02 | Live dashboard displays live score, game clock, and quarter | `game.home.score`, `game.away.score`, `game.period`, `game.clock` are present in `/api/live` LIVE response. Scoreboard band component needed. |
| LIVE-03 | Full team box score with standard columns (MIN, PTS, REB, AST, STL, BLK, TO, FG, 3PT, FT, +/-) | `box_score.teams[].players` already includes all 11 columns from `buildPlayerRow()`. `BoxScoreTable` accepts columns+rows. Wrapper component needed to call it twice with divider. |
| LIVE-04 | Player box score rows with compact density | BoxScoreTable row height is h-9 (36px) — already compact. `box_score.teams[].players` maps to rows directly. |
| LIVE-05 | Key live metrics row (eFG%, TO margin, rebound margin, pace, FT edge) | `key_metrics[]` from API has efg_pct, tov_margin, reb_margin, pace. FT edge is NOT in the current API output — requires either a display-side computation or a note in the plan. StatCard and StatCardSkeleton are ready. |
| LIVE-10 | Dashboard displays 2–3 rotating insight tiles simultaneously | `insights[]` array is present in LIVE response. Rotation logic (8s timer + opacity fade) is a new component. Fixed-height container pattern required. |
| LIVE-11 | Dashboard displays other NBA games relevant to Clippers | `other_games` is always `[]` in current API (MVP state). Panel hides entirely when empty per locked decision. Component must handle both empty and populated states. |
</phase_requirements>

---

## Summary

Phase 11 is a pure UI implementation phase. The data layer (`/api/live`), all reusable primitives (`BoxScoreTable`, `StatCard`, `StaleBanner`, skeletons), and the design system (MASTER.md + live.md page overrides) are fully complete from prior phases. The work is: replace the stub body of `app/live/page.tsx` with the full Live Game Dashboard, and create the new components it requires.

The API payload shape is definitively known from reading `src/app/api/live/route.ts`. There are no unknowns about data availability — only the FT edge metric in LIVE-05 is absent from `key_metrics[]` and requires a plan-level decision. All three page states (LIVE, DATA_DELAYED, NO_ACTIVE_GAME) have clear implementation paths defined in CONTEXT.md.

The insight tile rotation pattern (8s cycle, opacity fade, stable fixed-height container, reconcile on SWR refresh) is the only non-trivial React logic in the phase. The rotation timer should live in a custom hook (`useInsightRotation`) to keep the page component clean and enable isolated testing.

**Primary recommendation:** Implement in three plans — (1) Scoreboard band + page shell with state routing, (2) Box score module + key metrics row, (3) Insight tile rotator + other-games panel + no-game idle state.

---

## Standard Stack

### Core (already installed — no new packages needed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 | Framework — `app/live/page.tsx` is 'use client' | Already in use |
| React | 19.2.3 | Component model, hooks (useState, useEffect, useRef) | Already in use |
| SWR | 2.4.1 | Data fetching via `useLiveData` hook (12s polling) | Already in use, hook already written |
| Tailwind CSS | v4 | Styling — token-based design system | Already in use, all tokens defined |
| shadcn/ui | 3.8.5 | UI primitives (Skeleton, Badge) | Already in use |
| lucide-react | 0.577.0 | SVG icons (no emoji icons per design system rules) | Already in use in TopNav |

### No New Dependencies

All required functionality is available from existing packages. The insight rotation is implemented with `useEffect` + `useRef` + `useState` — no animation library needed. The opacity fade is a Tailwind `transition-opacity duration-200` class.

---

## Architecture Patterns

### Recommended File Structure

```
app/live/
└── page.tsx                         # Entry point — replace stub with full implementation

components/live/
├── LiveScoreboard.tsx               # Scoreboard band (scores, clock, period)
├── KeyMetricsRow.tsx                # StatCard row for eFG%, TO margin, reb margin, pace
├── BoxScoreModule.tsx               # Wrapper: Clippers section + divider + opponent section
├── InsightTileArea.tsx              # Fixed-height container + rotation logic
├── OtherGamesPanel.tsx              # Side rail (hidden when other_games is empty)
└── NoGameIdleState.tsx              # Premium idle state for NO_ACTIVE_GAME

hooks/
└── useInsightRotation.ts            # Custom hook: 8s cycle timer, reconcile on new insights
```

### Pattern 1: Page State Router

`app/live/page.tsx` calls `useLiveData()` and routes to the appropriate layout based on `data.state`:

```typescript
// Source: CONTEXT.md locked decisions + api/live/route.ts
'use client'

import { useLiveData } from '@/hooks/useLiveData'
import { LiveScoreboard } from '@/components/live/LiveScoreboard'
import { StaleBanner } from '@/components/stale-banner/StaleBanner'
import { NoGameIdleState } from '@/components/live/NoGameIdleState'
// ... other imports

export default function LivePage() {
  const { data, error, isLoading } = useLiveData()

  if (isLoading && !data) return <LivePageSkeleton />
  if (error && !data) return <LivePageError />

  const state = data?.state ?? 'NO_ACTIVE_GAME'

  if (state === 'NO_ACTIVE_GAME') {
    return <NoGameIdleState />
  }

  // LIVE and DATA_DELAYED share the same layout
  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto">
      <LiveScoreboard game={data.game} />
      {state === 'DATA_DELAYED' && (
        <StaleBanner stale={true} generatedAt={data.meta.generated_at} />
      )}
      <KeyMetricsRow metrics={data.key_metrics} isLoading={false} />
      <div className={data.other_games.length > 0 ? 'grid grid-cols-12 gap-4 mt-6' : 'mt-6'}>
        <div className={data.other_games.length > 0 ? 'col-span-8' : 'col-span-12'}>
          <BoxScoreModule boxScore={data.box_score} />
          <InsightTileArea insights={data.insights} className="mt-6" />
        </div>
        {data.other_games.length > 0 && (
          <div className="col-span-4">
            <OtherGamesPanel games={data.other_games} />
          </div>
        )}
      </div>
    </div>
  )
}
```

### Pattern 2: Insight Rotation Hook

The rotation timer MUST be independent of the SWR refresh. Use a `useRef` for the current index to avoid stale closures. Reconcile insights on prop change by finishing the current cycle.

```typescript
// Source: CONTEXT.md locked decisions — rotation behavior spec
// hooks/useInsightRotation.ts
import { useState, useEffect, useRef } from 'react'

export function useInsightRotation<T>(items: T[], intervalMs = 8000) {
  const [activeIndex, setActiveIndex] = useState(0)
  const [visible, setVisible] = useState(true)
  const pendingItems = useRef<T[]>(items)

  // When items change from outside (SWR refresh), store the new set
  // but don't reset the timer — it will pick up on next rotation
  useEffect(() => {
    pendingItems.current = items
  }, [items])

  useEffect(() => {
    if (items.length <= 1) return // no rotation needed

    const id = setInterval(() => {
      // Fade out
      setVisible(false)
      setTimeout(() => {
        setActiveIndex((prev) => {
          const next = (prev + 1) % pendingItems.current.length
          return next
        })
        setVisible(true)
      }, 200) // matches transition-opacity duration-200
    }, intervalMs)

    return () => clearInterval(id)
  }, [intervalMs]) // intentionally NOT in items — rotation timer is independent

  const currentItems = pendingItems.current
  return { activeIndex, visible, currentItems }
}
```

### Pattern 3: BoxScoreModule (Two-Team Stacked Layout)

Calls `BoxScoreTable` twice — Clippers first — with a divider row between them:

```typescript
// Source: CONTEXT.md locked decision + BoxScoreTable.tsx props interface
// components/live/BoxScoreModule.tsx
const COLUMNS: BoxScoreColumn[] = [
  { key: 'name', label: 'Player', numeric: false, width: 'w-36' },
  { key: 'MIN', label: 'MIN', numeric: true, width: 'w-10' },
  { key: 'PTS', label: 'PTS', numeric: true, width: 'w-8' },
  { key: 'REB', label: 'REB', numeric: true, width: 'w-8' },
  { key: 'AST', label: 'AST', numeric: true, width: 'w-8' },
  { key: 'STL', label: 'STL', numeric: true, width: 'w-8' },
  { key: 'BLK', label: 'BLK', numeric: true, width: 'w-8' },
  { key: 'TO',  label: 'TO',  numeric: true, width: 'w-8' },
  { key: 'FG',  label: 'FG',  numeric: true, width: 'w-14' },
  { key: '3PT', label: '3PT', numeric: true, width: 'w-14' },
  { key: 'FT',  label: 'FT',  numeric: true, width: 'w-14' },
  { key: '+/-', label: '+/-', numeric: true, width: 'w-10' },
]
// Render: team header + BoxScoreTable for players + totals row + divider + repeat for opponent
```

### Pattern 4: Key Metrics Row Loading State

During initial load (`isLoading && !data`), render a row of `StatCardSkeleton` components matching the expected count:

```typescript
// components/live/KeyMetricsRow.tsx
// During load: render 4–5 StatCardSkeleton in a flex row (or grid-cols-4/5)
// When loaded: render StatCard for each metric in key_metrics[]
```

### Anti-Patterns to Avoid

- **Resetting the rotation timer on SWR refresh:** The 8s cycle must be timer-independent of data refresh. Putting `items` in the `useEffect` dependency array would restart the interval on every SWR tick. Use `useRef` to hold pending items.
- **Variable-height insight containers:** The insight tile area must have a fixed height. If the container height changes with content, the surrounding layout will shift on every rotation. Define the container height once in Tailwind (e.g., `h-[120px]`) and let content fill it.
- **`overflow-x-scroll` on the box score table:** The design system requires the table to compress before scrolling. Use `min-w-0` on columns, not a horizontal scroll container.
- **`opacity: 0` leaving element in DOM flow:** The fade transition uses Tailwind `opacity-0 transition-opacity duration-200`. The element stays in DOM (correct — avoids layout shift). Do NOT use `display: none` for the fade.
- **Hardcoded hex colors in JSX:** All colors via CSS variable tokens (`text-positive`, `text-negative`, `text-muted-foreground`). Never `text-[#34D399]`.
- **Using shadcn `Card` wrapper around StatCard:** Phase 10.1 established StatCard uses a plain `div` (not `Card`/`CardContent`). Same rule applies to all new surface components in Phase 11.
- **Showing the other-games panel with empty state:** Hide entirely when `other_games.length === 0`. No placeholder, no "no games" message.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Data fetching / polling | Custom fetch + setInterval | `useLiveData()` (SWR hook) | Already written, handles dedup, focus revalidation |
| Table rendering + sort | Custom table | `BoxScoreTable` | Already built with sticky header and sort |
| Stat display card | Custom stat tile | `StatCard` | Design-system-compliant, already styled |
| Stat card loading state | Custom skeleton | `StatCardSkeleton` | Exact dimensions match StatCard |
| Box score loading state | Custom skeleton | `BoxScoreSkeleton` | Matches BoxScoreTable structure |
| Stale data banner | Custom banner | `StaleBanner` | Already styled to spec, props-driven |
| Icon elements | SVG drawn by hand | `lucide-react` | Consistent, accessible, no emoji |
| CSS opacity transition | Framer Motion / JS | Tailwind `transition-opacity duration-200` | Zero dependency, GPU-accelerated |
| Number formatting | Custom formatter | `tabular-nums` class (global on body) | Already globally applied |

**Key insight:** Every building block exists. Phase 11 is composition and page assembly, not library or primitive creation.

---

## Common Pitfalls

### Pitfall 1: FT Edge Missing from key_metrics[]

**What goes wrong:** LIVE-05 specifies "FT edge" as a required key metric. The current `/api/live` `computeKeyMetrics()` function returns only 4 metrics: `efg_pct`, `tov_margin`, `reb_margin`, `pace`. FT edge (`lacStats.freeThrowsMade - oppStats.freeThrowsMade` or FT rate comparison) is not computed server-side.

**Why it happens:** The API was implemented before Phase 11 UI requirements were finalized.

**How to handle:** Two options:
1. Compute FT edge display-side from `box_score.teams[].totals.FT` strings (parse "made-attempted" fractions). This keeps the API unchanged.
2. Note the gap and treat the 4 computed metrics as satisfying LIVE-05 for MVP (FT edge is derivable).
**Recommendation:** Compute display-side from totals to satisfy the requirement without an API change. The planner should pick this up as a task.

**Warning signs:** If the key metrics row shows 4 cards when the spec says 5, LIVE-05 is not fully satisfied.

---

### Pitfall 2: Rotation Timer Restarting on Every SWR Refresh

**What goes wrong:** If `insights` is in the `useEffect` dependency array for the rotation `setInterval`, the timer resets to 0 every 12 seconds when SWR refreshes — effectively preventing rotation if SWR data changes frequently.

**Why it happens:** React's default exhaustive-deps linting suggests adding `items` to deps.

**How to avoid:** Use `useRef` to hold the current items. The `setInterval` callback reads from the ref (always current without re-running the effect). Only set the interval once. Disable the exhaustive-deps lint rule for that specific line with a comment.

**Warning signs:** Items never cycle, or rotation resets to tile 0 on every SWR refresh.

---

### Pitfall 3: Layout Shift on Data Update

**What goes wrong:** When SWR refreshes data, if a component conditionally shows/hides based on data (like key_metrics going from `[]` to populated), the layout jumps.

**Why it happens:** Initial data is `undefined` before first SWR resolve. If skeletons aren't shown during `isLoading && !data`, the layout collapses then expands.

**How to avoid:** Show skeleton placeholders (StatCardSkeleton row, BoxScoreSkeleton) when `!data`. Once `data` is available, keep consistent component height even if a metric value is `null` — use `'—'` as fallback.

**Warning signs:** Page jumps on first load or on every 12-second refresh.

---

### Pitfall 4: Tailwind v4 Arbitrary Class Gotchas

**What goes wrong:** Using `bg-[var(--surface)]` instead of `bg-surface`. In Tailwind v4 with `@theme inline`, the token IS mapped to a Tailwind utility — use the utility, not the arbitrary syntax.

**How to avoid:** Per MASTER.md: use `bg-surface`, `bg-surface-alt`, `text-positive`, `text-negative`, `text-muted-foreground` etc. Only use `bg-[var(--X)]` for tokens NOT mapped through `@theme inline`.

**Warning signs:** Colors appear wrong in dark mode, or linter flags unnecessary arbitrary syntax.

---

### Pitfall 5: Clock Display Format

**What goes wrong:** `game.clock` comes from the live snapshot as an ISO 8601 duration string (e.g., `"PT05M30.00S"`). Displaying it raw is incorrect.

**How to avoid:** The API layer's `parseMinutesToDisplay()` function already exists in `route.ts` (converts `"PT25M01.00S"` → `"25:01"`). However, `game.clock` is passed through directly to the response as-is from the snapshot. The scoreboard component needs a client-side format utility to convert this for display. A lightweight `formatClock(isoStr: string): string` utility should be co-located in `components/live/` or `lib/format.ts`.

**Warning signs:** Game clock shows raw `"PT05M30.00S"` instead of `"5:30"`.

---

### Pitfall 6: BoxScoreTable Sort Interaction

**What goes wrong:** `BoxScoreTable` has built-in sort state. If Phase 11 wraps it twice (LAC + OPP), each table instance has independent sort state — sorting one team's table does not affect the other. This is correct behavior but must be intentional.

**How to avoid:** Design the `BoxScoreModule` wrapper to pass the same `columns` array to both `BoxScoreTable` instances. Accept that each team's table sorts independently. Document this as intentional in the component.

---

## Code Examples

Verified patterns from reading existing source files:

### Consuming useLiveData

```typescript
// Source: hooks/useLiveData.ts + confirmed from SWR 2.x docs
const { data, error, isLoading } = useLiveData()
// data?.state: 'LIVE' | 'DATA_DELAYED' | 'NO_ACTIVE_GAME' | undefined
// data?.game: { period, clock, home: { abbreviation, score }, away: { abbreviation, score } }
// data?.key_metrics: Array<{ key, label, value, team, delta_vs_opp }>
// data?.box_score: { columns: string[], teams: [{ team_abbr, players, totals }] }
// data?.insights: Array<{ insight_id, category, headline, detail, importance, proof }>
// data?.other_games: [] (MVP) | populated array
// data?.meta: { generated_at, source, stale, stale_reason, ttl_seconds }
```

### StaleBanner Usage

```typescript
// Source: components/stale-banner/StaleBanner.tsx
<StaleBanner
  stale={data.meta.stale}
  generatedAt={data.meta.generated_at}
/>
// Component returns null when stale=false — safe to always mount
```

### StatCard for Key Metrics

```typescript
// Source: components/stat-card/StatCard.tsx
<StatCard
  label="eFG%"
  value={`${(metric.value * 100).toFixed(1)}%`}
  delta={metric.delta_vs_opp !== null ? `${metric.delta_vs_opp > 0 ? '+' : ''}${(metric.delta_vs_opp * 100).toFixed(1)}%` : undefined}
  positive={metric.delta_vs_opp !== null ? metric.delta_vs_opp > 0 : undefined}
  context="vs opp"
/>
```

### BoxScoreTable for Player Rows

```typescript
// Source: components/box-score/BoxScoreTable.tsx
// rows must have id field + column keys matching columns[].key
const rows: BoxScoreRow[] = team.players.map((p) => ({
  id: p.player_id,
  name: p.name,
  MIN: p.MIN,
  PTS: p.PTS,
  // ... all stat columns
}))
<BoxScoreTable columns={COLUMNS} rows={rows} maxHeight="max-h-[360px]" />
```

### Opacity Fade Transition

```typescript
// Source: CONTEXT.md + Tailwind v4 established patterns
// Fixed-height container, content fades in/out within it
<div className="h-[120px] relative">
  <div className={cn(
    'absolute inset-0 transition-opacity duration-200',
    visible ? 'opacity-100' : 'opacity-0'
  )}>
    {/* current insight tile content */}
  </div>
</div>
```

### formatClock Utility (to be created)

```typescript
// Needed by LiveScoreboard — pattern from parseMinutesToDisplay in route.ts
// Place in: lib/format.ts or components/live/utils.ts
export function formatClock(isoStr: string): string {
  const match = isoStr.match(/PT(?:(\d+)M)?(?:([\d.]+)S)?/)
  if (!match) return isoStr // fallback: show raw
  const mins = parseInt(match[1] ?? '0', 10)
  const secs = Math.floor(parseFloat(match[2] ?? '0'))
  return `${mins}:${String(secs).padStart(2, '0')}`
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| shadcn `Card` wrapper for surfaces | Plain `div` with token classes | Phase 10.1 | Precise control over borders/bg without CSS variable mapping conflicts |
| `border-slate-700` / `border-gray-600` | `border-white/[0.06]` hairline | Phase 10.1 | Premium floating appearance, consistent with dark-only design |
| Per-file color definitions | CSS variable tokens via `@theme inline` | Phase 10 | All colors from `bg-surface`, `text-positive` etc. — no hardcoded hex in JSX |
| Table inside shadcn `Table` wrapper | Raw `<table>` inside `overflow-y-auto div` | Phase 10 | Sticky `<thead>` works correctly — shadcn Table wrapper breaks sticky headers |
| `opacity` on CartesianGrid | `strokeOpacity` | Phase 10.1 | Targets only the line stroke, not the full SVG group |

---

## Open Questions

1. **FT Edge metric (LIVE-05)**
   - What we know: `key_metrics[]` from API has 4 items (efg_pct, tov_margin, reb_margin, pace). LIVE-05 requires FT edge.
   - What's unclear: Whether to compute client-side from `box_score.teams[].totals.FT` strings, or treat pace as satisfying the "5th" metric.
   - Recommendation: Planner should include a task to compute FT edge display-side. Parse `totals.FT` as `"made-attempted"` strings, compute `lacFTM - oppFTM` (or FTA rate difference). This is ~10 lines and keeps the API layer unchanged.

2. **"Next game" data in NO_ACTIVE_GAME state**
   - What we know: `/api/live` returns `game: null` and no schedule data when `state = "NO_ACTIVE_GAME"`. CONTEXT.md marks this as Claude's Discretion — either fetch from `/api/home` or embed in response.
   - Recommendation: Fetch from `/api/home` using a separate SWR call inside `NoGameIdleState` component. This avoids bloating the `/api/live` response shape and the home API already returns upcoming schedule. Alternatively, omit the next-game detail gracefully (CONTEXT.md allows this).

3. **Clock string format from API**
   - What we know: `game.clock` is passed from the snapshot directly. The API route does NOT convert it to display format — only `box_score` player rows convert `minutes` to display format.
   - What's unclear: Whether the raw clock value is always the ISO `"PTxxMxx.xxS"` format or can be `"MM:SS"` (provider-dependent).
   - Recommendation: Add a `formatClock` utility that handles both formats with graceful fallback.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npx vitest run src/lib/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LIVE-02 | Scoreboard renders score, period, clock from data | unit | `npx vitest run src/lib/` | ❌ Wave 0 |
| LIVE-03 | BoxScoreModule renders both teams' columns correctly | unit | `npx vitest run src/lib/` | ❌ Wave 0 |
| LIVE-04 | Player rows display with compact h-9 density | manual-only | visual inspection at dev server | N/A |
| LIVE-05 | Key metrics row shows 5 values including FT edge | unit | `npx vitest run src/lib/` | ❌ Wave 0 |
| LIVE-10 | Insight rotation cycles at 8s interval, fades correctly | unit | `npx vitest run src/lib/` | ❌ Wave 0 |
| LIVE-11 | Other games panel hides when array is empty | unit | `npx vitest run src/lib/` | ❌ Wave 0 |

> Note: Vitest config includes only `src/lib/**/*.test.ts` — no React component test infrastructure (no jsdom, no React Testing Library). UI component tests that need DOM rendering are out of scope for this Vitest setup. Logic-only units (formatClock, useInsightRotation pure logic, FT edge computation) CAN be tested with the existing setup.

### Sampling Rate

- **Per task commit:** `npx vitest run src/lib/`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/format.test.ts` — covers formatClock (LIVE-02 clock display)
- [ ] `src/lib/live-utils.test.ts` — covers FT edge computation (LIVE-05)
- [ ] `src/lib/use-insight-rotation.test.ts` — covers rotation logic (LIVE-10, if extracted to pure function)

*(React component rendering tests are out of scope — no jsdom in vitest config. Manual visual inspection covers LIVE-03, LIVE-04, LIVE-11 render behavior.)*

---

## Sources

### Primary (HIGH confidence)
- `/Users/luke/CCC/src/app/api/live/route.ts` — exact API response shape, all field names, types, and computation logic
- `/Users/luke/CCC/hooks/useLiveData.ts` — hook interface, polling config
- `/Users/luke/CCC/components/box-score/BoxScoreTable.tsx` — props interface, sort behavior
- `/Users/luke/CCC/components/stat-card/StatCard.tsx` — props interface, design tokens
- `/Users/luke/CCC/components/stale-banner/StaleBanner.tsx` — props interface, render behavior
- `/Users/luke/CCC/components/skeletons/` — all three skeleton components verified
- `/Users/luke/CCC/design-system/clippers-command-center/MASTER.md` — full design system
- `/Users/luke/CCC/design-system/clippers-command-center/pages/live.md` — live page overrides
- `/Users/luke/CCC/.planning/phases/11-live-game-dashboard/11-CONTEXT.md` — locked decisions

### Secondary (MEDIUM confidence)
- `package.json` — confirmed versions of Next.js 16.1.6, React 19.2.3, SWR 2.4.1, Tailwind v4, Vitest 4.0.18
- `vitest.config.ts` — test scope confirmed (no jsdom, no RTL)

### Tertiary (LOW confidence)
- None — all research based on direct code inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified from package.json and existing code
- Architecture: HIGH — all component interfaces read directly from source, all API fields verified from route.ts
- Pitfalls: HIGH — identified from direct code inspection (FT edge gap, clock format issue, rotation timer pattern)
- Test coverage: MEDIUM — Vitest scope is clear but component test feasibility is limited by missing jsdom

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable tech — design system and API shape unlikely to change before Phase 11 planning)
