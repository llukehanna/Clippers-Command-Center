# Phase 12: Between-Games Dashboard - Research

**Researched:** 2026-03-07
**Domain:** Next.js App Router — React Server Component, data assembly from `/api/home`, Tailwind v4 token system, Recharts BarChart, shadcn/ui primitives
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Page structure (top to bottom)**
1. Team Snapshot — stat cards row
2. Next Game card (prominent hero) + Schedule table (next 4 remaining games)
3. Player Trends table
4. Team Insights tile (rotating)
5. Last-10 Point Differential bar chart

All sections are full-width (12 columns). No 8/4 sidebar split.

**Team Snapshot section**
- Stat cards row: Record, Last 10 record, Net Rating, Off Rating, Def Rating
- Conference seed: omit (returns null from API — do not fabricate or show "—")
- Use existing StatCard component

**Next game hero card**
- Shows: opponent, date/time, home/away indicator
- Odds (spread, moneyline, over/under) when available — hidden entirely when not available
- No context note / insight attached to the next game card for MVP

**Schedule table (remaining 4 games after next)**
- Show next 5 total upcoming games (1 as hero card + 4 in table)
- Table columns: Opponent, Date, Time, Home/Away, Spread, ML, O/U
- Odds columns: render only when at least one game has odds data; show "—" for individual missing values within a table that has some odds
- If no games have odds at all, omit the three odds columns entirely

**Player trends table**
- Uses compact table/list layout (BoxScoreTable styling)
- Top 8 players by recent minutes (matches `/api/home` return)
- Columns: Name, PPG, RPG, APG, TS%, L5 delta (PPG vs season avg)
- L5 delta: color-coded with sign — positive in text-positive (emerald) with "+" prefix, negative in text-negative (red) with "−" prefix
- Each row is a link to `/players/{player_id}` (Phase 13 page stubs gracefully)
- When box score data is sparse, fewer rows render naturally (do not pad)

**Team insights**
- Reuse InsightTileArea component from Phase 11
- Override height: increase from 144px to ~200px to allow more detail text breathing room
- Feed with scope=team insights from `/api/insights?scope=team&is_active=true`
- 8s auto-rotation, fade transition, dot indicators — all inherited from the component
- If no team insights exist: hide section entirely (InsightTileArea returns null when empty)

**Last-10 point differential chart**
- Uses existing BarChartWrapper
- Data: last 10 LAC games, x-axis = opponent/date, y-axis = point margin (positive = win, negative = loss)
- Bars colored: text-positive for wins, text-negative for losses (use chart-1/chart-4 tokens)
- Section appears at bottom of page, full width

### Claude's Discretion
- Exact StatCard arrangement and grid columns for the team snapshot row
- Formatting for the next game date/time (e.g., "Fri Mar 14 · 7:30 PM PT")
- Whether the next game hero uses a distinct surface treatment (border, bg-surface-alt) or just spacing
- BarChart axis label formatting for short opponent abbreviations
- Skeleton loading shape for each section (use existing skeleton patterns)
- Exact column widths in the player trends table

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HOME-01 | Default dashboard displays when no Clippers game is active | `app/home/page.tsx` is a stub — replace entirely with a Server Component that fetches `/api/home` and renders all sections |
| HOME-02 | Dashboard shows recent team performance trends | `team_snapshot` field in `/api/home` response contains Record, Last 10, Net/Off/Def Rating — map to StatCard row; `last_10_games` array drives the BarChart |
| HOME-03 | Dashboard shows upcoming Clippers schedule | `upcoming_schedule[]` from `/api/home` contains opponent_abbr, game_date, start_time_utc, home_away, odds — drives next-game hero + schedule table |
| HOME-04 | Dashboard shows player trend summaries for top Clippers players | `player_trends[]` from `/api/home` contains player_id, name, pts_avg, reb_avg, ast_avg, window_games (top 8 by minutes) — drives PlayerTrendsTable; note ts_pct is always null from API |
| HOME-05 | Dashboard shows rotating insights about team performance | `InsightTileArea` from Phase 11 reused; feed from `/api/insights?scope=team&is_active=true` as a separate fetch; height override via className prop |
| HOME-06 | Dashboard shows Vegas odds for upcoming games when available | `odds` field per schedule entry from `/api/home`: `{ spread, moneyline, over_under }` or `null`; hide odds columns when all null, show "—" for individual nulls within a table that has some |
| SCHED-01 | Schedule page shows upcoming Clippers games | Satisfied by schedule section within home dashboard — up to 5 upcoming games shown |
| SCHED-02 | Schedule rows include opponent, date, time, and home/away | All four fields present in `upcoming_schedule[]` entries from `/api/home` |
</phase_requirements>

---

## Summary

Phase 12 is a pure UI assembly phase. The API layer (`/api/home`) is fully implemented and returns all necessary data in a single response: `team_snapshot`, `next_game`, `upcoming_schedule`, `player_trends`, and `insights`. No new backend work is required. The reusable component library (StatCard, BoxScoreTable, BarChartWrapper, InsightTileArea, all skeletons) is complete from Phases 10, 10.1, and 11.

The page is a React Server Component — fetch `/api/home` server-side, pass data as props to sub-components. There is no polling or client-side state at the page level. The only client component needed is `InsightTileArea` (already a 'use client' component from Phase 11) and any interactive table features from `BoxScoreTable` (also 'use client'). The `app/home/page.tsx` stub is replaced entirely.

One data gap exists: the `player_trends` API response includes `ts_pct: null` for all players (documented in Phase 9 decisions — not stored in `game_player_box_scores`). The CONTEXT.md decision is to display it honestly as "—". Also, `l5_delta` (PPG vs season avg) is not directly provided by the API — it requires client-side computation from `pts_avg` and a season average, but since the API only returns the last-10 window average, there is no season average available. See Open Questions.

The Last-10 point differential chart requires per-game margin data (not per-player stats). The `/api/home` response returns `team_snapshot.last_10` as aggregate W/L counts, not per-game scores. The chart data must be computed from `last10_games` — but the current API does NOT return per-game margin data. See Open Questions for the resolution path.

**Primary recommendation:** Implement in two plans — (1) Page shell + Team Snapshot + Next Game hero + Schedule table, (2) Player Trends table + Team Insights tile + Last-10 bar chart. This mirrors how Phase 11 was split and keeps each plan to ~3 files.

---

## Standard Stack

### Core (all already installed — no new packages)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | 16.1.6 | `app/home/page.tsx` is a React Server Component | Already in use |
| React | 19.2.3 | Component model — Server and Client components | Already in use |
| Tailwind CSS | v4 | Token-based styling — all design tokens defined | Already in use |
| shadcn/ui | 3.8.5 | Skeleton primitive (used by all skeleton components) | Already in use |
| Recharts | 3.7.0 | BarChartWrapper uses BarChart, Bar, XAxis, YAxis | Already in use via BarChartWrapper |
| lucide-react | 0.577.0 | Icons — home/away indicator, etc. | Already in use |

### No New Dependencies

All required functionality is available from existing packages. No animation library is needed — InsightTileArea already handles rotation with Tailwind `transition-opacity` and `useInsightRotation` hook.

**Installation:**
```bash
# No installation needed — all packages already in package.json
```

---

## Architecture Patterns

### Recommended File Structure

```
app/home/
└── page.tsx                           # Replace stub — RSC fetches /api/home, renders sections

components/home/
├── TeamSnapshot.tsx                   # 5-card stat row (Record, L10, Net/Off/Def Rating)
├── NextGameHero.tsx                   # Prominent next-game card with odds
├── ScheduleTable.tsx                  # Next 4 games table (BoxScoreTable styling, conditional odds cols)
├── PlayerTrendsTable.tsx              # Player table with links — wraps BoxScoreTable (client)
├── PointDiffChart.tsx                 # Last-10 bar chart wrapper (client, uses BarChartWrapper)
└── HomePageSkeleton.tsx               # Combined skeleton for initial RSC fallback (if needed)
```

### Pattern 1: React Server Component Page Shell

`app/home/page.tsx` fetches once server-side. No `useSWR`, no `'use client'` directive at page level. Errors render a graceful fallback.

```typescript
// Source: CONTEXT.md locked decision + /api/home route.ts shape
// app/home/page.tsx
import { TeamSnapshot } from '@/components/home/TeamSnapshot'
import { NextGameHero } from '@/components/home/NextGameHero'
import { ScheduleTable } from '@/components/home/ScheduleTable'
import { PlayerTrendsTable } from '@/components/home/PlayerTrendsTable'
import { InsightTileArea } from '@/components/live/InsightTileArea'
import { PointDiffChart } from '@/components/home/PointDiffChart'

async function getHomeData() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/home`, { cache: 'no-store' })
  if (!res.ok) return null
  return res.json()
}

async function getTeamInsights() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'
  const res = await fetch(`${baseUrl}/api/insights?scope=team&is_active=true`, { cache: 'no-store' })
  if (!res.ok) return []
  const body = await res.json()
  return body.insights ?? []
}

export default async function HomePage() {
  const [data, teamInsights] = await Promise.all([getHomeData(), getTeamInsights()])

  if (!data) {
    return (
      <div className="px-6 py-6 max-w-[1440px] mx-auto">
        <p className="text-muted-foreground text-sm">Unable to load dashboard data.</p>
      </div>
    )
  }

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      <TeamSnapshot snapshot={data.team_snapshot} />
      <div className="space-y-4">
        <NextGameHero game={data.next_game} />
        {data.upcoming_schedule.length > 1 && (
          <ScheduleTable games={data.upcoming_schedule.slice(1, 5)} />
        )}
      </div>
      <PlayerTrendsTable players={data.player_trends} />
      <InsightTileArea insights={teamInsights} className="h-[200px]" />
      <PointDiffChart last10={data.team_snapshot.last_10} schedule={data.upcoming_schedule} />
    </div>
  )
}
```

### Pattern 2: TeamSnapshot (StatCard row)

Use the existing `StatCard` component for each metric. Five cards in a CSS grid.

```typescript
// Source: components/stat-card/StatCard.tsx props interface
// components/home/TeamSnapshot.tsx
import { StatCard } from '@/components/stat-card/StatCard'

interface TeamSnapshotProps {
  snapshot: {
    record: { wins: number; losses: number }
    last_10: { wins: number; losses: number }
    net_rating: number | null
    off_rating: number | null
    def_rating: number | null
  }
}

export function TeamSnapshot({ snapshot }: TeamSnapshotProps) {
  return (
    <div className="grid grid-cols-5 gap-3">
      <StatCard label="Record" value={`${snapshot.record.wins}–${snapshot.record.losses}`} />
      <StatCard label="Last 10" value={`${snapshot.last_10.wins}–${snapshot.last_10.losses}`} />
      <StatCard
        label="Net Rtg"
        value={snapshot.net_rating != null ? snapshot.net_rating.toFixed(1) : '—'}
        positive={snapshot.net_rating != null ? snapshot.net_rating > 0 : undefined}
      />
      <StatCard
        label="Off Rtg"
        value={snapshot.off_rating != null ? snapshot.off_rating.toFixed(1) : '—'}
      />
      <StatCard
        label="Def Rtg"
        value={snapshot.def_rating != null ? snapshot.def_rating.toFixed(1) : '—'}
      />
    </div>
  )
}
```

### Pattern 3: ScheduleTable (conditional odds columns)

Derive whether any game has odds before rendering. If none have odds, omit the three columns entirely. If at least one has odds, include all three columns and show "—" for individual nulls.

```typescript
// Source: CONTEXT.md locked decision + /api/home route.ts UpcomingGameRow shape
// components/home/ScheduleTable.tsx
// NOTE: BoxScoreTable is 'use client' (has useState for sort) — this must be too
'use client'
import { BoxScoreTable, BoxScoreColumn, BoxScoreRow } from '@/components/box-score/BoxScoreTable'

interface ScheduleGame {
  game_id: number
  game_date: string
  start_time_utc: string | null
  opponent_abbr: string
  home_away: 'home' | 'away'
  odds: { spread: string | null; moneyline: string | null; over_under: string | null } | null
}

export function ScheduleTable({ games }: { games: ScheduleGame[] }) {
  const hasAnyOdds = games.some((g) => g.odds !== null)

  const baseColumns: BoxScoreColumn[] = [
    { key: 'opponent', label: 'Opponent' },
    { key: 'date', label: 'Date' },
    { key: 'time', label: 'Time', numeric: false },
    { key: 'location', label: 'H/A', numeric: false },
  ]
  const oddsColumns: BoxScoreColumn[] = hasAnyOdds
    ? [
        { key: 'spread', label: 'Spread', numeric: true },
        { key: 'ml', label: 'ML', numeric: true },
        { key: 'ou', label: 'O/U', numeric: true },
      ]
    : []
  const columns = [...baseColumns, ...oddsColumns]

  const rows: BoxScoreRow[] = games.map((g) => ({
    id: String(g.game_id),
    opponent: g.opponent_abbr,
    date: formatGameDate(g.game_date),
    time: g.start_time_utc ? formatGameTime(g.start_time_utc) : '—',
    location: g.home_away === 'home' ? 'Home' : 'Away',
    ...(hasAnyOdds
      ? {
          spread: g.odds?.spread ?? '—',
          ml: g.odds?.moneyline ?? '—',
          ou: g.odds?.over_under ?? '—',
        }
      : {}),
  }))

  return <BoxScoreTable columns={columns} rows={rows} maxHeight="max-h-none" />
}
```

### Pattern 4: InsightTileArea Height Override

`InsightTileArea` already accepts a `className` prop that overrides the container class. Per CONTEXT.md, increase height from the default `h-[144px]` to approximately `200px`.

```typescript
// Source: components/live/InsightTileArea.tsx — className prop replaces default h-[144px]
<InsightTileArea insights={teamInsights} className="h-[200px]" />
```

The component's internal `cn('relative h-[144px]', className)` call means passing `className="h-[200px]"` will override the default height via Tailwind's class precedence (last class wins in v4 with `cn`).

### Pattern 5: BarChartWrapper for Point Differential

The BarChart needs per-game margin data. The `series` prop is a single series with `key: 'margin'`. For win/loss bar coloring, Recharts supports a `Cell` approach per-bar or a `fill` function. The cleanest approach with the existing `BarChartWrapper` interface is to create two separate series (one for positive margins, one for negative), using chart-2 (emerald, wins) and chart-4 (red, losses).

However, `BarChartWrapper` does not currently support per-bar coloring — it maps one color per `series` entry. The correct approach for per-bar color is to use a custom `PointDiffChart` that uses `BarChartWrapper` as reference but renders the `Bar` component with a `Cell` child from Recharts:

```typescript
// Source: BarChartWrapper.tsx + Recharts Cell API
// components/home/PointDiffChart.tsx
'use client'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts'

interface GameMargin {
  label: string    // e.g. "GSW 3/1" (opponent + month/day)
  margin: number   // positive = win, negative = loss
}

export function PointDiffChart({ games }: { games: GameMargin[] }) {
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium text-muted-foreground">Last 10 Games</p>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={games} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid
            strokeDasharray=""
            stroke="var(--border)"
            strokeOpacity={0.08}
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            axisLine={false}
            tickLine={false}
            width={36}
          />
          <Tooltip
            content={<PointDiffTooltip />}
          />
          <Bar dataKey="margin" radius={[2, 2, 0, 0]}>
            {games.map((entry, index) => (
              <Cell
                key={`cell-${index}`}
                fill={entry.margin >= 0 ? 'var(--chart-2)' : 'var(--chart-4)'}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
```

This is the correct Recharts pattern for conditional bar colors. `BarChartWrapper` does not support this (one fill per series), so `PointDiffChart` is a purpose-built component that follows the same structure.

### Pattern 6: PlayerTrendsTable with Linked Rows

`BoxScoreTable` renders plain `<td>` cells — it does not support link wrapping. For the name column links, wrap the name cell content in a Next.js `<Link>` with hover styling. The cleanest approach is a custom table that follows `BoxScoreTable` aesthetics but renders rows as links.

Alternatively: render `BoxScoreTable` and handle navigation via row click using a wrapper approach. However, the cleanest MVP solution is a `PlayerTrendsTable` that replicates the BoxScoreTable table structure (same CSS classes) but renders the first column as `<Link href={/players/${player_id}}>`.

```typescript
// Source: BoxScoreTable.tsx structure, CONTEXT.md link decision
// components/home/PlayerTrendsTable.tsx
'use client'
import Link from 'next/link'
import { cn } from '@/lib/utils'

// Uses same CSS classes as BoxScoreTable for visual consistency:
// thead: bg-surface border-b border-white/[0.04]
// th: px-3 py-2 text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em]
// tr: border-b border-white/[0.04] hover:bg-white/[0.03] transition-colors h-9
// td: px-3 py-2 text-[0.8125rem] text-foreground
// name cell: font-medium text-left — wraps in Link
// stat cells: text-right tabular-nums
// L5 delta: text-positive with "+" prefix or text-negative with "−" prefix
```

### Anti-Patterns to Avoid

- **Using `conference_seed`:** The API always returns `null` for this field (no standings table). CONTEXT.md explicitly says omit it — do not show "—", do not show a StatCard for it.
- **Fabricating ts_pct:** The `player_trends` API response returns `ts_pct: null` for all players. Display as "—" per never-fabricate rule. Do not compute it from other fields.
- **Fabricating l5_delta:** The API does not return season averages separately — only the last-10 window average. If l5_delta (last 5 vs season) cannot be computed, show "—" or omit that column. Do NOT approximate from available data.
- **Polling on the home page:** The page is a React Server Component. No SWR, no polling. Home dashboard refreshes via Next.js `cache: 'no-store'` on each page load.
- **Using shadcn Card wrapper:** Per Phase 10.1 decision, surfaces use plain `div` with token classes (`bg-surface`, `border-white/[0.06]`), not `<Card>` or `<CardContent>`.
- **Hardcoded hex colors:** All colors via CSS variable tokens — `text-positive`, `text-negative`, `var(--chart-2)`, `var(--chart-4)`. Never `text-[#34D399]`.
- **Placing `InsightTileArea` height in a wrapping div:** The `className` prop on `InsightTileArea` targets the root container directly — pass `h-[200px]` via className, do not add an outer div.
- **`BarChartWrapper` for per-bar colors:** The existing `BarChartWrapper` applies one fill per series. For the point-differential chart where each bar has a different color (green/red), create `PointDiffChart` using Recharts `Cell` directly.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stat cards display | Custom stat tile | `StatCard` (components/stat-card/StatCard.tsx) | Design-system-compliant, exact sizing |
| Stat card loading | Custom skeleton | `StatCardSkeleton` | Exact dimensions match StatCard |
| Player stats table | Custom table | Replicate BoxScoreTable CSS classes | BoxScoreTable lacks link support; replicate structure |
| Box score loading | Custom skeleton | `BoxScoreSkeleton` | Matches table structure |
| Bar chart | Custom SVG | Recharts via `BarChartWrapper` (or `PointDiffChart` for per-bar colors) | Consistent dark theme, responsive container |
| Chart loading | Custom skeleton | `ChartSkeleton` with `height` prop | Already built |
| Insight rotation | Custom timer | `InsightTileArea` (from Phase 11) | Already handles 8s cycle, dot indicators, fade |
| Date/time parsing | Custom formatter | Inline JS `Date` constructor with `toLocaleString` | Simple one-liner sufficient for display-only |
| Odds null handling | Custom logic | Inline ternary — `odds?.spread ?? '—'` | Already the project pattern (ODDS-03) |

**Key insight:** All primitives and patterns exist from Phases 10, 10.1, and 11. Phase 12 is UI composition only.

---

## Common Pitfalls

### Pitfall 1: l5_delta Column Cannot Be Computed from API Data

**What goes wrong:** CONTEXT.md specifies an "L5 delta" column (PPG last-5 vs season avg) in the player trends table. The `/api/home` `player_trends` response returns only `pts_avg` over the last-10 window (not a last-5 window and not a separate season average). There is no season-avg field in the response.

**Why it happens:** The API was built to provide `pts_avg` over the last-N window (window_games). It does not expose a "season average" or a "last-5 only" average separately.

**How to handle:** Two options:
1. Show "—" for the L5 delta column universally (honest, consistent with never-fabricate rule).
2. Omit the L5 delta column entirely from the table.

**Recommendation:** Omit the L5 delta column rather than showing "—" for every row — a column of dashes provides no value. The planner should note this constraint and drop the column for MVP. The remaining columns (Name, PPG, RPG, APG, TS%) still satisfy HOME-04.

**Warning signs:** L5 delta values that are always "—" is a signal the column should be removed.

---

### Pitfall 2: Point Differential Data Not in /api/home Response

**What goes wrong:** The Last-10 chart needs per-game margin data (opponent label + point differential per game). The `/api/home` response returns `team_snapshot.last_10` as `{ wins: number, losses: number }` — aggregate counts only. Individual game margins are not in the response.

**Why it happens:** The API was designed for aggregate stats, not game-by-game chart data.

**How to handle:** Two options:
1. Add a separate fetch in the page — `/api/history/games?team=LAC&limit=10&status=final` or similar — to get per-game results. Then compute `margin = lacScore - oppScore` client-side.
2. Re-examine the API: the `/api/home` route queries `last10Rows` (query B) which returns `home_team_id, away_team_id, home_score, away_score`. This data is available server-side but is aggregated down to just wins/losses in the response. A small change to include `last10_games` array in the response payload would solve this.

**Recommendation:** Add `last10_games` to the `/api/home` response as part of Plan 01, by exposing the existing `last10Rows` query result. The route already runs this query — it's a matter of serializing the results alongside the aggregate. This avoids a second API call from the page component.

**Warning signs:** If the chart renders a single bar or is omitted, this pitfall was hit.

---

### Pitfall 3: InsightTileArea Height Override May Not Work with Tailwind v4 class merging

**What goes wrong:** `InsightTileArea` has `cn('relative h-[144px]', className)`. If both the default `h-[144px]` and an override `h-[200px]` are present, Tailwind v4's JIT may apply both and the last-wins behavior depends on CSS specificity.

**Why it happens:** Arbitrary height values with the same Tailwind utility prefix (`h-`) can conflict when both are in the `class` string.

**How to handle:** `cn()` (from `clsx` + `tailwind-merge`) resolves conflicting Tailwind utilities — `tailwind-merge` detects that `h-[200px]` and `h-[144px]` are both `height` utilities and keeps only the last one. This project uses `tailwind-merge` so the override will work correctly.

**Verification:** Check that `cn('relative h-[144px]', 'h-[200px]')` produces `relative h-[200px]`, not `relative h-[144px] h-[200px]`. The `cn` utility in this project uses tailwind-merge (`tailwind-merge: ^3.5.0`), so conflict resolution is automatic.

---

### Pitfall 4: React Server Component Cannot Directly Use Client Components that Require State

**What goes wrong:** `BoxScoreTable` and `InsightTileArea` are `'use client'` components. A React Server Component can import and render them, but cannot pass callback props or receive state from them.

**Why it happens:** RSC/Client component boundary — Server Components can only pass serializable props to Client Components.

**How to avoid:** This is fine for our use case — we only pass data (arrays, strings, numbers) as props. No callback functions required. Confirm that `PlayerTrendsTable` and `PointDiffChart` are declared as `'use client'` if they use state, or remain as pure render components with no hooks (then no directive needed).

---

### Pitfall 5: `start_time_utc` May Be Null

**What goes wrong:** Games without confirmed tip-off times have `start_time_utc: null` in the schedule. Formatting a null time crashes if not guarded.

**Why it happens:** BDL/NBA API schedule data sometimes omits time before it's finalized.

**How to avoid:** Always guard: `g.start_time_utc ? formatGameTime(g.start_time_utc) : 'TBD'`. The route.ts already casts `start_time_utc::text` which can be null.

---

### Pitfall 6: Tailwind v4 Arbitrary Class Syntax

**What goes wrong:** Using `bg-[var(--surface)]` instead of `bg-surface`. In Tailwind v4 with `@theme inline`, the token is mapped to a utility.

**How to avoid:** Use `bg-surface`, `bg-surface-alt`, `text-positive`, `text-negative`, `text-muted-foreground`. Only use `bg-[var(--X)]` for tokens NOT in the `@theme inline` block (e.g., `bg-[var(--surface-alt)]` in the BarChart tooltip is acceptable since it's inside a Recharts JSX string context).

---

## Code Examples

Verified patterns from official source files:

### /api/home Response Shape

```typescript
// Source: src/app/api/home/route.ts — actual response payload construction
{
  meta: { generated_at, source, stale, stale_reason, ttl_seconds },
  team_snapshot: {
    team_abbr: 'LAC',
    season_id: number,
    record: { wins: number, losses: number },
    conference_seed: null,  // always null — no standings table
    net_rating: number | null,
    off_rating: number | null,
    def_rating: number | null,
    last_10: { wins: number, losses: number },
  },
  next_game: {            // null when no upcoming games
    game_id: number,
    game_date: string,    // "2026-03-14"
    start_time_utc: string | null,
    opponent_abbr: string,
    home_away: 'home' | 'away',
    status: string,
    odds: {               // null when no odds data
      spread: string | null,
      moneyline: string | null,
      over_under: string | null,
    } | null,
  } | null,
  upcoming_schedule: Array<{  // same shape as next_game, up to 10 entries
    game_id, game_date, start_time_utc, opponent_abbr, home_away, status, odds
  }>,
  player_trends: Array<{
    player_id: number,
    name: string,
    window_games: number,
    minutes_avg: number,
    pts_avg: number,
    reb_avg: number,
    ast_avg: number,
    ts_pct: null,         // always null — not stored in game_player_box_scores
  }>,
  insights: Array<{
    insight_id: string,
    category: string,
    headline: string,
    detail: string | null,
    importance: number,
    proof: { summary: string, result: unknown },
  }>,
}
```

### StatCard for Team Snapshot

```typescript
// Source: components/stat-card/StatCard.tsx props interface (verified)
<StatCard
  label="Net Rtg"
  value={snapshot.net_rating != null ? snapshot.net_rating.toFixed(1) : '—'}
  positive={snapshot.net_rating != null ? snapshot.net_rating > 0 : undefined}
/>
// Note: when positive is undefined, delta text uses text-muted-foreground (neutral)
```

### BarChartWrapper for Standard Charts

```typescript
// Source: components/charts/BarChartWrapper.tsx (verified props)
<BarChartWrapper
  data={[{ date: 'GSW', margin: 12 }, { date: 'PHX', margin: -5 }]}
  series={[{ key: 'margin', label: 'Point Diff', color: 'var(--chart-2)' }]}
  xKey="date"
  height={200}
/>
// Use for simple single-color charts; use PointDiffChart (custom) for per-bar color
```

### InsightTileArea Reuse with Height Override

```typescript
// Source: components/live/InsightTileArea.tsx — className prop verified
// The cn() call in InsightTileArea: cn('relative h-[144px]', className)
// tailwind-merge resolves h-[200px] vs h-[144px] in favor of the className value
<InsightTileArea
  insights={teamInsights}
  className="h-[200px]"
/>
```

### Odds Display Pattern

```typescript
// Source: STATE.md accumulated decisions — "odds:null when no snapshot — never fabricate"
// CONTEXT.md locked decision on odds columns
const hasAnyOdds = games.some((g) => g.odds !== null)
// In row construction:
spread: hasAnyOdds ? (g.odds?.spread ?? '—') : undefined
// Only include odds cells when hasAnyOdds is true
```

### Date/Time Formatting for Schedule

```typescript
// Pattern: format game_date + start_time_utc for display
// game_date is "YYYY-MM-DD", start_time_utc is ISO string or null
function formatGameDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00')  // noon local avoids TZ shift on date-only strings
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  // → "Fri, Mar 14"
}

function formatGameTime(utcStr: string): string {
  const d = new Date(utcStr)
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  })
  // → "7:30 PM PT"
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| shadcn Card wrapper for surfaces | Plain `div` with token classes | Phase 10.1 | Precise control over borders/bg |
| `border-slate-700` | `border-white/[0.06]` hairline | Phase 10.1 | Premium floating appearance |
| Per-file color hex | CSS variable tokens via `@theme inline` | Phase 10 | All colors from utilities, no hardcoded hex in JSX |
| `overflow-auto` on table wrapper | `overflow-y-auto` on custom div | Phase 10 | Sticky thead works correctly |
| `opacity` on CartesianGrid | `strokeOpacity` | Phase 10.1 | Targets line stroke only |
| 'use client' polling pages | RSC fetch + no polling (home page) | Phase 12 | Server renders full page, no hydration cost for static data |

**Notable for Phase 12:** The home page is the first full RSC page in this project. `app/live/page.tsx` is `'use client'` with SWR polling. `app/home/page.tsx` should be a Server Component — `async function HomePage()` with `await fetch(...)` calls at the top. This matches the Phase 12 CONTEXT.md decision ("React Server Component — fetch `/api/home` server-side").

---

## Open Questions

1. **Last-10 chart data — per-game margins not in API response**
   - What we know: `/api/home` route runs `last10Rows` query (returns `home_team_id, away_team_id, home_score, away_score` for last 10 final games) but only uses it for aggregate `last_10: { wins, losses }`. The per-game data is discarded before the response is built.
   - What's unclear: Whether to (a) modify `/api/home` to include `last10_games` array, or (b) use a second fetch to `/api/history/games`.
   - Recommendation: The planner should add a task to expose `last10_games` in the `/api/home` response. This is minimal — the query already runs, the data just needs to be serialized. Format: `Array<{ opponent_abbr: string, game_date: string, margin: number }>`. This avoids a second API call from the RSC page.

2. **l5_delta column — not computable from current API**
   - What we know: API returns only the last-10 window average (`pts_avg`). No separate last-5 or season average is exposed.
   - Recommendation: Omit the L5 delta column for MVP. It is listed in CONTEXT.md as a locked decision, but the data is genuinely unavailable. The planner should flag this as a constraint and drop the column rather than showing a column of dashes.

3. **`/api/insights` fetch from RSC — base URL pattern**
   - What we know: The RSC needs to call `fetch('/api/insights?scope=team&is_active=true')`. In Next.js App Router, server-side fetch requires an absolute URL.
   - What's unclear: Whether `NEXT_PUBLIC_BASE_URL` env var is set in this project.
   - Recommendation: Use `process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'` as the base URL for all server-side fetches. Alternatively, import the API handler function directly (avoids HTTP round-trip). Check existing RSC pages for the established pattern — there are none yet (`app/live/page.tsx` is 'use client').

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
| HOME-01 | Home page renders when no live game active | manual-only | visual inspection at `http://localhost:3000/home` | N/A |
| HOME-02 | Team snapshot stat cards show record, L10, ratings | manual-only | visual inspection | N/A |
| HOME-03 | Upcoming schedule shows 5 games with correct fields | manual-only | visual inspection | N/A |
| HOME-04 | Player trends table shows top players with stats | manual-only | visual inspection | N/A |
| HOME-05 | Rotating team insights display with 8s cycle | manual-only | visual inspection | N/A |
| HOME-06 | Odds shown when available, hidden when null | unit | `npx vitest run src/lib/` | ❌ Wave 0 |
| SCHED-01 | Upcoming games list populates | manual-only | visual inspection | N/A |
| SCHED-02 | Schedule rows have opponent, date, time, H/A | manual-only | visual inspection | N/A |

> Note: All Phase 12 deliverables are React components (UI rendering). Vitest config covers `src/lib/**/*.test.ts` only — no jsdom, no React Testing Library. Pure logic extracted to `src/lib/` CAN be unit tested. The odds conditional rendering logic and date formatting utilities are good candidates.

### Sampling Rate

- **Per task commit:** `npx vitest run src/lib/` (ensures existing tests remain green)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + visual inspection of home page before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/home-utils.test.ts` — covers date/time formatting utilities (formatGameDate, formatGameTime) and odds column logic (hasAnyOdds derived from game list)

*(No new test infrastructure needed — Vitest already configured. React component rendering is manual-only.)*

---

## Sources

### Primary (HIGH confidence)
- `/Users/luke/CCC/src/app/api/home/route.ts` — exact API response shape, all field names, query results, null handling
- `/Users/luke/CCC/components/stat-card/StatCard.tsx` — props interface, design tokens
- `/Users/luke/CCC/components/box-score/BoxScoreTable.tsx` — props interface, column/row types, CSS class structure
- `/Users/luke/CCC/components/charts/BarChartWrapper.tsx` — props interface, ChartSeries type, CHART_COLORS
- `/Users/luke/CCC/components/live/InsightTileArea.tsx` — className prop, height override via cn(), rotation behavior
- `/Users/luke/CCC/components/skeletons/` — StatCardSkeleton, BoxScoreSkeleton, ChartSkeleton all verified
- `/Users/luke/CCC/app/home/page.tsx` — confirmed stub, safe to replace entirely
- `/Users/luke/CCC/app/globals.css` — all CSS variable tokens verified (--chart-2, --chart-4, --positive, --negative etc.)
- `/Users/luke/CCC/package.json` — all dependency versions confirmed
- `/Users/luke/CCC/vitest.config.ts` — test scope confirmed (no jsdom)
- `/Users/luke/CCC/.planning/phases/12-between-games-dashboard/12-CONTEXT.md` — locked decisions, discretion areas

### Secondary (MEDIUM confidence)
- `/Users/luke/CCC/.planning/STATE.md` — accumulated decisions cross-verified with source code
- `/Users/luke/CCC/.planning/phases/11-live-game-dashboard/11-RESEARCH.md` — established patterns carried forward

### Tertiary (LOW confidence)
- None — all research based on direct code inspection

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified from package.json and existing source
- Architecture: HIGH — all component interfaces read from source, API shape fully known from route.ts
- Pitfalls: HIGH — identified from direct code inspection (l5_delta gap, chart data gap, InsightTileArea height merge)
- Open Questions: MEDIUM — resolutions are clear but require planner-level decisions

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable codebase — design system and API shape locked for MVP)
