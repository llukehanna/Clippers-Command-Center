# Phase 13: Player Trends Page - Research

**Researched:** 2026-03-07
**Domain:** Next.js App Router pages, React Server Components, Recharts, data derivation from game log
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Roster page (/players)**
- View toggle: Three view modes — list / cards / grid. Default on load: list.
- Player scope: Active roster (including injured players) + current-season LAC players who have since been traded.
- Traded player treatment: Inline in the roster list with a small "Traded" badge. No separate section.
- Stats shown in any view: Name, position, L10 PPG, L10 RPG, L10 APG.
- Data source: `/api/players?active_only=true` returns only currently active players — API or query needs adjustment to include current-season players no longer `is_active` but who played for LAC this season.

**Player detail page structure (top to bottom)**
1. Player header: Name + position + season PPG / RPG / APG
2. Rolling averages comparison table
3. Trend chart (metric selector + L5 + L10 lines)
4. Splits (home/away, wins/losses)
5. Game log table (full width, max-height ~400px, vertical scroll)

**Rolling averages comparison table**
- Layout: Compact table — rows = stats, columns = L5 / L10 / Season
- Stats (rows): PTS, REB, AST, TS%
- Color coding: L5 column values are color-coded relative to L10 — green (`text-positive`) when meaningfully above, red (`text-negative`) when meaningfully below. L10 and Season columns are plain.
- Data derivation: L5 and Season must be computed from `game_log` (last 5 rows for L5, all rows for Season). `/api/players/[id]` returns `trend_summary` for L10 only.

**Trend chart**
- Layout: Single full-width chart, metric selector above it (tabs or small button group).
- Metric options: PTS / REB / AST / TS% — user selects one at a time.
- Lines: Two lines on same chart — L5 rolling average and L10 rolling average for selected metric.
- Interactivity: Metric selector requires client-side state — this section must be a Client Component (chart area only).
- Default metric: PTS.
- Data source: `/api/players/[id]` returns `charts.rolling_pts` and `charts.rolling_ts` only. For REB and AST, planner must either extend the API response or compute rolling windows from `game_log` client-side.

**Splits display**
- Splits shown: Home / Away, Wins / Losses
- Stats per split: PTS avg, TS%
- Layout: Claude's discretion (stat cards or compact 2x2 comparison layout, visually lightweight)

**Game log table**
- Component: Reuse `BoxScoreTable` — existing component, sticky header, sortable columns, right-aligned numbers.
- Width: Full page width (12 columns).
- Height: Fixed max-height (~400px) with vertical scroll — use `maxHeight` prop.
- Columns: Date, Opp, H/A, MIN, PTS, REB, AST, FG, 3PT, FT, +/-
- Row count: Last 25 games (API limit).

### Claude's Discretion
- Exact splits component layout (stat cards vs. comparison grid)
- Threshold for "meaningful" L5 vs L10 divergence (e.g., >10% difference triggers color)
- Chart height and exact tick label formatting for dates
- Skeleton shapes for each section
- Whether view-toggle preference on /players is persisted (localStorage) or resets on navigation
- Exact badge styling for "Traded" label

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| PLAYER-01 | User can select a Clippers player and view their performance trends | Roster page `/players` with view toggle; player links to `/players/[player_id]` dynamic route |
| PLAYER-02 | Player page shows rolling averages (last 5, last 10 games) | L10 from `trend_summary`; L5 computed client-side from last 5 `game_log` rows |
| PLAYER-03 | Player page shows season averages | Computed from all `game_log` rows in API response |
| PLAYER-04 | Player page shows trend charts (rolling scoring, secondary metric) | `LineChartWrapper` with two series (L5, L10); `rolling_player_stats` table has all metrics needed |
| PLAYER-05 | Player page shows game log table with standard box score columns | Reuse `BoxScoreTable` with `maxHeight="max-h-[400px]"` and mapped game_log data |
| PLAYER-06 | Player page shows splits (home/away, wins/losses) | API already computes splits in `computeSplits()` — data is in `splits` field of API response |
</phase_requirements>

---

## Summary

Phase 13 builds two new Next.js pages on top of a complete, working API layer. The `/api/players` and `/api/players/[player_id]` routes already exist and return the data needed for all six PLAYER requirements. The primary build work is UI: a roster picker page with three view modes, and a player detail page with five distinct sections.

The key technical challenge is data derivation on the UI side. The API returns L10 trend data in `trend_summary` and raw `game_log` rows (up to 25). L5 averages and Season averages must be computed from `game_log` in the component, not from a dedicated API field. The trend chart needs L5 and L10 rolling series for all four metrics (PTS, REB, AST, TS%) — but the API only pre-builds rolling series for PTS and TS%. For REB and AST, rolling windows must be computed client-side from `game_log` data or the API must be extended.

The Server Component / Client Component split is well-understood: the page shell fetches data server-side, passes it as props, and only the `TrendChartSection` (metric selector + chart) is a Client Component because it needs `useState` for the active metric.

**Primary recommendation:** Extend `/api/players/[player_id]` to return `rolling_reb` and `rolling_ast` series (same pattern as `rolling_pts`) so the Client Component receives all chart data as props rather than computing rolling windows in the browser. This is simpler, consistent with the existing `charts` object shape, and avoids client-side math over sparse data.

---

## Standard Stack

### Core (all already installed)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | Installed | Page routing, RSC data fetching | Project decision — all pages use App Router |
| React Server Components | Built-in | Server-side data fetch, no JS bundle cost | Established pattern in Phases 11 and 12 |
| Recharts (`LineChartWrapper`) | Installed | Trend charts — L5 + L10 lines | Already wraps Recharts; project standard |
| `BoxScoreTable` | Local component | Game log table — sticky header, sortable | Established reusable component |
| `StatCard` | Local component | Splits display, header stats | Established, available |
| Tailwind CSS | Installed | Layout and tokens | Project standard |
| Vitest | Installed | Tests for derivation utilities | Project test runner |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `StatCardSkeleton`, `BoxScoreSkeleton`, `ChartSkeleton` | Local | Loading states per section | Use in Suspense boundaries or conditional render |
| `next/link` | Built-in | Player links in roster | Used in Phase 12 `PlayerTrendsTable` already |

### No New Dependencies

This phase requires zero new npm packages. All UI primitives and chart wrappers already exist.

---

## Architecture Patterns

### Recommended File Structure

```
app/players/
├── page.tsx                          # Roster page — Server Component
├── [player_id]/
│   └── page.tsx                      # Player detail — Server Component (shell)

components/players/
├── RosterViewToggle.tsx              # 'use client' — list/cards/grid state
├── RosterList.tsx                    # Server or client — renders rows
├── RosterCards.tsx                   # Renders card grid
├── PlayerHeader.tsx                  # Season stats header — Server
├── RollingAveragesTable.tsx          # Computed L5/L10/Season table — Server
├── TrendChartSection.tsx             # 'use client' — metric selector + LineChartWrapper
├── SplitsDisplay.tsx                 # Splits 2x2 — Server or client
└── GameLogSection.tsx                # BoxScoreTable wrapper — Server (passes props)
```

### Pattern 1: Server Component Shell with Isolated Client Island

The player detail page (`app/players/[player_id]/page.tsx`) is an `async` Server Component that fetches from `/api/players/[id]` once. It passes the full response as props to child components. Only `TrendChartSection` carries `'use client'` — it receives pre-fetched chart data as props and manages only the `activeMetric` state locally.

```typescript
// app/players/[player_id]/page.tsx
// Source: Established Phase 12 pattern (app/home/page.tsx)
export default async function PlayerDetailPage({
  params,
}: {
  params: Promise<{ player_id: string }>
}) {
  const { player_id } = await params
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/players/${player_id}`, { cache: 'no-store' })
  if (!res.ok) notFound()
  const data = await res.json()

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      <PlayerHeader player={data.player} trendSummary={data.trend_summary} gameLog={data.game_log} />
      <RollingAveragesTable trendSummary={data.trend_summary} gameLog={data.game_log} />
      <TrendChartSection charts={data.charts} />   {/* 'use client' */}
      <SplitsDisplay splits={data.splits} />
      <GameLogSection gameLog={data.game_log} />
    </div>
  )
}
```

### Pattern 2: L5 and Season Average Derivation from game_log

The API returns `game_log` (up to 25 rows, descending date). L5 and Season averages are computed deterministically from this array. Since game_log is limited to 25 rows, "Season" here means "season so far in the returned window" — a documented constraint.

```typescript
// Derivation utility — testable pure function
// Source: Phase 13 design decision documented in CONTEXT.md
function deriveAverages(gameLog: GameLogRow[]) {
  function avg(rows: GameLogRow[], key: keyof GameLogRow): number | null {
    const nums = rows.map(r => r[key]).filter((v): v is number => typeof v === 'number')
    if (nums.length === 0) return null
    return nums.reduce((a, b) => a + b, 0) / nums.length
  }

  function avgTs(rows: GameLogRow[]): number | null {
    // TS% = PTS / (2 * TSA), TSA = FGA + 0.44*FTA
    // game_log provides string FG "7-14" and FT "4-5" — need raw fg_attempted/ft_attempted
    // NOTE: game_log from API pre-formats shooting as "M-A" strings.
    // Must parse or restructure. See Pitfall 2 below.
    ...
  }

  const last5 = gameLog.slice(0, 5)   // already DESC — most recent first
  return {
    l5: { pts: avg(last5, 'PTS'), reb: avg(last5, 'REB'), ast: avg(last5, 'AST'), ts: avgTs(last5) },
    season: { pts: avg(gameLog, 'PTS'), reb: avg(gameLog, 'REB'), ast: avg(gameLog, 'AST'), ts: avgTs(gameLog) },
  }
}
```

### Pattern 3: Roster Page View Toggle

The roster page shell is a Server Component that fetches `/api/players`. The view toggle state is managed by a Client Component wrapper.

```typescript
// components/players/RosterViewToggle.tsx
'use client'
// Receives players prop from server; manages viewMode state
type ViewMode = 'list' | 'cards' | 'grid'
// Renders different layout based on viewMode
// viewMode defaults to 'list' on load (no persistence required unless planner chooses localStorage)
```

### Pattern 4: Metric Selector in TrendChartSection

```typescript
// components/players/TrendChartSection.tsx
'use client'
// activeMetric: 'PTS' | 'REB' | 'AST' | 'TS%'
// Receives charts prop: { rolling_pts, rolling_ts, rolling_reb, rolling_ast }
// Each rolling series is { game_date, value }[]
// Formats as LineChartWrapper data with keys 'l5' and 'l10'
// series: [{ key: 'l5', color: 'var(--chart-1)', label: 'L5' }, { key: 'l10', color: 'var(--chart-2)', label: 'L10' }]
```

### Pattern 5: API Extension for REB and AST Rolling Series

The `/api/players/[player_id]/route.ts` already fetches `chartRows` — all `rolling_player_stats` rows for the player in ascending date order. It already has `rebounds` and `assists` columns in the query. The `charts` object only maps `rolling_pts` and `rolling_ts`. The fix is a two-line addition:

```typescript
// In app/api/players/[player_id]/route.ts — existing charts object
// Source: Confirmed by reading route.ts
const charts = {
  rolling_pts: chartRows.map(r => ({ game_date: r.as_of_game_date, value: r.points })),
  rolling_ts:  chartRows.map(r => ({ game_date: r.as_of_game_date, value: r.ts_pct })),
  // ADD:
  rolling_reb: chartRows.map(r => ({ game_date: r.as_of_game_date, value: r.rebounds })),
  rolling_ast: chartRows.map(r => ({ game_date: r.as_of_game_date, value: r.assists })),
}
```

This is a no-new-query extension — the data is already fetched. No DB change needed.

### Pattern 6: `/api/players` Query Extension for Traded Players

The current route returns only `is_active = true` players when `active_only=true` (default). Traded players need an additional filter: LAC stint in the current season AND `is_active = false`. The query needs a new mode or the default behavior must change.

**Recommended approach:** Add a `current_season_only` branch that returns all players with a LAC stint `start_date` in the current NBA season window (approximately October to June), regardless of `is_active`. This replaces the `active_only` branch for the roster page call.

The roster page should call `/api/players?include_traded=true` (or similar) and the API should return an `is_traded` boolean derived from `is_active = false AND has_lac_stint_this_season`.

```sql
-- Conceptual query for roster including traded players
SELECT DISTINCT
  p.player_id::text,
  p.display_name,
  p.position,
  p.is_active,
  NOT p.is_active AS is_traded   -- traded = was LAC but no longer active
FROM players p
WHERE EXISTS (
  SELECT 1 FROM player_team_stints pts
  JOIN teams t ON pts.team_id = t.team_id
  WHERE pts.player_id = p.player_id
    AND t.nba_team_id = ${LAC_NBA_TEAM_ID}
    AND pts.start_date >= '2024-10-01'  -- current season start
)
ORDER BY p.display_name ASC
```

### Anti-Patterns to Avoid

- **Fetching data inside Client Components:** `TrendChartSection` and `RosterViewToggle` receive props from the Server Component parent. Never call `fetch()` inside them.
- **Separate Suspense per section causing layout shift:** Wrap the full detail page data fetch in one server-level await. Individual skeleton states should only appear if the page uses streaming (not the current pattern).
- **Computing rolling windows in the Client Component from raw game_log strings:** The game log formats shooting as `"7-14"` strings. Computing TS% requires parsing. Either extend the API to return raw shooting numbers alongside the formatted strings, or accept that chart TS% comes from `rolling_ts` (pre-computed in DB) rather than from game_log.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Sortable table with sticky header | Custom table component | `BoxScoreTable` | Already handles sort state, sticky thead, right-align, tabular-nums — 36px row height pre-set |
| Multi-series line chart | Raw Recharts setup | `LineChartWrapper` | Color defaults via CHART_COLORS, CustomTooltip, proper margins already set |
| Stat display cards | Custom div layout | `StatCard` | Has `label`, `value`, `delta`, `positive` props — matches splits display need exactly |
| Loading skeletons | Custom shimmer divs | `StatCardSkeleton`, `ChartSkeleton`, `BoxScoreSkeleton` | All three exist in `components/skeletons/`, match surface/border tokens |
| Rolling average math | Client-side imperative loop | Derivation utility function (pure, testable) | Must be testable in Vitest; extract to `src/lib/player-utils.ts` |
| Color-coding logic | Inline conditional class | Utility: `isSignificantlyHigher(l5, l10, threshold=0.1)` | Encapsulates >10% threshold, handles null safely, unit-testable |

**Key insight:** Every non-trivial piece of logic (derivation, color threshold, rolling window computation) should be extracted as a pure function in `src/lib/player-utils.ts` for Vitest coverage. The UI components should receive pre-derived values, not perform calculations themselves.

---

## Common Pitfalls

### Pitfall 1: game_log Row Count is Not Full Season

**What goes wrong:** Computing "Season" averages from `game_log` returns only the last 25 games, not the full season. If a player has played 60 games, the "Season" average is actually last-25 average.

**Why it happens:** `/api/players/[player_id]` limits game log to 25 rows (explicit LIMIT 25 in SQL).

**How to avoid:** Either extend the API to return all season box scores for stat derivation (separate from game log display), or label the average "Last 25" in the UI rather than "Season." The CONTEXT.md says "Season" — planner should clarify or extend the API to fetch all season box scores for stat purposes only.

**Warning signs:** "Season" PPG differs significantly from published stats for high-minute players.

### Pitfall 2: TS% Computation Requires Raw Shooting Stats — game_log Formats as Strings

**What goes wrong:** The game log API response formats `FG`, `3PT`, `FT` as strings like `"7-14"`, `"3-6"`, `"4-5"`. Computing TS% requires `fg_attempted` and `ft_attempted` as integers. String parsing introduces edge cases (DNP entries, empty strings).

**Why it happens:** The API route builds `FG: \`${r.fg_made ?? 0}-${r.fg_attempted ?? 0}\`` — it pre-formats for display, not for computation.

**How to avoid:** The API route has the raw `fg_attempted` and `ft_attempted` values before formatting. Either:
- Add raw fields (`fg_attempted_raw`, `ft_attempted_raw`) alongside the formatted display strings, OR
- Compute L5/Season TS% server-side and add to the trend_summary/L5 derived data returned by the API.

The `computeTs()` helper already exists in the route file — it operates on raw `BoxScoreRow` before formatting. Leverage it server-side.

### Pitfall 3: Rolling Series Window Mismatch (L5 vs L10)

**What goes wrong:** `rolling_player_stats` in the DB stores one row per (player, window_games, as_of_game_date). The `chartRows` query fetches ALL windows for the player. If not filtered, L5 and L10 data points are interleaved in a single flat array.

**Why it happens:** The current API query fetches rows without a `window_games` filter for `chartRows` (used for charts). It returns both L5 rows and L10 rows in one array.

**How to avoid:** When building `rolling_reb` and `rolling_ast` series, filter `chartRows` by `window_games`:

```typescript
const l5rows = chartRows.filter(r => r.window_games === 5)
const l10rows = chartRows.filter(r => r.window_games === 10)
```

Then merge by `game_date` for the chart `data` array. Each data point should have `{ date, l5, l10 }`.

**Warning signs:** Chart shows twice as many data points as expected; L5 and L10 lines appear identical.

### Pitfall 4: Dynamic Route Segment Must Match API's numeric player_id

**What goes wrong:** `app/players/[player_id]/page.tsx` receives `player_id` as a string. The API validates `/^\d+$/` — non-numeric IDs return 404. Phase 12's `PlayerTrendsTable` links to `/players/${p.player_id}` where `p.player_id` is a number — this is fine. But if any code constructs the link differently, the page will 404.

**How to avoid:** Keep player_id as a pure numeric string throughout. The dynamic segment name `[player_id]` matches the API param name — consistent.

### Pitfall 5: BoxScoreTable Requires `id` Field on Each Row

**What goes wrong:** `BoxScoreRow` interface in `BoxScoreTable` requires `id: string` for React `key`. The game_log from the API has `game_id` as the identifier. Mapping game_log rows must include `id: row.game_id`.

**Why it happens:** The `BoxScoreRow` type is `{ id: string; [key: string]: ... }` — the `id` key is mandatory and used as the React key in `sortedRows.map(row => <tr key={row.id}>)`.

**How to avoid:** Always include `id: row.game_id` when mapping game_log to `BoxScoreRow[]`.

### Pitfall 6: Traded Player Query — Defining "Current Season"

**What goes wrong:** The definition of "current season" for the traded player filter is ambiguous in the DB — there's no season column in `player_team_stints`. Using a hardcoded date like `2024-10-01` will become stale next season.

**How to avoid:** Derive season start from current date using the existing season logic (month < 6 → prior year, else current year), same pattern used in `sync-schedule.ts`. Generate the season start date dynamically at query time.

---

## Code Examples

Verified patterns from existing codebase:

### BoxScoreTable usage for game log

```typescript
// Source: Confirmed by reading components/box-score/BoxScoreTable.tsx
const GAME_LOG_COLUMNS: BoxScoreColumn[] = [
  { key: 'date', label: 'Date' },
  { key: 'opp', label: 'Opp' },
  { key: 'ha', label: 'H/A' },
  { key: 'MIN', label: 'MIN', numeric: true },
  { key: 'PTS', label: 'PTS', numeric: true },
  { key: 'REB', label: 'REB', numeric: true },
  { key: 'AST', label: 'AST', numeric: true },
  { key: 'FG', label: 'FG' },
  { key: '3PT', label: '3PT' },
  { key: 'FT', label: 'FT' },
  { key: '+/-', label: '+/-', numeric: true },
]

const rows: BoxScoreRow[] = gameLog.map(r => ({
  id: r.game_id,
  date: r.game_date,
  opp: r.opp,
  ha: r.home_away === 'home' ? 'H' : 'A',
  MIN: r.MIN,
  PTS: r.PTS,
  REB: r.REB,
  AST: r.AST,
  FG: r.FG,
  '3PT': r['3PT'],
  FT: r.FT,
  '+/-': r['+/-'],
}))

<BoxScoreTable columns={GAME_LOG_COLUMNS} rows={rows} maxHeight="max-h-[400px]" className="w-full" />
```

### LineChartWrapper for trend chart (two series)

```typescript
// Source: Confirmed by reading components/charts/LineChartWrapper.tsx
// Chart data: merge L5 and L10 series by game_date
const chartData = mergeSeries(charts.rolling_pts, 'l5', charts.rolling_pts_l10, 'l10')
// Each point: { date: '2025-01-15', l5: 24.2, l10: 22.1 }

<LineChartWrapper
  data={chartData}
  series={[
    { key: 'l5', color: 'var(--chart-1)', label: 'L5' },
    { key: 'l10', color: 'var(--chart-2)', label: 'L10' },
  ]}
  xKey="date"
  height={220}
/>
```

### Color-coding L5 vs L10 threshold

```typescript
// Source: Phase 13 design decision — >10% threshold
// Extract to src/lib/player-utils.ts for testability
export function l5ColorClass(l5: number | null, l10: number | null): string {
  if (l5 === null || l10 === null || l10 === 0) return ''
  const pct = (l5 - l10) / Math.abs(l10)
  if (pct > 0.1) return 'text-positive'
  if (pct < -0.1) return 'text-negative'
  return ''
}
```

### Roster page Server Component fetch pattern

```typescript
// Source: Established pattern from app/home/page.tsx
// app/players/page.tsx
export default async function PlayersPage() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/players?include_traded=true`, { cache: 'no-store' })
  const data = res.ok ? await res.json() : { players: [] }

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto">
      <RosterViewToggle players={data.players} />  {/* 'use client' for toggle state */}
    </div>
  )
}
```

### StatCard for splits (Claude's discretion — compact 2x2 grid)

```typescript
// Source: Confirmed by reading components/stat-card/StatCard.tsx
// 2x2 grid: [Home PTS, Away PTS] / [Win PTS, Loss PTS]
// Each StatCard shows pts_avg as value, ts_pct as context
<div className="grid grid-cols-2 gap-3">
  <StatCard label="Home" value={fmt(splits.home.pts_avg)} context={fmtTs(splits.home.ts_pct)} />
  <StatCard label="Away" value={fmt(splits.away.pts_avg)} context={fmtTs(splits.away.ts_pct)} />
  <StatCard label="Wins" value={fmt(splits.wins.pts_avg)} context={fmtTs(splits.wins.ts_pct)} />
  <StatCard label="Losses" value={fmt(splits.losses.pts_avg)} context={fmtTs(splits.losses.ts_pct)} />
</div>
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `shadcn Card` for stat display | Plain `div` with direct token classes | Phase 10.1 | Avoids CSS variable mapping conflicts; direct control |
| `overflow-auto` on shadcn Table wrapper | Custom `<table>` inside `overflow-y-auto div` | Phase 10 | Enables sticky `thead` to work correctly |
| Generic Recharts setup | `LineChartWrapper` abstraction | Phase 10 | Consistent margins, tooltip, CHART_COLORS defaults |

**Key established patterns in this codebase:**
- `@/src/lib/` import alias (not `@/lib/`) for `src/lib/` files — confirmed in Phase 12 decision log
- `'use client'` bubbles through import chain — isolate Client Components to the smallest possible scope
- `tabular-nums` is global on `body` — no need to add per cell, but `tabular-nums` class in JSX is used as explicit reinforcement where stat values appear
- `border-white/[0.06]` not `border-border` for hairline borders on dark surfaces

---

## Open Questions

1. **"Season" averages from 25-row game log**
   - What we know: API limits game log to 25 rows. CONTEXT.md calls for "Season averages."
   - What's unclear: Should "Season" mean last 25 or the true season? For star players with 50+ games this is materially different.
   - Recommendation: Extend the API to return a separate `season_averages` object computed server-side from all season box scores. This is a minor SQL addition to the existing parallel queries in the route.

2. **TS% for L5/Season rolling table**
   - What we know: game_log formats shooting as strings. TS% computation needs raw integers. The API's `computeTs()` already handles this before formatting.
   - What's unclear: Best place to surface per-game TS% values — add raw fields to game_log or compute season/L5 TS% server-side.
   - Recommendation: Add `ts_pct_computed` per row to game_log in the API (it's already computed in `boxScoreRowsWithTs` — just expose it) and compute L5/Season from that.

3. **Traded player season boundary**
   - What we know: No explicit season column in `player_team_stints`. `start_date` is available.
   - What's unclear: The exact date boundary for "current season" is a judgment call.
   - Recommendation: Use the same month-based season year formula from `sync-schedule.ts`: current month < 6 → season start is October of prior year; else October of current year. Compute this in the route handler at request time.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (confirmed in Phase 06, vitest.config.ts) |
| Config file | `vitest.config.ts` — includes `src/lib/**/*.test.ts` |
| Quick run command | `npx vitest run src/lib/player-utils.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAYER-01 | Roster page renders player list with links | smoke/manual | Visual inspection | N/A |
| PLAYER-02 | L5 and L10 rolling averages compute correctly | unit | `npx vitest run src/lib/player-utils.test.ts` | ❌ Wave 0 |
| PLAYER-03 | Season averages compute correctly from game log | unit | `npx vitest run src/lib/player-utils.test.ts` | ❌ Wave 0 |
| PLAYER-04 | Chart data merges L5+L10 series correctly by date | unit | `npx vitest run src/lib/player-utils.test.ts` | ❌ Wave 0 |
| PLAYER-05 | BoxScoreTable receives correct column/row shape | unit | `npx vitest run src/lib/player-utils.test.ts` | ❌ Wave 0 |
| PLAYER-06 | Splits data passes through from API response | unit/manual | API response check + visual | N/A |

### Sampling Rate

- **Per task commit:** `npx vitest run src/lib/player-utils.test.ts`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/player-utils.test.ts` — covers PLAYER-02, PLAYER-03, PLAYER-04 (derivation functions: `deriveAverages`, `l5ColorClass`, `mergeChartSeries`)
- [ ] `src/lib/player-utils.ts` — pure utility file with all derivation logic

*(No new framework install needed — Vitest is already configured and covering `src/lib/**/*.test.ts`)*

---

## Sources

### Primary (HIGH confidence)

- Direct read of `app/api/players/route.ts` — confirmed query structure, `is_active` filter, `player_team_stints` join pattern
- Direct read of `app/api/players/[player_id]/route.ts` — confirmed full API response shape: `trend_summary` (L10 only), `charts` (rolling_pts + rolling_ts only), `splits`, `game_log` (25 rows, formatted shooting strings)
- Direct read of `components/charts/LineChartWrapper.tsx` — confirmed props: `data`, `series[]`, `xKey`, `height`; `ChartSeries` interface; CHART_COLORS fallback
- Direct read of `components/box-score/BoxScoreTable.tsx` — confirmed `BoxScoreRow.id` requirement, `maxHeight` prop, `BoxScoreColumn.numeric` for right-align
- Direct read of `components/stat-card/StatCard.tsx` — confirmed `label`, `value`, `delta`, `context`, `positive` props
- Direct read of `components/skeletons/` — confirmed all three skeletons exist: `StatCardSkeleton`, `ChartSkeleton`, `BoxScoreSkeleton`
- Direct read of `app/globals.css` — confirmed all color tokens: `--positive`, `--negative`, `--chart-1` through `--chart-4`, `--surface`, `--surface-alt`
- Direct read of `.planning/STATE.md` — confirmed import alias `@/src/lib/` decision (Phase 12), `ScheduleTable` is `'use client'` pattern, all Phase 12 decisions
- Direct read of `design-system/clippers-command-center/MASTER.md` — confirmed typography scale, spacing, color tokens

### Secondary (MEDIUM confidence)

- `app/home/page.tsx` — RSC fetch + child component prop pattern; `app/players/page.tsx` is a stub to replace entirely
- `components/home/PlayerTrendsTable.tsx` — confirmed link pattern `/players/${p.player_id}` using numeric player_id

### Tertiary (LOW confidence)

- None — all findings verified directly from codebase

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries confirmed installed and in use
- Architecture: HIGH — RSC + Client Component island pattern directly mirrors Phase 11 and 12 implementations in codebase
- API data shape: HIGH — read actual route.ts files; no assumptions
- Pitfalls: HIGH — identified from direct code reading (game_log formatting, BoxScoreRow.id requirement, chartRows window mixing)
- Derivation math: HIGH — computeTs() already exists in route.ts; rolling window logic straightforward

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable stack, no fast-moving dependencies)
