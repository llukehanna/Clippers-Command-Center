---
phase: 12-between-games-dashboard
verified: 2026-03-07T02:01:00Z
status: human_needed
score: 11/12 must-haves verified
re_verification: false
human_verification:
  - test: "All five dashboard sections render correctly at /home"
    expected: "Team Snapshot (5 cards), Next Game Hero, Schedule Table, Player Trends Table, and Point Differential Chart all display with real data. Insights tile appears when team insights exist in the DB."
    why_human: "Visual rendering of RSC components, Recharts bar chart colors, and rotating InsightTileArea require a live browser with DB data to confirm."
  - test: "Point differential chart bar colors"
    expected: "Bars for wins show emerald color (var(--chart-2)) and bars for losses show red (var(--chart-4)). Hovering a bar shows a tooltip with opponent abbreviation and signed margin."
    why_human: "CSS variable color rendering in Recharts SVG Cell elements cannot be verified programmatically."
  - test: "Player name hover and navigation"
    expected: "Hovering a player name in PlayerTrendsTable changes cursor and shows hover state. Clicking navigates to /players/{player_id}."
    why_human: "Hover feedback and Next.js Link navigation require a browser interaction."
---

# Phase 12: Between-Games Dashboard Verification Report

**Phase Goal:** When no Clippers game is active, the dashboard shows meaningful team trends, upcoming schedule, player summaries, and odds
**Verified:** 2026-03-07T02:01:00Z
**Status:** human_needed — all automated checks passed; 3 items require human visual confirmation
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth | Status | Evidence |
|----|-------|--------|----------|
| 1 | Home page loads at /home without error when no live game is active | ? HUMAN | RSC page exists at `app/home/page.tsx`, error boundary and null guard present; render requires live server |
| 2 | Five stat cards display Record, Last 10, Net Rating, Off Rating, Def Rating from live API data | ✓ VERIFIED | `TeamSnapshot.tsx` renders grid of 5 StatCards; API route returns all five fields in `team_snapshot` |
| 3 | No conference seed card (locked decision: omit entirely) | ✓ VERIFIED | `TeamSnapshot.tsx` has exactly 5 cards — Record, Last 10, Net Rtg, Off Rtg, Def Rtg — conference_seed not rendered |
| 4 | Next upcoming game appears as prominent hero card with opponent, date/time, home/away | ✓ VERIFIED | `NextGameHero.tsx` renders `vs {opponent_abbr}`, formatted date/time, Home/Away label; null state handled |
| 5 | Odds block on hero card appears only when game.odds is non-null | ✓ VERIFIED | `NextGameHero.tsx` line 45: `{game.odds !== null && (<div className="mt-4 flex gap-6">...)}` |
| 6 | Up to 4 additional upcoming games appear in schedule table below hero | ✓ VERIFIED | `page.tsx` passes `data.upcoming_schedule.slice(1, 5)` to `ScheduleTable`; rendered only when `length > 1` |
| 7 | Schedule table odds columns appear only when at least one game has odds; individual nulls show "—" | ✓ VERIFIED | `ScheduleTable.tsx` uses `hasAnyOdds(games)` to conditionally add spread/ml/ou columns; per-cell fallback `?? '—'` |
| 8 | Date/time formatting utilities pass unit tests | ✓ VERIFIED | `npx vitest run src/lib/home-utils.test.ts` — 8/8 tests green |
| 9 | Player trends table shows top players with Name, PPG, RPG, APG, TS%, L5 delta columns | ✓ VERIFIED | `PlayerTrendsTable.tsx` has 6 columns; TS% and L5 Δ always render "—" |
| 10 | Player name cells link to /players/{player_id} | ✓ VERIFIED | `PlayerTrendsTable.tsx` wraps each name in `<Link href={\`/players/${p.player_id}\`}>` |
| 11 | Rotating team insights tile displays at ~200px when insights exist; hidden when none | ✓ VERIFIED | `page.tsx` line 44-46: conditional `teamInsights.length > 0` guard + `<InsightTileArea className="h-[200px]">` |
| 12 | Last-10 point differential bar chart with per-bar coloring | ? HUMAN | `PointDiffChart.tsx` uses Recharts Cell with `var(--chart-2)` / `var(--chart-4)`; color rendering needs browser confirmation |

**Score:** 10/12 automated truths verified; 2 require human visual check (truths 1 and 12 overlap with human items)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/api/home/route.ts` | Extended with `last10_games` array and updated TypeScript types | ✓ VERIFIED | `Last10GameRow` interface, `last10GamesMapped` computed, `last10_games: last10GamesMapped` in `teamSnapshot` object at line 327 |
| `src/lib/home-utils.ts` | `formatGameDate`, `formatGameTime`, `hasAnyOdds` utilities | ✓ VERIFIED | All three functions present and substantive (42 lines) |
| `src/lib/home-utils.test.ts` | Unit tests for all three utilities | ✓ VERIFIED | 8 tests covering all specified behaviors; all green |
| `components/home/TeamSnapshot.tsx` | 5-card stat row | ✓ VERIFIED | Server Component, 39 lines, 5 StatCards rendered from props |
| `components/home/NextGameHero.tsx` | Prominent next-game card with conditional odds | ✓ VERIFIED | Server Component, 75 lines, conditional odds block, null state handled |
| `components/home/ScheduleTable.tsx` | Schedule table with conditional odds columns | ✓ VERIFIED | Client Component, 74 lines, BoxScoreTable wrapper, `hasAnyOdds` used |
| `components/home/PlayerTrendsTable.tsx` | 6-column player trends with linked names, TS% and L5 Δ always "—" | ✓ VERIFIED | Client Component, 51 lines, 6 columns confirmed, Link imports, both dash columns present |
| `components/home/PointDiffChart.tsx` | Recharts BarChart with Cell per-bar coloring | ✓ VERIFIED | Client Component, 60 lines, Cell used with CSS variable fills, custom tooltip |
| `app/home/page.tsx` | Complete home page with all 5 sections wired | ✓ VERIFIED | Async RSC, parallel fetches, all 5 sections in JSX, insights bug fixed (scope=between_games) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app/home/page.tsx` | `/api/home` | `await fetch(${baseUrl}/api/home)` in `getHomeData()` | ✓ WIRED | Line 10: fetch with `cache: 'no-store'`; response consumed via `data.*` throughout JSX |
| `app/home/page.tsx` | `/api/insights?scope=between_games` | `await fetch(...)` in `getTeamInsights()` | ✓ WIRED | Line 17: correct `scope=between_games` param (bug fixed from `scope=team`); `teamInsights` used in JSX |
| `components/home/ScheduleTable.tsx` | `hasAnyOdds` from `home-utils.ts` | Import + conditional odds column logic | ✓ WIRED | Line 8: import verified; line 32: `const anyOdds = hasAnyOdds(games)` used to gate columns |
| `app/home/page.tsx` | `components/home/PlayerTrendsTable.tsx` | `data.player_trends` prop | ✓ WIRED | Line 43: `<PlayerTrendsTable players={data.player_trends} />` |
| `app/home/page.tsx` | `components/live/InsightTileArea.tsx` | `teamInsights` prop with `className="h-[200px]"` | ✓ WIRED | Lines 5, 44-46: import and conditional render with height override confirmed |
| `app/home/page.tsx` | `components/home/PointDiffChart.tsx` | `data.team_snapshot.last10_games` prop | ✓ WIRED | Line 47: `<PointDiffChart games={data.team_snapshot.last10_games ?? []} />` |
| `src/app/api/home/route.ts` | `last10_games` in response | `last10GamesMapped` from extended `last10Rows` query | ✓ WIRED | Query joins `teams` for abbreviations (lines 143-162); mapped at lines 298-313; returned in `teamSnapshot` at line 327 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HOME-01 | 12-01-PLAN | Default dashboard displays when no Clippers game is active | ✓ SATISFIED | `app/home/page.tsx` is the default between-games dashboard; error boundary returns fallback UI |
| HOME-02 | 12-01-PLAN | Dashboard shows recent team performance trends | ✓ SATISFIED | `TeamSnapshot` (record, last 10, ratings) + `PointDiffChart` (last-10 point margin) |
| HOME-03 | 12-01-PLAN | Dashboard shows upcoming Clippers schedule | ✓ SATISFIED | `NextGameHero` + `ScheduleTable` rendering from `/api/home` upcoming_schedule |
| HOME-04 | 12-02-PLAN | Dashboard shows player trend summaries for top Clippers players | ✓ SATISFIED | `PlayerTrendsTable` with PPG/RPG/APG from `/api/home` player_trends; top 8 by minutes |
| HOME-05 | 12-02-PLAN | Dashboard shows rotating insights about team performance | ✓ SATISFIED | `InsightTileArea` at 200px height, guarded by `teamInsights.length > 0`, scope=between_games |
| HOME-06 | 12-01-PLAN | Dashboard shows Vegas odds for upcoming games when available | ✓ SATISFIED | `NextGameHero` conditional odds block + `ScheduleTable` conditional odds columns via `hasAnyOdds` |
| SCHED-01 | 12-01-PLAN | Schedule page shows upcoming Clippers games | ✓ SATISFIED | `ScheduleTable` + `NextGameHero` together show up to 5 upcoming games from `/api/home` |
| SCHED-02 | 12-01-PLAN | Schedule rows include opponent, date, time, and home/away | ✓ SATISFIED | `ScheduleTable` columns: Opponent, Date, Time, H/A — all rendered via `formatGameDate`/`formatGameTime` |

**All 8 requirement IDs accounted for. No orphaned requirements.**

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `components/home/ScheduleTable.tsx` | 30 | `return null` on empty games | INFO | Intentional guard, not a stub — correct behavior |
| `components/home/PlayerTrendsTable.tsx` | 14 | `return null` on empty players | INFO | Intentional guard, not a stub — correct behavior |
| `components/home/PointDiffChart.tsx` | 35 | `return null` on empty games | INFO | Intentional guard, not a stub — correct behavior |

**No blockers. No warnings. All `return null` instances are legitimate empty-state guards.**

---

### Human Verification Required

### 1. Full Dashboard Render at /home

**Test:** Start the dev server (`npm run dev`) and open `http://localhost:3000/home`
**Expected:** All five sections render without error: (1) 5-card TeamSnapshot row, (2) NextGameHero card with formatted date/time/location, (3) ScheduleTable with up to 4 rows below hero, (4) PlayerTrendsTable with 6 columns where TS% and L5 Δ show "—", (5) PointDiffChart bars visible
**Why human:** RSC async rendering, real DB data, and React hydration cannot be verified without a running server

### 2. Point Differential Chart Color Coding

**Test:** With the dev server running, scroll to the Last 10 Games chart on /home and hover bars
**Expected:** Winning-margin bars render in emerald/green; losing-margin bars render in red. Tooltip shows opponent abbreviation and signed margin value (e.g., "+12" or "-7")
**Why human:** CSS variable resolution in Recharts SVG Cell elements (`var(--chart-2)`, `var(--chart-4)`) requires browser rendering

### 3. Player Name Links and Hover State

**Test:** In the Player Trends Table, hover over a player name then click one
**Expected:** Cursor changes to pointer on hover, text lightens slightly (hover:text-foreground/80), and click navigates to `/players/{id}`
**Why human:** CSS hover transitions and Next.js Link navigation require browser interaction

---

### Automated Checks Passed

- `npx vitest run src/lib/home-utils.test.ts` — **8/8 tests green**
- `npx tsc --noEmit` — **zero TypeScript errors**
- All documented commit hashes verified in git log: `4939b15`, `e42acd5`, `ec2dc8b`, `bf1e62b`, `8ca176d`, `37eafd7`, `376a7ea`
- Insights scope bug (`scope=team` → `scope=between_games`) confirmed fixed in commit `376a7ea`
- `last10_games` typed correctly in route — no `as any` casts needed in page.tsx

---

### Gaps Summary

No gaps found. All automated must-haves are verified. The three human verification items are visual/behavioral checks that cannot be confirmed programmatically — they require a browser with the dev server running and real database data. The implementation is structurally complete and correct.

---

_Verified: 2026-03-07T02:01:00Z_
_Verifier: Claude (gsd-verifier)_
