# Phase 14: Historical Explorer - Context

**Gathered:** 2026-03-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Two-page experience:
1. `/history` — Season browser: select a season, apply filters, view full game list, see season summary stats
2. `/history/[game_id]` — Game detail: game header, full box score (when available), historical insight tiles

All data comes from existing API endpoints: `/api/history/seasons`, `/api/history/games`, `/api/history/games/[game_id]`. No new API endpoints needed unless minor extension.

Out of scope: standings, league-wide historical explorer, video, play-by-play, player comparison across seasons.

</domain>

<decisions>
## Implementation Decisions

### Season selector form
- **Control type:** Compact styled dropdown (not pill tabs) for season selection
- **Filters:** Two segmented button groups alongside the dropdown — `[ All | Home | Away ]` and `[ All | W | L ]`
- **Default season:** Most recent available season (highest season_id from `/api/history/seasons`)
- **State management:** Filter/season state lives in URL query params (`?season_id=2023&home_away=home&result=W`). Page is a Server Component that reads searchParams. Season/filter changes use `useRouter().push()` from a small Client Component wrapper for the controls.
- **Sticky controls:** Season selector + filter controls are sticky at the top of the page (stay pinned as game list scrolls below). Critical for 82-game lists.

### Season summary bar
- **Show it:** Appears between the controls and the game list as a row of stat cards
- **Stats to display:** Overall W-L, Home W-L, Away W-L, Net Rating
- **Data source:** W-L and home/away computed from the full season game list (not the filtered list — always reflects the full season record)
- **Net Rating:** Included as a card even if null for most seasons today. Renders `—` when null; populates as Phase 5 data matures. Do NOT omit the card — the UI should be ready for the data.
- **Record format:** "42-40" style, two numbers. No win percentage.
- **StatCard component:** Use existing StatCard for each card in the row

### Game list display
- **Layout:** Dense full-width table (not cards). All games for the selected season/filter in a scrollable table
- **Columns:** Date | Opponent | H/A | Score | Result — exactly the five columns the requirements specify. OT flag as a small badge on the Score cell (e.g. "112-108 OT")
- **Navigation:** Entire row is clickable (`cursor-pointer`). Clicking navigates to `/history/[game_id]`. No explicit "View" link column
- **Row hover:** Consistent with BoxScoreTable row hover pattern (`hover:bg-white/[0.06]`, 150ms transition)
- **No availability indicator:** Do not dim or mark rows where box score is unavailable. The detail page handles it gracefully — no need to signal upfront
- **Opponent display:** Show opponent abbreviation with H/A prefix inline (e.g. "@ LAL" / "vs DEN") — consistent with schedule page pattern from Phase 12
- **Component:** Do NOT reuse BoxScoreTable directly (it expects player stat columns). Build a purpose-specific GameListTable component styled consistently with BoxScoreTable's visual language (same row height, header style, hover, fonts)

### Game detail: box score unavailable handling
- **When `box_score.available = false`:** Show the full game header (teams, score, date, result, season label), then where the box score section would be show a clear muted empty state:
  > "Box score not available for this game. Data is collected going forward from the live pipeline."
- **When `box_score.available = true`:** Full box score using BoxScoreTable for player rows. Same columns as live dashboard: MIN, PTS, REB, AST, STL, BLK, TO, FG, 3PT, FT, +/-
- **Insights:** Always show the insights section if insights exist, regardless of box score availability. Use InsightTileArea component (4-col sidebar, same as Phase 11 layout pattern)
- **If no insights exist for the game:** Hide insights section entirely — no empty state needed for this

### Forward-compatible data handling (IMPORTANT)
- **Build for the full data model, not today's data.** The DB is sparse in Phase 14. Many metrics (Net Rating, advanced stats per game, full box scores) will populate as Phase 5/7 data matures.
- **Pattern for all nullable fields:** Show `—` for null numeric values rather than omitting UI sections. This applies to: Net Rating in season summary, advanced stats if added to game detail, individual box score cells with null values.
- **Do not hardcode assumptions about which games have data.** The `available` flag on the API drives box score display — trust it.
- **Game detail page layout:** Always render the full two-column layout (box score 8 cols + insights sidebar 4 cols) even when box score is unavailable. The left column shows the empty state message; the right column shows insights if any exist.

### Claude's Discretion
- Exact sticky controls implementation (CSS `sticky top-X` vs fixed positioning)
- Score column formatting (e.g. "112-108" vs "W 112-108")
- Result column: colored badge ("W" in green / "L" in red) vs plain text
- Season summary card exact widths and spacing
- Whether the game detail page has a breadcrumb back to the history list (recommended: yes, but implementation is Claude's call)
- Skeleton shapes for game list and game detail sections
- OT badge exact styling (small muted pill, e.g. "OT" in text-muted-foreground)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `components/box-score/BoxScoreTable.tsx`: Use for player box score on game detail page. columns/rows/maxHeight props. Do NOT use for the game list — build a separate GameListTable.
- `components/stat-card/StatCard.tsx`: Use for season summary bar (Overall W-L, Home W-L, Away W-L, Net Rating). label/value/context props.
- `components/skeletons/`: StatCardSkeleton, BoxScoreSkeleton — use for loading states on both pages.
- `app/history/page.tsx`: Currently a stub — replace entirely.
- `app/api/history/seasons/route.ts`: Returns `{ seasons: [{ season_id, label }] }` — e.g. label = "2023-24".
- `app/api/history/games/route.ts`: Paginated, accepts `season_id`, `home_away` ('home'|'away'), `result` ('W'|'L'), `cursor`, `limit`. Returns game rows with date, teams, score, status.
- `app/api/history/games/[game_id]/route.ts`: Returns game detail with `box_score.available` boolean flag, player rows, and insights array.
- `InsightTileArea` from Phase 11 — use for game detail insights sidebar (4-col, same as live dashboard).

### Established Patterns
- React Server Component for page shell — read `searchParams` for season/filter state server-side
- Controls bar (season dropdown + filter segmented buttons) needs client-side interactivity → small `'use client'` wrapper component for just the controls; rest of page stays RSC
- Dark-only, no light mode variants
- Tailwind tokens: `bg-surface`, `bg-surface-alt`, `text-foreground`, `text-muted-foreground`, `border-white/[0.06]`
- No fabrication: null → `—`, missing sections → hidden (not zeroes)
- BoxScoreTable visual language: sticky header, `text-[0.625rem]` uppercase tracking headers, 36px rows, tabular-nums, right-aligned numbers

### Integration Points
- `app/history/page.tsx` → replace stub, reads `searchParams.season_id`, `searchParams.home_away`, `searchParams.result`, fetches seasons + games server-side
- `app/history/[game_id]/page.tsx` → new dynamic route, fetches `/api/history/games/[id]` server-side
- Nav "History" link already points to `/history` — the page replaces the stub with no nav changes needed

</code_context>

<specifics>
## Specific Ideas

- The game list should feel like a data terminal — same density and style as BoxScoreTable but with game-level rows instead of player rows. Dense, scannable, every row clickable.
- Season summary bar: three or four compact StatCards in a row. Net Rating card included even if it shows `—` today — the layout should not change when the data arrives.
- OT: small muted badge inline with the score cell, not a separate column. Keeps the column count tight.
- Game detail game header: prominently show final score (large numbers, like scoreboard), teams, date, and result badge. Should feel like a condensed version of the live scoreboard component.
- The "box score not available" empty state should be honest and brief — one or two lines of muted text. Not an error state, just a factual note about data availability.
- Build all sections with `—` fallbacks, not conditional rendering that removes entire sections. This way the page layout doesn't shift dramatically as data populates over time.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 14-historical-explorer*
*Context gathered: 2026-03-07*
