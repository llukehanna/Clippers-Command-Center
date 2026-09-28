# Premium UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the CCC front end with the approved hybrid design system and rebuilt pages: responsive, with logos, headshots, ⌘K, live polish, schedule intelligence and PWA.

**Architecture:** New tokens and fonts in `app/globals.css` + `app/layout.tsx`. A small primitive set in `components/ui/`. Pure presentation helpers in `src/lib/ui/` (unit-tested). Pages rebuilt one at a time on top of those. API routes are untouched; pages keep fetching the same endpoints.

**Tech Stack:** Next.js 16 App Router, React 19, Tailwind v4 (CSS-first `@theme`), Recharts 3, SWR, Radix (via `radix-ui`), `cmdk` (new), Vitest.

**Spec:** `docs/superpowers/specs/2026-09-27-premium-ui-redesign-design.md`
**Visual reference (exact CSS values):** `docs/superpowers/specs/2026-09-27-premium-ui-direction.html`

## Global Constraints

- Do not modify `app/api/**`, `scripts/**`, existing `src/lib/*.ts`, or the DB schema.
- The only new dependency is `cmdk`.
- Dark-only. Fonts are Geist + Geist Mono via `next/font/google`; Inter is removed.
- Ember red (`--live`) is used only for live-game state.
- All times are shown in `America/Los_Angeles`.
- Must work at 390px wide; the body never scrolls horizontally, and wide tables scroll inside their own container.
- Every animation respects `prefers-reduced-motion`.
- Numbers use `tabular-nums`.
- Pages fetch via `process.env.NEXT_PUBLIC_BASE_URL ?? 'http://localhost:3000'` (existing pattern).
- Tests: `npm test`, lint: `npm run lint`, types: `npx tsc --noEmit`, build: `npm run build`.

---

## File structure

```
app/
  globals.css                 REWRITE  tokens, base, utilities
  layout.tsx                  REWRITE  fonts, shell, metadata, viewport
  manifest.ts                 NEW      PWA manifest
  icon.tsx, apple-icon.tsx    NEW      generated LAC tile icons (next/og)
  home/page.tsx               REWRITE
  live/page.tsx               REWRITE  thin wrapper → components/live/LiveView
  dev/live/page.tsx           NEW      fixture-driven LiveView (404 in prod)
  players/page.tsx            REWRITE
  players/[player_id]/page.tsx REWRITE
  schedule/page.tsx           REWRITE
  history/page.tsx            REWRITE
  history/[game_id]/page.tsx  REWRITE
components/
  ui/  panel, eyebrow, stat, team-mark, player-avatar, segmented, chip,
       data-table, empty-state, skeleton, status-dot, page-header      NEW
       (delete: surface, card, nav-link-capsule, badge, button?, table, tooltip if unused)
  shell/ TopBar, NavLinks, LiveStatus, CommandPalette, PageEnter        NEW
  insights/ InsightCard, InsightRotator                                 NEW
  charts/ chart-theme.tsx, LineChartWrapper (restyle), DivergingBars    
  game/ NextGamePanel, Countdown, OddsStrip, Scoreboard, BoxScore,
        UpNextList, WinProbabilityBar                                   NEW
  home/ SeasonPanel, LastTenPanel, PlayerLeaders                        REWRITE
  live/ LiveView, KeyMetrics, StickyScore, LiveTabTitle, IdleState      REWRITE
  players/ RosterView, PlayerHero, TrendChart, SplitsPanel, GameLog     REWRITE
  schedule/ ScheduleList                                                NEW
  history/ HistoryControls, SeasonSummary, SeasonStrip, GameList        REWRITE
hooks/ useLiveData (typed), useInsightRotation (keep), useNow           
src/lib/ui/ odds.ts, schedule.ts, season.ts, live.ts, headshot.ts (+ .test.ts)  NEW
src/lib/ui/types.ts          NEW  typed API payload shapes used by the UI
public/favicon-live.svg, public/favicon.svg                             NEW
```

---

### Task 1: Foundation: tokens, fonts, shell container, config

**Files:**
- Rewrite: `app/globals.css`, `app/layout.tsx`
- Modify: `next.config.ts` (images.remotePatterns for `cdn.nba.com`), `.gitignore` (`.playwright-mcp/`)
- Delete: `app/favicon.ico` only if replaced by `app/icon.tsx` in Task 10 (not here)

**Interfaces:**
- Produces CSS tokens:
  - Colors: `--ink-0..3`, `--line`, `--line-2`, `--text`, `--mute`, `--dim`, `--naval`, `--pacific`, `--live`, `--pos`, `--neg`, `--warn`.
  - Tailwind color utilities: `bg-ink-1`, `text-mute`, `border-line`, `text-pacific`, `bg-live` and the rest of the set.
  - Font utilities: `font-sans` (Geist) and `font-mono` (Geist Mono).
  - Easing: `ease-premium`.
- Produces utility classes:
  - `.panel`, `.panel-inset`, `.eyebrow`, `.label-mono`.
  - `.page` (container plus 22px/14px gutter).
  - `.enter` (fade-up animation, `--i` stagger).
- Keeps shadcn token names (`background`, `foreground`, `card`, `muted-foreground`, `border`, `primary`, `ring`) mapped to the new values.

- [ ] Step 1: Rewrite `globals.css` with `@theme inline` mapping, the `:root` token block (values from the spec table), the fixed background glows on `body::before`, base styles (tabular nums, selection color, focus-visible ring pacific 2px), component classes, and a `@media (prefers-reduced-motion)` kill-switch.
- [ ] Step 2: Rewrite `layout.tsx`:
  - `Geist` + `Geist_Mono` with variables `--font-geist`/`--font-geist-mono`; remove `min-w-[1024px]`.
  - `metadata`: title template `%s · Clippers Command Center`, description, `appleWebApp`.
  - `viewport`: `themeColor: '#060A12'`, `viewportFit: 'cover'`.
  - Render the `<TopBar/>` placeholder (the existing `TopNav` until Task 4).
- [ ] Step 3: `next.config.ts`: `images: { remotePatterns: [{ protocol: 'https', hostname: 'cdn.nba.com', pathname: '/headshots/**' }] }`.
- [ ] Step 4: Run `npx tsc --noEmit && npm run lint`. Expected: clean (old components still compile, since the shadcn token names are kept).
- [ ] Step 5: Commit `feat(ui): design tokens, Geist fonts, responsive shell`.

### Task 2: Presentation helpers (TDD)

**Files:**
- Create: `src/lib/ui/odds.ts`, `src/lib/ui/schedule.ts`, `src/lib/ui/season.ts`, `src/lib/ui/live.ts`, `src/lib/ui/headshot.ts`, `src/lib/ui/types.ts`
- Test: `src/lib/ui/odds.test.ts`, `schedule.test.ts`, `season.test.ts`, `live.test.ts`, `headshot.test.ts`

**Interfaces (Produces):**
```ts
// odds.ts
export function americanToProb(ml: number): number
export function noVigProbabilities(mlA: number | null | undefined, mlB: number | null | undefined): { a: number; b: number } | null
export function formatSigned(v: number | null | undefined, digits?: number): string   // 4.5→"+4.5", -3→"−3", 0→"0", null→"—"
export function formatSpread(v: number | null | undefined): string                   // 0→"PK", else formatSigned(v,1) trimmed ".0"
export function formatMoneyline(v: number | null | undefined): string                // -185→"−185", 132→"+132"
// schedule.ts
export interface Datable { game_date: string }
export interface ScheduleLike extends Datable { home_away: 'home' | 'away' }
export interface ScheduleAnnotation { b2b: boolean; restDays: number | null; stand: { kind: 'home' | 'road'; index: number; length: number } | null }
export function daysBetween(a: string, b: string): number                             // calendar days b−a
export function annotateSchedule<T extends ScheduleLike>(games: T[], previousGameDate?: string | null): Array<T & { annotation: ScheduleAnnotation }>
export function groupByMonth<T extends Datable>(games: T[]): Array<{ key: string; label: string; games: T[] }>
// season.ts
export interface HistoryGame { game_id: string; game_date: string; opponent_abbr: string; home_away: 'home' | 'away'; result: 'W' | 'L' | null; final_score: { team: number; opp: number } | null; status: string }
export interface PlayedGame extends HistoryGame { result: 'W' | 'L'; final_score: { team: number; opp: number }; margin: number; ot: boolean }
export function playedGames(games: HistoryGame[]): PlayedGame[]                       // ascending by date
export function upcomingGames(games: HistoryGame[]): HistoryGame[]                    // unplayed, ascending
export function seasonSummary(played: PlayedGame[]): { wins: number; losses: number; home: { w: number; l: number }; away: { w: number; l: number }; avgMargin: number | null }
export function streaks(played: PlayedGame[]): { longestWin: number; longestLoss: number; current: { kind: 'W' | 'L'; length: number } | null }
export function previousSeasonId(seasonIds: number[], current: number): number | null
// live.ts
export function periodLabel(period: number | null | undefined): string                // 0/null→"Pregame", 1-4→"Q1".."Q4", 5→"OT", 6→"2OT"
export function clockLabel(clock: string | null | undefined): string                  // ISO "PT07M42.00S"→"7:42", "7:42"→"7:42", null→""
export function liveTabTitle(g: { period: number | null; clock: string | null; home: { abbreviation: string | null; score: number | null }; away: { abbreviation: string | null; score: number | null } }): string // "LAC 84–78 DEN · Q3 7:42"
export function countdownParts(targetIso: string, now: Date): { days: number; hours: number; minutes: number } | null
// headshot.ts
export function headshotUrl(nbaPlayerId: string | number | null | undefined, size?: 'sm' | 'lg'): string | null
export function initials(name: string): string
```

- [ ] Step 1: Write the failing tests (below). Run `npx vitest run src/lib/ui`. Expected: FAIL (modules missing).

```ts
// odds.test.ts
import { describe, it, expect } from 'vitest'
import { americanToProb, noVigProbabilities, formatSpread, formatMoneyline, formatSigned } from './odds'
describe('odds', () => {
  it('converts american odds', () => {
    expect(americanToProb(-150)).toBeCloseTo(0.6, 4)
    expect(americanToProb(130)).toBeCloseTo(100 / 230, 4)
  })
  it('removes vig', () => {
    const p = noVigProbabilities(-158, 132)!
    expect(p.a + p.b).toBeCloseTo(1, 6)
    expect(p.a).toBeGreaterThan(0.55)
    expect(noVigProbabilities(null, 120)).toBeNull()
  })
  it('formats', () => {
    expect(formatSpread(-4.5)).toBe('−4.5'); expect(formatSpread(3)).toBe('+3'); expect(formatSpread(0)).toBe('PK'); expect(formatSpread(null)).toBe('—')
    expect(formatMoneyline(-185)).toBe('−185'); expect(formatMoneyline(132)).toBe('+132')
    expect(formatSigned(2.84, 1)).toBe('+2.8'); expect(formatSigned(0)).toBe('0')
  })
})
// schedule.test.ts
import { describe, it, expect } from 'vitest'
import { annotateSchedule, groupByMonth, daysBetween } from './schedule'
const g = (d: string, h: 'home' | 'away') => ({ game_date: d, home_away: h })
describe('schedule', () => {
  it('daysBetween', () => { expect(daysBetween('2026-10-31', '2026-11-01')).toBe(1) })
  it('flags back-to-backs and rest', () => {
    const out = annotateSchedule([g('2026-10-21', 'home'), g('2026-10-22', 'away'), g('2026-10-25', 'away')], '2026-10-19')
    expect(out[0].annotation.restDays).toBe(1)
    expect(out[1].annotation.b2b).toBe(true)
    expect(out[2].annotation.restDays).toBe(2)
  })
  it('detects stands of 3+', () => {
    const out = annotateSchedule([g('2026-11-01', 'home'), g('2026-11-03', 'home'), g('2026-11-05', 'home'), g('2026-11-07', 'away')])
    expect(out[1].annotation.stand).toEqual({ kind: 'home', index: 2, length: 3 })
    expect(out[3].annotation.stand).toBeNull()
  })
  it('groups by month in order', () => {
    const groups = groupByMonth([g('2026-10-30', 'home'), g('2026-11-02', 'away')])
    expect(groups.map((x) => x.label)).toEqual(['October 2026', 'November 2026'])
  })
})
// season.test.ts
import { describe, it, expect } from 'vitest'
import { playedGames, upcomingGames, seasonSummary, streaks, previousSeasonId, type HistoryGame } from './season'
const mk = (d: string, r: 'W' | 'L' | null, t?: number, o?: number, ha: 'home' | 'away' = 'home', status = 'final'): HistoryGame =>
  ({ game_id: d, game_date: d, opponent_abbr: 'DEN', home_away: ha, result: r, final_score: t == null ? null : { team: t, opp: o! }, status })
describe('season', () => {
  const games = [mk('2026-01-03', 'L', 99, 104, 'away'), mk('2026-01-01', 'W', 110, 100), mk('2026-01-05', 'W', 120, 118, 'home', 'Final/OT'), mk('2026-01-07', null)]
  it('splits played and upcoming', () => {
    expect(playedGames(games).map((g) => g.game_date)).toEqual(['2026-01-01', '2026-01-03', '2026-01-05'])
    expect(upcomingGames(games)).toHaveLength(1)
    expect(playedGames(games)[2].ot).toBe(true)
  })
  it('summarizes', () => {
    const s = seasonSummary(playedGames(games))
    expect(s).toMatchObject({ wins: 2, losses: 1, home: { w: 2, l: 0 }, away: { w: 0, l: 1 } })
    expect(s.avgMargin).toBeCloseTo((10 - 5 + 2) / 3)
  })
  it('computes streaks', () => {
    expect(streaks(playedGames(games))).toEqual({ longestWin: 1, longestLoss: 1, current: { kind: 'W', length: 1 } })
  })
  it('previous season', () => { expect(previousSeasonId([2024, 2025, 2026], 2026)).toBe(2025); expect(previousSeasonId([2026], 2026)).toBeNull() })
})
// live.test.ts
import { describe, it, expect } from 'vitest'
import { periodLabel, clockLabel, liveTabTitle, countdownParts } from './live'
describe('live', () => {
  it('labels periods', () => { expect(periodLabel(0)).toBe('Pregame'); expect(periodLabel(3)).toBe('Q3'); expect(periodLabel(5)).toBe('OT'); expect(periodLabel(7)).toBe('3OT') })
  it('labels clocks', () => { expect(clockLabel('PT07M42.00S')).toBe('7:42'); expect(clockLabel('7:42')).toBe('7:42'); expect(clockLabel(null)).toBe('') })
  it('builds LAC-first titles', () => {
    expect(liveTabTitle({ period: 3, clock: 'PT07M42.00S', home: { abbreviation: 'DEN', score: 78 }, away: { abbreviation: 'LAC', score: 84 } })).toBe('LAC 84–78 DEN · Q3 7:42')
  })
  it('counts down', () => {
    expect(countdownParts('2026-10-22T02:30:00Z', new Date('2026-10-20T01:00:00Z'))).toEqual({ days: 2, hours: 1, minutes: 30 })
    expect(countdownParts('2026-10-22T02:30:00Z', new Date('2026-10-23T00:00:00Z'))).toBeNull()
  })
})
// headshot.test.ts
import { describe, it, expect } from 'vitest'
import { headshotUrl, initials } from './headshot'
describe('headshot', () => {
  it('builds CDN urls', () => {
    expect(headshotUrl('202695')).toBe('https://cdn.nba.com/headshots/nba/latest/260x190/202695.png')
    expect(headshotUrl(202695, 'lg')).toBe('https://cdn.nba.com/headshots/nba/latest/1040x760/202695.png')
    expect(headshotUrl(null)).toBeNull(); expect(headshotUrl('abc')).toBeNull()
  })
  it('initials', () => { expect(initials('Kawhi Leonard')).toBe('KL'); expect(initials('Derrick Jones Jr.')).toBe('DJ') })
})
```

- [ ] Step 2: Implement the modules to satisfy the tests. Rules:
  - All date math on `YYYY-MM-DD` uses UTC noon.
  - `groupByMonth` labels via `toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })`.
  - The minus sign is U+2212.
  - `initials` ignores the suffixes Jr./Sr./II/III.
  - `countdownParts` returns null when the target is not in the future.
- [ ] Step 3: Add `types.ts` with the typed payloads the pages use. Field names are verbatim from the API data map:
  - `HomePayload`, `ScheduleGame`, `NextGame`, `PlayerTrend`.
  - `LivePayload` (`game`, `key_metrics`, `box_score`, `insights`, `odds`, `state`, `meta`, `snapshot_captured_at`).
  - `Insight`, `RosterPlayer`, `PlayerDetailPayload`, `HistoryGameDetailPayload`, `BoxScoreTeam`, `BoxScorePlayer`.
- [ ] Step 4: Run `npx vitest run src/lib/ui`. Expected: all PASS. Then run `npm test`: all PASS.
- [ ] Step 5: Commit `feat(ui): tested presentation helpers`.

### Task 3: UI primitives

**Files:** Create in `components/ui/`: `panel.tsx`, `eyebrow.tsx`, `stat.tsx`, `team-mark.tsx`, `player-avatar.tsx`, `segmented.tsx`, `chip.tsx`, `data-table.tsx`, `empty-state.tsx`, `skeleton.tsx` (rewrite), `status-dot.tsx`. Create `components/insights/InsightCard.tsx`, `components/insights/InsightRotator.tsx`, `components/charts/chart-theme.tsx`.

**Interfaces (Produces):**
```ts
Panel({ as?: 'div'|'section'|'article'|'a', variant?: 'default'|'inset'|'hero', className, children, ...rest })
Eyebrow({ children, index?: string, aside?: ReactNode, className })
Stat({ label, value: ReactNode, sub?: ReactNode, tone?: 'pos'|'neg'|'mute', meter?: number /*0..1*/, size?: 'md'|'lg', className })
TeamMark({ abbr: string, size?: 'xs'|'sm'|'md'|'lg'|'xl', name?: string, meta?: ReactNode, align?: 'left'|'right', className })
PlayerAvatar({ name: string, nbaPlayerId?: string|number|null, size?: number, variant?: 'circle'|'hero', priority?: boolean, className })   // client, falls back to initials onError
Segmented<T extends string>({ value: T, options: { value: T; label: ReactNode }[], onChange?: (v: T) => void, hrefFor?: (v: T) => string, ariaLabel: string, size?: 'sm'|'md' })
Chip({ tone?: 'default'|'blue'|'pos'|'neg'|'live'|'warn', children })
DataTable: TableScroll({ children, stickyFirst?: boolean }), Th({ align?, children }), Td({ align?, strong?, children }), Tr({ href?, highlight?: boolean, children })
EmptyState({ title: string, body?: string, action?: ReactNode })
Skeleton({ className })
StatusDot({ tone: 'live'|'ok'|'warn', pulse?: boolean })
InsightCard({ insight: Insight, compact?: boolean, fresh?: boolean })       // "✓ Verified" footer from proof.summary/result
InsightRotator({ insights: Insight[], intervalMs?: number })              // pauses on hover/focus, progress dots
chartTheme: { grid, axisTick, tooltip: (props) => JSX }   // shared Recharts styling
```

- [ ] Step 1: Implement each primitive from the visual reference CSS.
  - `TeamMark` renders `/logos/{abbr.toLowerCase()}.png` via `next/image` on a tile; LAC gets a naval gradient tile, other teams a neutral `ink-2` tile. An unknown abbr falls back to the text abbr.
  - `PlayerAvatar` uses `headshotUrl`, with `unoptimized` off and `sizes` set.
- [ ] Step 2: Run `npx tsc --noEmit && npm run lint`. Expected: clean.
- [ ] Step 3: Commit `feat(ui): primitive component set`.

### Task 4: App shell: TopBar, live status, ⌘K palette, page enter

**Files:**
- Create: `components/shell/TopBar.tsx`, `NavLinks.tsx`, `LiveStatus.tsx`, `CommandPalette.tsx`, `PageHeader.tsx`
- Modify: `app/layout.tsx`, `hooks/useLiveData.ts` (typed `LivePayload`, same SWR key/intervals)
- Delete: `components/nav/TopNav.tsx`, `components/ui/nav-link-capsule.tsx`
- `npm i cmdk`

**Interfaces:**
- Consumes: `useLiveData()`, `Segmented`-style styling, `StatusDot`, `TeamMark`, `PlayerAvatar`.
- Produces:
  - `TopBar()`, rendered once in the layout.
  - `PageHeader({ title, subtitle?, eyebrow?, actions? })`.
  - `useCommandPalette()` open state is internal. The TopBar ⌘K button dispatches `window.dispatchEvent(new Event('ccc:open-palette'))`.

- [ ] Step 1: TopBar layout per spec:
  - Brand tile plus "Command Center" plus the mono season label (computed from `seasonStartYear()`).
  - Centered nav pill; the Live link shows an ember dot when `data.state==='LIVE'`.
  - Right side: the ⌘K button and `LiveStatus`, which shows only when LIVE or DATA_DELAYED, with "Updated Ns ago" computed from `meta.generated_at` / `snapshot_captured_at`.
  - Phone: two rows, and the nav scrolls horizontally.
  - Sticky with a translucent blur background; top padding respects the safe area.
- [ ] Step 2: CommandPalette:
  - Built from `cmdk` `Command.Dialog` and opened with ⌘K/Ctrl+K or the event.
  - Groups: Pages (5), Players (fetch `/api/players` on first open), Games (fetch `/api/history/seasons`, then the latest two seasons' `/api/history/games?limit=200`, played games only, labeled `vs DEN · Jan 5 · W 120–118`).
  - Selecting an item runs `router.push`. Styled as a panel with input, groups and items, plus Escape handling.
- [ ] Step 3: Run `npx tsc --noEmit && npm run lint`, then start `npm run dev` and load `/home` to confirm the shell renders (the old page body is fine).
- [ ] Step 4: Commit `feat(ui): app shell with live status and command palette`.

### Task 5: Shared game components + Home

**Files:**
- Create: `components/game/NextGamePanel.tsx`, `Countdown.tsx` (client, ticks every 30s), `OddsStrip.tsx`, `UpNextList.tsx`, `components/charts/DivergingBars.tsx`, `components/home/SeasonPanel.tsx`, `LastTenPanel.tsx`, `PlayerLeaders.tsx`
- Rewrite: `app/home/page.tsx`
- Delete: `components/home/NextGameHero.tsx`, `ScheduleTable.tsx`, `TeamSnapshot.tsx`, `PlayerTrendsTable.tsx`, `PointDiffChart.tsx`, `components/stat-card/StatCard.tsx`

**Interfaces:**
- Consumes: helpers `annotateSchedule`, `formatSpread`, `formatMoneyline`, `countdownParts`, `previousSeasonId`, `playedGames`, `seasonSummary`, and the UI primitives.
- Produces:
  - `NextGamePanel({ game: NextGame | null, context?: ReactNode })`, reused by Schedule and the Live idle state.
  - `OddsStrip({ items: { label: string; value: string }[] })`.
  - `UpNextList({ games: Array<ScheduleGame & { annotation }> })`.
  - `DivergingBars({ data: { key: string; label: string; value: number; href?: string; title: string }[], height?: number })`.

- [ ] Step 1: Home server data flow:
  - `Promise.all` of `/api/home`, `/api/insights?scope=between_games`, `/api/players`, `/api/history/seasons`.
  - If `record.wins + record.losses === 0`, fetch the previous season's `/api/history/games` and pass its summary to `SeasonPanel` labeled "Last season". Otherwise fetch the current season's games for the home/away splits.
  - Join headshot ids: `Map(player_id → nba_player_id)`.
- [ ] Step 2: Build the sections in spec order:
  - Hero row: `NextGamePanel` + `SeasonPanel`.
  - `LastTenPanel`: diverging bars, each bar linking to `/history/{game_id}` when an id is present. `last10_games` lacks `game_id`, so bars render without links. That is acceptable; note it for the audit request list.
  - Leaders + `InsightRotator`.
  - `UpNextList` with the next 4 games.
  - Designed states: API failure → `EmptyState`; no next game → a panel saying "The schedule hasn't been published yet".
- [ ] Step 3: Visual check with Playwright at 1440 and 390 against `npm run dev` (real DB). Fix overflow and spacing issues.
- [ ] Step 4: `npx tsc --noEmit && npm run lint && npm test`, then commit `feat(ui): redesigned home`.

### Task 6: Schedule

**Files:**
- Create: `components/schedule/ScheduleList.tsx`
- Rewrite: `app/schedule/page.tsx`

- [ ] Step 1: The page fetches `/api/schedule` and renders:
  - `PageHeader`.
  - `NextGamePanel`, whose context chip comes from the first game's annotation (B2B / home stand / "Season opener" when no prior game).
  - `groupByMonth(annotateSchedule(rest))` rendered as grouped rows. Each row shows date + weekday, time PT, `TeamMark sm` + city/name from `home_team`/`away_team`, "vs"/"@", `OddsStrip`-style compact odds, and chips (`B2B`, `Rest 2`, "Home stand · 2 of 4").
  - Phone: rows reflow to two lines.
  - Empty/error states.
- [ ] Step 2: Visual check at 1440/390. `tsc`, lint. Commit `feat(ui): schedule with rest and stand intelligence`.

### Task 7: Live (+ dev fixture, tab title, sticky score)

**Files:**
- Create:
  - `components/live/LiveView.tsx` (client; takes `data: LivePayload | undefined`, `error`).
  - `components/game/Scoreboard.tsx` (`mode: 'live'|'final'`), `WinProbabilityBar.tsx`, `BoxScore.tsx` (team tabs, starters first, totals, leaders bold, sticky name column).
  - `components/live/KeyMetrics.tsx`, `StickyScore.tsx`, `LiveTabTitle.tsx`, `IdleState.tsx`.
  - `app/dev/live/page.tsx`, `app/dev/live/fixture.ts`, `public/favicon-live.svg`.
- Rewrite: `app/live/page.tsx` (uses `useLiveData` → `LiveView`)
- Delete: `components/live/LiveScoreboard.tsx`, `KeyMetricsRow.tsx`, `BoxScoreModule.tsx`, `InsightTileArea.tsx`, `NoGameIdleState.tsx`, `OtherGamesPanel.tsx`, `components/box-score/BoxScoreTable.tsx`, `components/stale-banner/StaleBanner.tsx`, `components/skeletons/*`

**Interfaces:**
- `Scoreboard({ home: { abbr: string; name?: string|null; score: number|null }, away: {...}, mode: 'live'|'final', period?: number|null, clock?: string|null, status?: string, date?: string, children?: ReactNode /* strips below */ })`. LAC is always rendered on the left.
- `BoxScore({ teams: BoxScoreTeam[], nbaIds?: Map<string, string> })`.
- `resolveLiveState(data)` is kept as-is from the current page (the 6h stale rule), moved into `LiveView`.

- [ ] Step 1: Build `LiveView` states: loading skeleton, error-with-no-data, idle (`IdleState` fetches `/api/home` and shows `NextGamePanel` + last game), and LIVE/DELAYED.
- [ ] Step 2: LIVE layout:
  - Scoreboard + odds strip + win-probability bar (from `odds.moneyline_home/away`, mapped to the LAC side).
  - The delayed notice as an inline amber chip row.
  - `KeyMetrics` (API metrics + FT edge via `computeFtEdge`).
  - Box score + insights feed.
  - `StickyScore` appears via IntersectionObserver when the scoreboard leaves the viewport.
  - `LiveTabTitle` sets `document.title` and swaps the `link[rel=icon]` href to `/favicon-live.svg` while LIVE, restoring both on cleanup.
  - Score flash: keep the previous score in a ref and add the `.flash` class for 1.2s when it changes.
- [ ] Step 3: The `/dev/live` page calls `notFound()` when `process.env.NODE_ENV === 'production'`, and renders `<LiveView data={fixture} />`. The fixture is an exact `/api/live` LIVE payload (DEN at LAC, Q3 7:42, 84–78, full box scores for 10 players per side, odds, 2 insights).
- [ ] Step 4: Visual check of `/dev/live` and `/live` (idle) at 1440/390. `tsc`, lint, test. Commit `feat(ui): redesigned live view with fixture, tab title, sticky score`.

### Task 8: Players + player detail

**Files:**
- Create: `components/players/RosterView.tsx`, `PlayerHero.tsx`, `TrendChart.tsx`, `SplitsPanel.tsx`, `GameLog.tsx`
- Rewrite: `app/players/page.tsx`, `app/players/[player_id]/page.tsx`, `components/charts/LineChartWrapper.tsx` (themed)
- Delete: `components/players/RosterViewToggle.tsx`, `PlayerHeader.tsx`, `RollingAveragesTable.tsx`, `TrendChartSection.tsx`, `SplitsDisplay.tsx`, `GameLogSection.tsx`, `components/charts/BarChartWrapper.tsx`

- [ ] Step 1: Roster:
  - `searchParams.traded==='1'` → fetch `/api/players?include_traded=true`.
  - `searchParams.view` is `cards` (default) or `table`, switched with `Segmented` + `hrefFor` (URL-driven, no client state).
  - Cards: a headshot card grid. Table: `DataTable`.
- [ ] Step 2: Detail:
  - The player's `nba_player_id` comes from `/api/players?include_traded=true` (join on `player_id`).
  - `PlayerHero`: big headshot, name, position, big `Stat`s for PTS/REB/AST/TS% showing the season value with an L10 delta.
  - `TrendChart`: Segmented metric (PTS/REB/AST/TS%) + L5/L10 lines via `mergeChartSeries`, emphasized last point.
  - `SplitsPanel`: paired bars.
  - `GameLog`: rows link to `/history/{game_id}`, with an opponent `TeamMark xs`.
- [ ] Step 3: Visual check at 1440/390, `tsc`, lint, test. Commit `feat(ui): redesigned players and player detail`.

### Task 9: History + game detail

**Files:**
- Create: `components/history/HistoryControls.tsx`, `SeasonSummary.tsx`, `SeasonStrip.tsx`, `GameList.tsx`
- Rewrite: `app/history/page.tsx`, `app/history/[game_id]/page.tsx`
- Delete: `components/history/SeasonControls.tsx`, `SeasonSummaryBar.tsx`, `GameListTable.tsx`, `GameHeader.tsx`, `HistoryGameDetail.tsx`

- [ ] Step 1: List page:
  - `HistoryControls`: a season `<select>` styled as a pill, plus two `Segmented` with `hrefFor` that keep the existing URL param semantics.
  - `SeasonSummary`: `seasonSummary()`, including average margin.
  - `SeasonStrip`: `playedGames()` bars with titles and links, and streak callouts.
  - `GameList`: filtered played games grouped by month, plus a collapsed `<details>` "Remaining · n games" using `upcomingGames()`.
  - Keep the data-gap notice (fewer than 30 games), restyled as a Chip line.
- [ ] Step 2: Detail page:
  - `Scoreboard mode="final"` with an OT chip and the long date.
  - `BoxScore` for both teams with totals.
  - Insights via `InsightCard` list; `category` still comes from `proof.summary`.
  - Previous/next links computed from the season's `/api/history/games` list.
  - `available:false` → `EmptyState`.
- [ ] Step 3: Visual check at 1440/390, `tsc`, lint, test. Commit `feat(ui): redesigned history and game detail`.

### Task 10: PWA + transitions

**Files:**
- Create: `app/manifest.ts`, `app/icon.tsx`, `app/apple-icon.tsx`, `public/favicon.svg`, `components/shell/PageEnter.tsx` (if needed)
- Modify: `app/layout.tsx`, `next.config.ts` (only if the experimental view transitions flag is adopted)
- Delete: `app/favicon.ico` (replaced by `icon.tsx`), unused `public/*.svg` Next boilerplate (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`) after grepping for references

- [ ] Step 1: Manifest:
  - `name` "Clippers Command Center", `short_name` "CCC", `start_url` "/home", `display` "standalone", colors `#060A12`, icons 192/512 from `/icon`.
  - The icon routes generate the LAC tile with `ImageResponse`.
- [ ] Step 2: Transitions:
  - Check the Next 16 docs (context7) for `experimental.viewTransition`. If it is stable with the App Router + `<ViewTransition>`, wrap the `main` content with a crossfade and 8px rise.
  - Otherwise keep the CSS `.enter` animation only.
- [ ] Step 3: `npm run build`. Expected: success, with the manifest and icons emitted. Commit `feat(ui): installable PWA and page transitions`.

### Task 11: Cleanup + full verification

- [ ] Step 1: `grep -r` for imports of every deleted component and remove any leftovers. Delete unused `components/ui/*` shadcn files (`card`, `badge`, `button`, `table`, `tooltip`, `surface`) if nothing imports them. Delete `design-system/` and `ui-prototype/` only if Luke agrees (keep by default).
- [ ] Step 2: `npm test && npm run lint && npx tsc --noEmit && npm run build`. All green.
- [ ] Step 3: Playwright sweep of `/home /live /dev/live /players /players/{id} /schedule /history /history/{id}` at 1440×900 and 390×844.
  - Check: no horizontal body scroll (`document.documentElement.scrollWidth <= innerWidth`), no console errors, headshots load, ⌘K opens and navigates.
  - Fix what is found.
- [ ] Step 4: Update README (drop "Desktop only (min-width 1024px)"; mention responsive, installable).
- [ ] Step 5: Commit `chore(ui): remove dead components, docs`. Push the branch and open a PR to `main`.
