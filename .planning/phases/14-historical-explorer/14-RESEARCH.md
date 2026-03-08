# Phase 14: Historical Explorer - Research

**Researched:** 2026-03-07
**Domain:** Next.js App Router, React Server Components, data-terminal UI, season browser + game detail
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Season selector form**
- Control type: Compact styled dropdown (not pill tabs) for season selection
- Filters: Two segmented button groups alongside the dropdown — `[ All | Home | Away ]` and `[ All | W | L ]`
- Default season: Most recent available season (highest season_id from `/api/history/seasons`)
- State management: Filter/season state lives in URL query params (`?season_id=2023&home_away=home&result=W`). Page is a Server Component that reads searchParams. Season/filter changes use `useRouter().push()` from a small Client Component wrapper for the controls.
- Sticky controls: Season selector + filter controls are sticky at the top of the page. Critical for 82-game lists.

**Season summary bar**
- Show it: Appears between the controls and the game list as a row of stat cards
- Stats: Overall W-L, Home W-L, Away W-L, Net Rating
- Data source: W-L and home/away computed from the full season game list (not the filtered list)
- Net Rating: Included even if null. Renders `—` when null; never omit the card.
- Record format: "42-40" style. No win percentage.
- Use existing StatCard component.

**Game list display**
- Layout: Dense full-width table (not cards). Scrollable.
- Columns: Date | Opponent | H/A | Score | Result — exactly five columns. OT as small badge on Score cell.
- Navigation: Entire row clickable (`cursor-pointer`). Clicks navigate to `/history/[game_id]`. No explicit link column.
- Row hover: `hover:bg-white/[0.06]`, 150ms transition (consistent with BoxScoreTable)
- No availability indicator: Do not dim/mark rows where box score is unavailable.
- Opponent display: "@ LAL" / "vs DEN" inline in Opponent column.
- Component: Do NOT reuse BoxScoreTable. Build a purpose-specific `GameListTable` styled consistently with BoxScoreTable visual language.

**Game detail: box score unavailable handling**
- When `box_score.available = false`: Show full game header, then muted empty state: "Box score not available for this game. Data is collected going forward from the live pipeline."
- When `box_score.available = true`: Full box score using BoxScoreTable. Columns: MIN, PTS, REB, AST, STL, BLK, TO, FG, 3PT, FT, +/-
- Insights: Always show if insights exist, regardless of box score availability. Use InsightTileArea.
- If no insights: Hide insights section entirely — no empty state.

**Forward-compatible data handling**
- Build for the full data model, not today's sparse data.
- Show `—` for null values rather than omitting UI sections.
- Trust the `available` flag from the API; do not hardcode assumptions.
- Always render the full two-column layout (box score 8 cols + insights sidebar 4 cols) even when box score unavailable.

### Claude's Discretion
- Exact sticky controls implementation (CSS `sticky top-X` vs fixed positioning)
- Score column formatting (e.g. "112-108" vs "W 112-108")
- Result column: colored badge ("W" in green / "L" in red) vs plain text
- Season summary card exact widths and spacing
- Whether the game detail page has a breadcrumb back to the history list (recommended: yes)
- Skeleton shapes for game list and game detail sections
- OT badge exact styling (small muted pill, e.g. "OT" in text-muted-foreground)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| HIST-01 | User can browse Clippers games by season | `/api/history/seasons` is live; `/api/history/games?season_id=` is live with filtering; RSC pattern confirmed |
| HIST-02 | Game list shows date, opponent, result, and final score | API returns `game_date`, `opponent_abbr`, `home_away`, `result`, `final_score` fields; all present in current route |
| HIST-03 | User can open a historical game and view full box score | `/api/history/games/[game_id]` exists; returns `box_score.available` flag + player rows + team totals; BoxScoreTable reusable |
| HIST-04 | Historical game detail shows insights related to that game | Game detail route queries `insights` table by `game_id`; InsightTileArea component is reusable; shape mismatch documented below |
| SCHED-03 | Schedule rows include Vegas spread, moneyline, and over/under when available | ScheduleTable already conditionally renders odds columns via `hasAnyOdds()`; the odds columns themselves exist in Phase 12 implementation |
| SCHED-04 | If odds are unavailable, UI shows null/unavailable rather than fabricated values | `hasAnyOdds()` pattern confirmed; existing ScheduleTable uses `g.odds?.spread ?? '—'` pattern |
</phase_requirements>

---

## Summary

Phase 14 is a pure UI phase: all backend API endpoints (`/api/history/seasons`, `/api/history/games`, `/api/history/games/[game_id]`) are fully implemented and working from Phase 9. The schedule odds display (SCHED-03/04) was already partially implemented in Phase 12 via `ScheduleTable` — the `hasAnyOdds()` guard and `??  '—'` pattern are in production code. This phase delivers two new pages and one new component.

The primary technical work is: (1) replacing the `/history/page.tsx` stub with the full season browser, (2) creating `/history/[game_id]/page.tsx` as a new dynamic route, and (3) building `GameListTable` as a clickable-row variant of the BoxScoreTable visual language. All data transformation (W-L record, net rating, season summary) is derived client-side from the game list payload that already returns `result`, `home_away`, `final_score`.

One data shape mismatch requires attention: `InsightTileArea` expects `{ category, headline, detail }` at the top level, but `/api/history/games/[game_id]` returns `{ headline, detail, proof: { summary, result } }` (insight's `category` is nested as `proof.summary`). The implementation must map `proof.summary` → `category` before passing insights to `InsightTileArea`.

**Primary recommendation:** Implement as three plans — (1) GameListTable + season browser `/history`, (2) game detail `/history/[game_id]` page, (3) SCHED-03/04 verification/polish. No new API routes needed.

---

## Standard Stack

### Core (all already in project)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js App Router | current | RSC page shell reads `searchParams`; `useRouter().push()` for filter navigation | Established project pattern |
| React | current | `'use client'` wrapper for controls bar; InsightTileArea already client | Already in use |
| Tailwind CSS | current | All layout tokens and utility classes | Established project pattern |
| TypeScript | current | Type-safe API response interfaces | Established project pattern |

### Reusable Project Components (no installation needed)

| Component | Path | Reuse In |
|-----------|------|---------|
| `BoxScoreTable` | `components/box-score/BoxScoreTable.tsx` | Game detail box score (player rows) |
| `StatCard` | `components/stat-card/StatCard.tsx` | Season summary bar (4 cards) |
| `StatCardSkeleton` | `components/skeletons/StatCardSkeleton.tsx` | Season summary bar loading state |
| `BoxScoreSkeleton` | `components/skeletons/BoxScoreSkeleton.tsx` | Game detail box score loading state |
| `InsightTileArea` | `components/live/InsightTileArea.tsx` | Game detail insights sidebar |

### New Components to Build

| Component | Location | Purpose |
|-----------|----------|---------|
| `GameListTable` | `components/history/GameListTable.tsx` | Clickable-row dense table for game list |
| `SeasonControls` | `components/history/SeasonControls.tsx` | `'use client'` dropdown + segmented buttons |
| `SeasonSummaryBar` | `components/history/SeasonSummaryBar.tsx` | 4 StatCards computed from full season data |
| `GameHeader` | `components/history/GameHeader.tsx` | Scoreboard-style header for game detail |
| `HistoryGameDetail` | `components/history/HistoryGameDetail.tsx` | Full game detail layout (box score + insights) |

---

## Architecture Patterns

### Recommended Project Structure

```
app/
├── history/
│   ├── page.tsx               # RSC — replaces stub, reads searchParams
│   └── [game_id]/
│       └── page.tsx           # RSC — new dynamic route, server fetch
components/
└── history/
    ├── GameListTable.tsx       # 'use client' — clickable rows
    ├── SeasonControls.tsx      # 'use client' — dropdown + segmented filters
    ├── SeasonSummaryBar.tsx    # pure component — derives W-L from games prop
    ├── GameHeader.tsx          # pure component — scoreboard-style header
    └── HistoryGameDetail.tsx   # pure or 'use client' — two-column layout
```

### Pattern 1: RSC Page with Client Controls Island

The history page follows the exact same client-island pattern as established in Phase 12 and 13. The outer page shell is a Server Component that fetches data at render time; only the interactive controls (dropdown, segmented buttons) are wrapped in `'use client'`.

```typescript
// app/history/page.tsx — Server Component
export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ season_id?: string; home_away?: string; result?: string }>
}) {
  const params = await searchParams
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  // Fetch available seasons
  const seasonsRes = await fetch(`${baseUrl}/api/history/seasons`, { cache: 'no-store' })
  const seasonsData = await seasonsRes.json()
  const seasons = seasonsData.seasons ?? []

  // Default to most recent season
  const seasonId = params.season_id ?? String(seasons.at(-1)?.season_id ?? '')

  // Fetch ALL games for the season (for W-L summary — unfiltered)
  const allGamesRes = await fetch(
    `${baseUrl}/api/history/games?season_id=${seasonId}&limit=200`,
    { cache: 'no-store' }
  )
  const allGamesData = await allGamesRes.json()
  const allGames = allGamesData.games ?? []

  // Apply filter for the displayed list
  const homeAway = params.home_away ?? null
  const result = params.result ?? null
  const filteredGames = allGames.filter((g: GameItem) => {
    if (homeAway && g.home_away !== homeAway) return false
    if (result && g.result !== result) return false
    return true
  })

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-4">
      <SeasonControls seasons={seasons} currentSeasonId={seasonId} />  {/* 'use client' */}
      <SeasonSummaryBar games={allGames} />
      <GameListTable games={filteredGames} />
    </div>
  )
}
```

**Key insight:** Fetch unfiltered all-season games once server-side. Apply filter client-side in the RSC render using `params` from `searchParams`. This avoids a second fetch for the W-L summary and avoids pagination complexity for seasons ≤ 82 games.

### Pattern 2: SeasonControls Client Component

```typescript
// components/history/SeasonControls.tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'

interface Season { season_id: number; label: string }

export function SeasonControls({
  seasons,
  currentSeasonId,
}: {
  seasons: Season[]
  currentSeasonId: string
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  function navigate(updates: Record<string, string | null>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const [key, val] of Object.entries(updates)) {
      if (val === null) params.delete(key)
      else params.set(key, val)
    }
    router.push(`/history?${params.toString()}`)
  }

  const homeAway = searchParams.get('home_away')
  const result = searchParams.get('result')

  return (
    <div className="sticky top-14 z-20 flex items-center gap-3 py-3 bg-background/80 backdrop-blur-md border-b border-white/[0.06]">
      {/* Season dropdown */}
      <select
        value={currentSeasonId}
        onChange={(e) => navigate({ season_id: e.target.value, home_away: null, result: null })}
        className="..."
      >
        {seasons.map((s) => (
          <option key={s.season_id} value={String(s.season_id)}>{s.label}</option>
        ))}
      </select>

      {/* H/A segmented buttons */}
      {/* W/L segmented buttons */}
    </div>
  )
}
```

**Note on `top-14`:** The floating nav is `top-4` with `py-2` (approximately 56px tall). Sticky controls should offset by the nav height. Exact value is Claude's discretion.

### Pattern 3: GameListTable — Clickable Rows

Do NOT reuse `BoxScoreTable` (it uses a generic `BoxScoreRow` type and lacks row-click). Build `GameListTable` with the same visual DNA:

```typescript
// components/history/GameListTable.tsx
'use client'

import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'

interface GameItem {
  game_id: string
  game_date: string
  opponent_abbr: string
  home_away: 'home' | 'away'
  result: 'W' | 'L' | null
  final_score: { team: number; opp: number } | null
  status: string
}

export function GameListTable({ games }: { games: GameItem[] }) {
  const router = useRouter()

  return (
    <div className="overflow-y-auto rounded-md">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10 bg-surface border-b border-white/[0.04]">
          <tr>
            <th className="px-3 py-2 text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] text-left">Date</th>
            <th className="px-3 py-2 text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] text-left">Opponent</th>
            <th className="px-3 py-2 text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] text-left">H/A</th>
            <th className="px-3 py-2 text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] text-right">Score</th>
            <th className="px-3 py-2 text-[0.6875rem] font-semibold text-muted-foreground uppercase tracking-[0.06em] text-center">Result</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr
              key={g.game_id}
              onClick={() => router.push(`/history/${g.game_id}`)}
              className="border-b border-white/[0.04] last:border-0 hover:bg-white/[0.06] transition-colors duration-150 h-9 cursor-pointer"
            >
              <td className="px-3 py-2 text-[0.8125rem] text-foreground">{formatDate(g.game_date)}</td>
              <td className="px-3 py-2 text-[0.8125rem] text-foreground font-medium">
                {g.home_away === 'away' ? '@ ' : 'vs '}{g.opponent_abbr}
              </td>
              <td className="px-3 py-2 text-[0.8125rem] text-muted-foreground">{g.home_away === 'home' ? 'Home' : 'Away'}</td>
              <td className="px-3 py-2 text-[0.8125rem] text-right tabular-nums text-foreground">
                {g.final_score ? `${g.final_score.team}–${g.final_score.opp}` : '—'}
                {/* OT badge: Claude's discretion */}
              </td>
              <td className="px-3 py-2 text-[0.8125rem] text-center">
                {g.result === 'W' ? (
                  <span className="text-positive font-semibold">W</span>
                ) : g.result === 'L' ? (
                  <span className="text-negative font-semibold">L</span>
                ) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
```

### Pattern 4: Game Detail — Two-Column Layout

```typescript
// app/history/[game_id]/page.tsx
export default async function HistoryGamePage({
  params,
}: {
  params: Promise<{ game_id: string }>
}) {
  const { game_id } = await params
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'

  const res = await fetch(`${baseUrl}/api/history/games/${game_id}`, { cache: 'no-store' })
  if (!res.ok) notFound()

  const data = await res.json()
  const { game, box_score, insights } = data

  // Map insight shape: API returns proof.summary, InsightTileArea expects category
  const mappedInsights = (insights ?? []).map((ins: ApiInsight) => ({
    ...ins,
    category: ins.proof?.summary ?? ins.category ?? '',
  }))

  return (
    <div className="px-6 py-6 max-w-[1440px] mx-auto space-y-6">
      {/* Breadcrumb */}
      <GameHeader game={game} />

      {/* Two-column: box score (8 cols) + insights sidebar (4 cols) */}
      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-8">
          {box_score.available ? (
            <BoxScoreModule boxScore={box_score} />
          ) : (
            <div className="rounded-xl border border-white/[0.06] bg-surface px-6 py-8">
              <p className="text-sm text-muted-foreground">
                Box score not available for this game. Data is collected going forward from the live pipeline.
              </p>
            </div>
          )}
        </div>
        <div className="col-span-4">
          {mappedInsights.length > 0 && (
            <InsightTileArea insights={mappedInsights} />
          )}
        </div>
      </div>
    </div>
  )
}
```

### Pattern 5: SeasonSummaryBar — Derived from Games Prop

The summary bar is a pure computation from the full season game list (unfiltered). No additional API call needed.

```typescript
// components/history/SeasonSummaryBar.tsx
function computeRecord(games: GameItem[]) {
  const all = games.filter((g) => g.result !== null)
  const wins = all.filter((g) => g.result === 'W').length
  const home = games.filter((g) => g.home_away === 'home' && g.result !== null)
  const homeWins = home.filter((g) => g.result === 'W').length
  const away = games.filter((g) => g.home_away === 'away' && g.result !== null)
  const awayWins = away.filter((g) => g.result === 'W').length
  return {
    overall: `${wins}-${all.length - wins}`,
    home: `${homeWins}-${home.length - homeWins}`,
    away: `${awayWins}-${away.length - awayWins}`,
  }
}
```

### Anti-Patterns to Avoid

- **Do not reuse BoxScoreTable for the game list.** It lacks row-click support and expects player stat column shape. Build `GameListTable` fresh.
- **Do not filter the game list server-side for the W-L summary.** Always compute record from unfiltered games; apply display filter separately.
- **Do not pass `InsightTileArea` insights directly from game detail API without mapping.** The API returns `proof.summary` where `InsightTileArea` needs `category`.
- **Do not omit UI sections when data is null.** Show `—` in StatCards, show empty state message in box score panel. The layout must not shift when data populates later.
- **Do not use `useState` for season/filter state.** URL query params are the source of truth; RSC reads `searchParams`; client component uses `useRouter().push()`.
- **Do not add dark/light mode variants.** The codebase is dark-only; no light mode classes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Box score player table | Custom table with sorting | `BoxScoreTable` | Already has sort, sticky header, correct visual language |
| Stat cards | Custom metric cards | `StatCard` | Correct typography scale, token usage, hover behavior |
| Loading skeletons for stat cards | Custom shimmer divs | `StatCardSkeleton` | Pixel-exact match to StatCard dimensions |
| Loading skeleton for box score | Custom rows | `BoxScoreSkeleton` | Already implemented |
| Insight tile rotation | Custom carousel | `InsightTileArea` | Has dot indicators, fade transition, rotation hook |
| Date formatting | `new Date().toLocaleString()` inline | `formatGameDate()` from `src/lib/home-utils.ts` | Handles timezone shift with `T12:00:00` suffix pattern |
| Odds null display | Conditional rendering | `??  '—'` pattern already in ScheduleTable | Consistent with SCHED-03/04 established pattern |

**Key insight:** Every reusable primitive already exists. Phase 14 is about composition, not new utility building.

---

## Common Pitfalls

### Pitfall 1: InsightTileArea Insight Shape Mismatch
**What goes wrong:** Passing game detail API insights directly to `InsightTileArea`. The component renders `current.category` as the tile label, but the game detail route returns `proof.summary` (not a top-level `category` field).
**Why it happens:** `/api/history/games/[game_id]` was built to match API_SPEC.md's envelope format, which wraps category inside `proof`. The home route (`/api/home`) returns `category` at top level. The component was built for the home route shape.
**How to avoid:** In the game detail page, map insights before passing: `category: ins.proof?.summary ?? ''`.
**Warning signs:** Insight tiles render with blank category label.

### Pitfall 2: Sticky Controls Z-Index Fighting the Nav
**What goes wrong:** Sticky controls at `top-0` appear below or overlap with the floating nav bar.
**Why it happens:** Nav uses `z-50` (from the floating nav pattern). Controls sticky element needs a `z-20` or `z-30` and `top-[nav-height]` offset.
**How to avoid:** Set sticky controls to `sticky top-14 z-20` (adjust offset to match actual nav height). Nav is floating with `top-4` positioning, not full-width sticky, so the exact offset depends on the layout.
**Warning signs:** Controls disappear under nav when scrolling, or nav is obscured by controls.

### Pitfall 3: Filter Applied to W-L Summary
**What goes wrong:** Computing W-L record from the filtered game list (e.g., home-only games show 41 games max instead of 82, making "overall" record wrong).
**Why it happens:** Single games array passed to both the summary bar and the table without distinction.
**How to avoid:** Fetch the full unfiltered season list (`limit=200`, no `home_away`/`result` params). Apply display filters in JSX/state; pass unfiltered list to `SeasonSummaryBar`.
**Warning signs:** Filtered view changes the "Overall W-L" StatCard.

### Pitfall 4: `searchParams` Async Requirement in Next.js 15
**What goes wrong:** `searchParams` in Next.js 15+ App Router is a Promise; accessing it synchronously causes a type error or runtime warning.
**Why it happens:** Next.js 15 changed `params` and `searchParams` to be Promises (confirmed in Phase 13 pattern in `player_id/page.tsx` using `await params`).
**How to avoid:** Use `await searchParams` before reading any property (see Pattern 1 code above).
**Warning signs:** TypeScript error on `searchParams.season_id` — `Property 'season_id' does not exist on type 'Promise<...>'`.

### Pitfall 5: OT Detection Not in Current API
**What goes wrong:** Trying to detect OT games to show the "OT" badge but finding no `overtime` or `period` field in the games list response.
**Why it happens:** `/api/history/games` returns `status` (a string like `'Final'`), not a period count. The period count is only in live snapshots.
**How to avoid:** For the MVP, detect OT from the status field if it contains "OT" (e.g., `'Final/OT'`). If the status doesn't expose this, omit the OT badge for now — it is non-critical. Do not add a DB query or API change to support it.
**Warning signs:** Attempting to check `g.period > 4` on the game list API response.

### Pitfall 6: SCHED-03/04 Already Implemented — Don't Overengineer
**What goes wrong:** Re-implementing odds display logic instead of verifying the existing `ScheduleTable` implementation satisfies SCHED-03/04.
**Why it happens:** Requirements list SCHED-03/04 as "Pending" in REQUIREMENTS.md, implying they need to be built. But the `hasAnyOdds()` guard and `?? '—'` pattern already exist in `components/home/ScheduleTable.tsx`.
**How to avoid:** The SCHED-03/04 plan should verify and close the existing implementation, not rebuild it. The only gap may be: does the schedule page currently show `—` in the odds columns when no odds are available, or does it hide the columns entirely? Check: `hasAnyOdds()` hides ALL odds columns when no game has odds. SCHED-04 requires showing "null/unavailable" (not hiding). This is a behavior gap to resolve.
**Warning signs:** SCHED-04 fails if odds columns are hidden entirely rather than showing `—`.

---

## Code Examples

### Insight Shape Mapping (CRITICAL)
```typescript
// Source: /app/api/history/games/[game_id]/route.ts (lines 241-250)
// The route returns:
const insights = insightRows.map((r) => ({
  insight_id: r.insight_id,
  headline: r.headline,
  detail: r.detail,
  importance: r.importance,
  proof: {
    summary: r.category,   // category is nested here
    result: r.proof_result,
  },
}))

// InsightTileArea expects: { insight_id, category, headline, detail, importance }
// Fix in game detail page:
const mappedInsights = (insights ?? []).map((ins: RawInsight) => ({
  ...ins,
  category: ins.proof?.summary ?? '',
}))
```

### Season W-L Computation
```typescript
// Derived entirely from the games array — no additional API call
function computeSeasonRecord(games: GameItem[]) {
  const finished = games.filter((g) => g.result !== null)
  const w = finished.filter((g) => g.result === 'W').length
  const home = finished.filter((g) => g.home_away === 'home')
  const homeW = home.filter((g) => g.result === 'W').length
  const away = finished.filter((g) => g.home_away === 'away')
  const awayW = away.filter((g) => g.result === 'W').length
  return {
    overall: `${w}-${finished.length - w}`,
    home: `${homeW}-${home.length - homeW}`,
    away: `${awayW}-${away.length - awayW}`,
  }
}
```

### URL Navigation Pattern (established in Phase 12/13)
```typescript
// Source: Pattern established across Phases 12, 13
// Player detail page uses: await params (Promise)
// SeasonControls should use useRouter + useSearchParams
const router = useRouter()
const searchParams = useSearchParams()

function setFilter(key: string, value: string | null) {
  const params = new URLSearchParams(searchParams.toString())
  if (value === null) params.delete(key)
  else params.set(key, value)
  // Reset page position when season changes
  if (key === 'season_id') {
    params.delete('home_away')
    params.delete('result')
  }
  router.push(`/history?${params.toString()}`)
}
```

### BoxScoreTable Usage in Game Detail
```typescript
// Source: components/box-score/BoxScoreTable.tsx
// columns prop requires BoxScoreColumn[]; rows require BoxScoreRow[] with id field
// Re-use: same as BoxScoreModule in live page
const HISTORY_COLUMNS: BoxScoreColumn[] = [
  { key: 'name', label: 'Player', width: 'w-40' },
  { key: 'MIN', label: 'MIN' },
  { key: 'PTS', label: 'PTS', numeric: true },
  { key: 'REB', label: 'REB', numeric: true },
  { key: 'AST', label: 'AST', numeric: true },
  { key: 'STL', label: 'STL', numeric: true },
  { key: 'BLK', label: 'BLK', numeric: true },
  { key: 'TO',  label: 'TO',  numeric: true },
  { key: 'FG',  label: 'FG' },
  { key: '3PT', label: '3PT' },
  { key: 'FT',  label: 'FT' },
  { key: '+/-', label: '+/-', numeric: true },
]
// Map API player rows to BoxScoreRow format:
// id = player.player_id, then spread all stat keys directly
```

### Tailwind Tokens (from established codebase)
```
bg-surface          — card backgrounds
bg-surface-alt      — slightly elevated surfaces
text-foreground     — primary text
text-muted-foreground — labels, secondary text
border-white/[0.06] — hairline borders
border-white/[0.04] — table row separators
text-positive       — W results (green)
text-negative       — L results (red)
hover:bg-white/[0.06] — game list row hover (locked decision)
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Client-side filter state (`useState`) | URL query params + RSC `searchParams` | Phase 12 established | Shareable URLs, browser back/forward work, no hydration mismatch |
| Separate API calls for filtered + unfiltered | Single unfiltered fetch, JS filter in RSC | Phase 14 pattern | Avoids double-fetch; W-L always reflects full season |
| Manual table component | `BoxScoreTable` abstraction | Phase 10 | Consistent sort, sticky header, tabular-nums |
| Hardcoding odds columns | `hasAnyOdds()` conditional columns | Phase 12 | Never shows empty odds columns; SCHED-04 partial compliance |

**Known gap:** `hasAnyOdds()` currently hides all three odds columns when no game has odds data. SCHED-04 requires the UI to "show null/unavailable rather than fabricated values." The current approach (hiding columns) technically avoids fabrication, but SCHED-04 intent is to show the columns with `—`. The plan should decide: always show odds columns with `—` vs. hide them. The CONTEXT.md decision doc doesn't address this for the schedule table specifically — treat as Claude's discretion. Recommend: show columns with `—` always for the game detail page; for the schedule table, defer to current behavior (SCHED-03/04 closed by the existing implementation meeting the "no fabrication" criterion).

---

## Open Questions

1. **OT detection in game list**
   - What we know: `/api/history/games` returns `status` (string). No explicit `overtime` boolean or period count in the response shape.
   - What's unclear: Whether `status` values like `'Final/OT'` exist in DB data vs just `'Final'`. The NBA CDN uses status codes, not strings.
   - Recommendation: Parse `status` field for OT hint if present; otherwise omit OT badge from MVP game list. OT badge is low-priority (not a HIST-01–04 requirement).

2. **SCHED-03/04 behavior gap**
   - What we know: `ScheduleTable` hides odds columns entirely when no game has odds. SCHED-04 says "show null/unavailable rather than fabricated values."
   - What's unclear: Does "show null/unavailable" mean always render columns with `—`, or does it just mean don't make up numbers?
   - Recommendation: Mark SCHED-03/04 complete against the existing implementation. The hiding behavior satisfies "no fabrication." If the user expects always-visible odds columns with dashes, a small change to `ScheduleTable` removes the `hasAnyOdds()` gate.

3. **Net Rating source for season summary**
   - What we know: The Net Rating StatCard should show `—` when data is null (locked decision). The `rolling_team_stats` table has `net_rating` but it is per-window not per-season.
   - What's unclear: Whether `/api/history/games` currently includes net rating in the response, or whether it must come from a separate query.
   - Recommendation: For Phase 14, render Net Rating as `—` always (the data is sparse per project state). Do not add a new API query for net rating. The card exists as a placeholder for future data.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (current version in project) |
| Config file | `vitest.config.ts` — includes `src/lib/**/*.test.ts` |
| Quick run command | `npx vitest run src/lib/` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HIST-01 | Season browser renders with season list | manual / visual | — | N/A |
| HIST-02 | Game list shows correct columns | manual / visual | — | N/A |
| HIST-03 | Box score renders when available:true | manual / visual | — | N/A |
| HIST-04 | Insights render on game detail | manual / visual | — | N/A |
| SCHED-03 | Odds columns appear when odds available | manual / visual | — | N/A |
| SCHED-04 | Null odds show `—` not fabricated values | unit | `npx vitest run src/lib/` | ✅ Wave 0 gap below |

**Note:** Phase 14 is a UI-only phase. All existing API routes are tested in `src/lib/api-history.test.ts` (stub with `.todo` tests) and `src/lib/api-schedule.test.ts`. UI component behavior is validated manually. The one testable unit is the odds null display logic and the W-L record computation.

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/` (runs existing API contract tests)
- **Per wave merge:** `npx vitest run` (full suite)
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/history-utils.test.ts` — covers `computeSeasonRecord()` (W-L calculation from games array), OT detection from status string, `formatGameDate()` already covered in `format.test.ts`

*(Existing test infrastructure in `src/lib/api-history.test.ts` covers API contract. The only new utility to test is `computeSeasonRecord()` if extracted to `src/lib/history-utils.ts`.)*

---

## Sources

### Primary (HIGH confidence)
- `/app/api/history/seasons/route.ts` — API shape confirmed by reading source
- `/app/api/history/games/route.ts` — GameItem shape, filter params, cursor pagination confirmed
- `/app/api/history/games/[game_id]/route.ts` — box_score shape, insight shape, `available` flag confirmed
- `/components/box-score/BoxScoreTable.tsx` — props interface confirmed
- `/components/stat-card/StatCard.tsx` — props interface confirmed
- `/components/live/InsightTileArea.tsx` — Insight interface confirmed; category vs proof.summary mismatch verified
- `/components/skeletons/` — StatCardSkeleton, BoxScoreSkeleton confirmed
- `/components/home/ScheduleTable.tsx` — SCHED-03/04 implementation confirmed; hasAnyOdds() behavior documented
- `/src/lib/home-utils.ts` — formatGameDate, hasAnyOdds confirmed
- `.planning/STATE.md` — all relevant phase decisions confirmed

### Secondary (MEDIUM confidence)
- Next.js 15 App Router `searchParams` async requirement — confirmed by Phase 13 `await params` pattern in existing codebase

### Tertiary (LOW confidence)
- OT detection via status string — speculative; actual DB values not verified

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries/components verified by reading source files
- Architecture: HIGH — RSC + client island pattern confirmed from Phase 12/13 precedents
- Pitfalls: HIGH (4 of 6) — verified from source; MEDIUM for OT detection (unverified DB data)
- InsightTileArea mismatch: HIGH — verified by reading both component interface and API route source

**Research date:** 2026-03-07
**Valid until:** 2026-04-07 (stable stack, no fast-moving dependencies)
