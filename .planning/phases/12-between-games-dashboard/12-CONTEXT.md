# Phase 12: Between-Games Dashboard - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the Home dashboard (`app/home/page.tsx`) displayed when no Clippers game is active. Shows team snapshot stats, a next-game hero card + 4 additional upcoming games, a player trends table, rotating team insights, and a last-10 point differential bar chart. All data from `/api/home` via React Server Component (no client-side polling).

Out of scope: player detail pages (Phase 13), full schedule page (Phase 14), standings data (no standings table exists).

</domain>

<decisions>
## Implementation Decisions

### Page structure (top to bottom)
1. Team Snapshot — stat cards row
2. Next Game card (prominent hero) + Schedule table (next 4 remaining games)
3. Player Trends table
4. Team Insights tile (rotating)
5. Last-10 Point Differential bar chart

All sections are full-width (12 columns). No 8/4 sidebar split — keep the layout clean and simple.

### Team Snapshot section
- Stat cards row: Record, Last 10 record, Net Rating, Off Rating, Def Rating
- Conference seed: omit (returns null from API — do not fabricate or show "—")
- Use existing StatCard component

### Next game hero card
- Shows: opponent, date/time, home/away indicator
- Odds (spread, moneyline, over/under) when available — hidden entirely when not available
- No context note / insight attached to the next game card for MVP

### Schedule table (remaining 4 games after next)
- Show next 5 total upcoming games (1 as hero card + 4 in table)
- Table columns: Opponent, Date, Time, Home/Away, Spread, ML, O/U
- Odds columns: render only when at least one game has odds data; show "—" for individual missing values within a table that has some odds
- If no games have odds at all, omit the three odds columns entirely

### Player trends table
- Uses compact table/list layout (BoxScoreTable styling)
- Top 8 players by recent minutes (matches `/api/home` return)
- Columns: Name, PPG, RPG, APG, TS%, L5 delta (PPG vs season avg)
- L5 delta: color-coded with sign — positive in text-positive (emerald) with "+" prefix, negative in text-negative (red) with "−" prefix
- Each row is a link to `/players/{player_id}` (Phase 13 page stubs gracefully)
- When box score data is sparse, fewer rows render naturally (do not pad)

### Team insights
- Reuse InsightTileArea component from Phase 11
- Override height: increase from 144px to ~200px to allow more detail text breathing room (home page has vertical space to spare)
- Feed with scope=team insights from `/api/insights?scope=team&is_active=true`
- 8s auto-rotation, fade transition, dot indicators — all inherited from the component
- If no team insights exist: hide section entirely (InsightTileArea returns null when empty)

### Last-10 point differential chart
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

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/stat-card/StatCard.tsx`: label/value/delta/context props, bg-surface styling — use for team snapshot row
- `components/stat-card/StatCardSkeleton.tsx`: loading state for stat cards
- `components/box-score/BoxScoreTable.tsx`: columns/rows/maxHeight props, sticky header, sortable, right-aligned numbers — use for player trends table
- `components/charts/BarChartWrapper.tsx`: data/series/height props, dark-styled Recharts wrapper with restrained chart palette — use for last-10 chart
- `components/live/InsightTileArea.tsx`: insight rotation, 8s fade, dot indicators — reuse with height override (className prop available)
- `hooks/useInsightRotation.ts`: not needed directly (InsightTileArea handles it internally)
- `app/home/page.tsx`: currently a stub — replace body entirely
- `src/app/api/home/route.ts`: `/api/home` fully implemented; returns team_snapshot, schedule (with odds), player_trends, insights

### Established Patterns
- React Server Component — fetch `/api/home` server-side, pass data as props to sub-components
- Dark-only design, no light mode variants needed
- Tailwind token utilities: `bg-surface`, `bg-surface-alt`, `text-foreground`, `text-muted-foreground`, `text-positive`, `text-negative`, `border-white/[0.06]`
- Odds display: always graceful — never fabricate, always hide when null
- `tabular-nums` is global on body — numbers render correctly in all tables

### Integration Points
- `app/home/page.tsx`: entry point — replace stub with Server Component that fetches and renders
- `/api/home`: returns `{ team_snapshot, schedule, player_trends, insights, meta }`
- `/api/insights?scope=team`: returns team-scoped insights for InsightTileArea
- `/players/{player_id}`: destination for clickable player rows (Phase 13 stub exists)
- All design tokens already in `app/globals.css` — no new CSS variables needed

</code_context>

<specifics>
## Specific Ideas

- Player trends table uses the same compact table aesthetic as BoxScoreTable (small caps headers, right-aligned stats, 36px rows, faint horizontal borders) but with a name column that is left-aligned and a hover state that links to the player page
- The next-game hero card should feel intentional and prominent — more space than a table row — but not over-decorated. Think Apple Sports "next game" treatment: clean type hierarchy, not a heavy card
- The last-10 bar chart provides the visual form guide that the text stats in the team snapshot can't — wins/losses as positive/negative bars is immediately readable

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 12-between-games-dashboard*
*Context gathered: 2026-03-07*
