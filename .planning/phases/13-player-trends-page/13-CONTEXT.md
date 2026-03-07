# Phase 13: Player Trends Page - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the Player Trends experience: a roster picker page (`/players`) where users select a Clippers player, and a player detail page (`/players/[player_id]`) showing rolling averages, trend charts, splits, and a game log. All data from existing `/api/players` and `/api/players/[player_id]` endpoints via React Server Components (except the chart metric selector, which requires a Client Component).

Out of scope: new API endpoints (unless minor extension for chart series), player comparison views, video, fantasy data.

</domain>

<decisions>
## Implementation Decisions

### Roster page (/players)
- **View toggle:** Three view modes — list / cards / grid. Default on load: list.
- **Player scope:** Active roster (including injured players) + current-season LAC players who have since been traded. The "traded" distinction matters — fans want to explore recent departures.
- **Traded player treatment:** Show traded players inline in the roster list (not a separate section), with a small "Traded" badge next to their name. No other visual distinction.
- **Stats shown in any view:** Name, position, L10 PPG, L10 RPG, L10 APG.
- **Data source note for planner:** `/api/players?active_only=true` returns only currently active players. The API or query may need adjustment to include current-season players who are no longer `is_active` but played for LAC this season. Planner should resolve this.

### Player detail page structure (top to bottom)
1. **Player header:** Name + position + season PPG / RPG / APG
2. **Rolling averages comparison table**
3. **Trend chart** (metric selector + L5 + L10 lines)
4. **Splits** (home/away, wins/losses)
5. **Game log table** (full width, max-height ~400px, vertical scroll)

### Rolling averages comparison table
- **Layout:** Compact table — rows = stats, columns = L5 / L10 / Season
- **Stats (rows):** PTS, REB, AST, TS%
- **Color coding:** L5 column values are color-coded relative to L10 — green (`text-positive`) when meaningfully above, red (`text-negative`) when meaningfully below. L10 and Season columns are plain.
- **Data source note for planner:** `/api/players/[id]` returns `trend_summary` for L10 only. L5 and Season must be computed from `game_log` (last 5 rows for L5, all rows for Season). Planner should handle this derivation in the component or extend the API.

### Trend chart
- **Layout:** Single full-width chart with a metric selector above it (tabs or small button group).
- **Metric options:** PTS / REB / AST / TS% — user selects one at a time.
- **Lines:** Two lines on the same chart — L5 rolling average and L10 rolling average for the selected metric.
- **Interactivity:** Metric selector requires client-side state — this section must be a Client Component (chart area only; the rest of the page can remain a Server Component).
- **Default metric:** PTS (scoring is the primary trend of interest).
- **Data source note for planner:** `/api/players/[id]` currently returns `charts.rolling_pts` and `charts.rolling_ts` only. For REB and AST rolling series, the planner should either extend the API response or compute rolling windows from `game_log` data client-side. Both L5 and L10 windows are needed for each metric.

### Splits display
- **Splits shown:** Home / Away, Wins / Losses
- **Stats per split:** PTS avg, TS%
- **Display:** Claude's discretion — stat cards or a compact 2x2 comparison layout. Should be visually lightweight; splits are contextual, not the primary content.

### Game log table
- **Component:** Reuse `BoxScoreTable` — existing component, sticky header, sortable columns, right-aligned numbers.
- **Width:** Full page width (12 columns).
- **Height:** Fixed max-height (~400px) with vertical scroll — matches BoxScoreTable's `maxHeight` prop pattern.
- **Columns:** Date, Opp, H/A, MIN, PTS, REB, AST, FG, 3PT, FT, +/-
- **Row count:** Last 25 games (API limit).

### Claude's Discretion
- Exact splits component layout (stat cards vs. comparison grid)
- Threshold for "meaningful" L5 vs L10 divergence (e.g., >10% difference triggers color)
- Chart height and exact tick label formatting for dates
- Skeleton shapes for each section
- Whether view-toggle preference on /players is persisted (localStorage) or resets on navigation
- Exact badge styling for "Traded" label

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/box-score/BoxScoreTable.tsx`: `columns`, `rows`, `maxHeight`, `className` props — use directly for game log. Sticky header, sortable, right-aligned numbers, 36px row height already set.
- `components/charts/LineChartWrapper.tsx`: `data`, `series[]` (key, color, label), optional `title` and `height` — use for the trend chart. Supports multiple series on one chart.
- `components/stat-card/StatCard.tsx`: `label` / `value` / `delta` / `context` / `positive` — available for splits display or header stats.
- `components/skeletons/`: StatCardSkeleton, BoxScoreSkeleton, ChartSkeleton — use for loading states.
- `app/players/page.tsx`: Currently a stub — replace entirely.
- `app/api/players/route.ts`: Returns `{ players: [{ player_id, display_name, position, is_active }] }` — needs scope adjustment for traded players.
- `app/api/players/[player_id]/route.ts`: Returns `{ player, trend_summary (L10), charts (rolling_pts, rolling_ts), splits, game_log (last 25) }`.

### Established Patterns
- React Server Component for the page shell — fetch data server-side, pass as props.
- Chart metric selector requires Client Component — isolate the chart section as `'use client'`, keep rest of page as Server Component.
- Dark-only design — no light mode variants needed.
- Tailwind tokens: `bg-surface`, `bg-surface-alt`, `text-foreground`, `text-muted-foreground`, `text-positive`, `text-negative`, `border-white/[0.06]`.
- `tabular-nums` is global on body — all numbers render with tabular alignment automatically.
- No fabrication: if data is null/sparse, hide sections gracefully rather than showing zeroes.

### Integration Points
- `app/players/page.tsx` → replace stub, fetches `/api/players` server-side, renders roster with view toggle.
- `app/players/[player_id]/page.tsx` → new dynamic route, fetches `/api/players/[id]` server-side, renders detail page.
- Phase 12 player trends table already links to `/players/{player_id}` — detail page must handle those routes correctly.
- Nav "Players" link already points to `/players` — roster page replaces the stub.
- `CHART_COLORS` tokens (`--chart-1` through `--chart-4`) — use for L5 and L10 line colors on the chart.

</code_context>

<specifics>
## Specific Ideas

- Traded player badge should be subtle — a small muted label or dim badge, not alarming. The player's stats are still valid and useful; the badge is just informational.
- The comparison table (L5 / L10 / Season) is the centerpiece of the rolling averages section — it should read like a Bloomberg terminal stat block: clean columns, right-aligned numbers, faint horizontal rules.
- L5 color coding: green/red only when the divergence is meaningful (>10% threshold recommended). Avoid false signal on small differences.
- Chart default to PTS — scoring trend is what fans check first. Metric selector tabs sit above the chart, compact, not a dropdown.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 13-player-trends-page*
*Context gathered: 2026-03-07*
