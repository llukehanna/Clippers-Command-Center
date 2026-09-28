# Premium UI Redesign — Design Spec

*2026-09-27 · branch `redesign/premium-ui` (from `origin/main` @ 698b739)*
*Approved direction: [CCC Design Direction artifact](https://claude.ai/artifact/WNgY7W3UzdQaWyZfQVHPvF)*

## Goal

Rebuild the CCC front end so it reads as a premium product and as a sibling of lukeghanna.com. The current UI was built on an older model: generic shadcn tables, flat hierarchy, cold blue-black, Inter everywhere, walls of `—`, desktop-only. This spec replaces the design system and reworks every page's composition, adds four extras Luke selected, and makes the app responsive down to phone width.

**Success looks like:** every route has one clear hero, consistent materials and type, designed empty/offseason states, real team logos and player headshots, and works at 390px wide. Existing tests, lint, typecheck, and build pass.

## Decisions (from Luke)

| Decision | Choice |
|---|---|
| Visual direction | **Hybrid**: lukeghanna.com typography, spacing, glass materials and mono eyebrows on a Clippers Naval base, with Clippers accents |
| Scope | **Full redesign**: tokens, components, page layouts, empty states, motion |
| Mobile | **Responsive**: drop `min-w-[1024px]`; every page works at phone width |
| Headshots | **Yes**, NBA CDN via `nba_player_id` |
| Extras | Live polish, connected navigation + ⌘K, schedule intelligence, installable (PWA) + page transitions |
| Data bugs | Coordinate with the cloud audit agent (see Coordination) |

## Boundaries

- **Owned by this work:** `app/**/page.tsx`, `app/**/layout.tsx`, `app/globals.css`, `app/manifest.ts`, `app/icon*.tsx`, `components/**`, `hooks/**`, `public/**`, `next.config.ts` (image remote pattern only), plus new pure presentation helpers in `src/lib/ui/**` with tests.
- **Not touched:** `app/api/**`, `scripts/**`, existing `src/lib/*.ts` domain modules, DB schema. The UI consumes API responses exactly as they are on `origin/main`. Anything the UI would like from the API goes on the audit agent's request list, never into this branch.
- Where a page needs data the API returns on a different route (e.g. `nba_player_id` for headshots on Home), the page fetches that second route and joins client/server side. No API edits.

## Design system

### Color tokens (`app/globals.css`, dark-only)

The existing shadcn token names stay mapped (so any remaining shadcn primitive keeps working); their values change.

| Token | Value | Role |
|---|---|---|
| `--ink-0` / `background` | `#060A12` | Page ground (Naval-biased black) |
| `--ink-1` / `card` | `#0B1220` | Panel surface |
| `--ink-2` | `#111A2C` | Raised surface |
| `--ink-3` / `accent` | `#18233A` | Hover, active segment |
| `--line` / `border` | `rgba(150,178,230,.09)` | Hairlines |
| `--line-2` | `rgba(150,178,230,.16)` | Emphasized hairlines |
| `--text` / `foreground` | `#E8EDF6` | Primary text |
| `--mute` / `muted-foreground` | `#8D98AE` | Secondary text (≥ 4.5:1 on ink-1) |
| `--dim` | `#6B7791` | Tertiary labels (checked ≥ 4.5:1 on ink-1; adjust if not) |
| `--naval` | `#0C2340` | Brand fills (LAC tiles, gradients) |
| `--pacific` / `primary`, `ring` | `#418FDE` | Data accent, focus, links, active nav |
| `--ember` / `live` | `#E0243F` (Ember `#C8102E` lifted for dark ground) | **Live only**: live dot, LIVE pill, live favicon |
| `--pos` / `positive` | `#4CC38A` | Wins, favorable deltas |
| `--neg` / `negative` | `#F0677A` | Losses, unfavorable deltas |
| `chart-1..4` | pacific, `#7FB6EC`, `#E3B341`, neg | Chart series |

Page background adds two faint radial glows (pacific top-left, ember top-right at ~7%) and a Naval glow at the bottom, fixed, as on the mockup.

### Typography

- `next/font/google`: **Geist** (`--font-sans`) and **Geist Mono** (`--font-mono`); Inter removed.
- Geist for everything read: headings (600, negative tracking), body, numbers (`tabular-nums` globally).
- Geist Mono for labels and metadata only: eyebrows, column headers, timestamps, proof footers, abbreviations.
- Scale (px): 11 (mono labels) · 12.5 · 14 · 15 (body) · 18 · 21 · 24 · 30 · 44/56 (record) · 88 (live score; 56 on phone).

### Materials and motion

- **Panel**: `ink-1` + a 170° white gradient (5.5% → 1.2%), 1px `line` border, inset top highlight, soft long shadow, radius 22px. `inset` variant: radius 16px, 2% white fill, no shadow.
- **Eyebrow**: mono 11.5px uppercase, 0.14em tracking, optional index and right-aligned aside, followed by a gradient hairline.
- **Easing**: `cubic-bezier(.32,.72,0,1)` everywhere. Page content enters with an 8px fade-up, staggered 40ms per section. Hover on rows and panels is a background shift only; no lift or scale.
- Every animation is gated by `prefers-reduced-motion`.

### Component set (`components/ui/`)

Replaces `surface.tsx`, `card.tsx`, `nav-link-capsule.tsx`, `StatCard`, the skeletons and the stale banner.

| Component | Purpose |
|---|---|
| `Panel` | Surface primitive (`default`, `inset`, `hero` with glow), `as` prop |
| `Eyebrow` | Section label + optional index/aside + hairline |
| `Stat` | Label / value / sub-line, tone (`pos`/`neg`/`mute`), optional meter |
| `TeamMark` | Real team logo PNG on a tile, sizes `xs`–`xl`, optional name/record line |
| `PlayerAvatar` | NBA headshot (`cdn.nba.com/headshots/nba/latest/260x190/{id}.png`) in a circle or hero crop, initials fallback on error or missing id |
| `DataTable` | Styled table primitives; wrapper scrolls horizontally with a sticky first column on narrow screens |
| `Segmented` | Pill segmented control (team tabs, filters, metric toggles) |
| `Chip` | Small mono badges (B2B, rest, starter, traded, final/OT) |
| `InsightCard` + `InsightRotator` | Category, headline, detail, **"✓ Verified" proof footer** built from `proof`; rotator with progress dots and pause-on-hover |
| `EmptyState` | Icon-less, one line of copy plus optional action |
| `Skeleton` | Shimmer blocks shaped like the real layout |
| `StatusDot` | Synced / live / delayed indicator |

Charts (Recharts) get one shared theme: no axis lines, faint horizontal grid, mono tick labels, pacific series, emphasized last point, custom tooltip styled as an inset panel.

## App shell

- `app/layout.tsx`: fonts, background glows, `TopBar`, `CommandPalette`, `viewport` export with `themeColor #060A12`. Remove `min-w-[1024px]`.
- **TopBar**:
  - **Brand**: LAC tile plus "Command Center" and the mono season label.
  - **Nav**: a centered segmented pill. The active item gets an `ink-3` fill; the Live item shows the ember dot only while a game is LIVE.
  - **Right side**: a ⌘K hint button, plus a `StatusDot` shown only during a game: "Live · updated 4s ago", or amber "Delayed · 3m" when the snapshot is stale. There is no API field for pipeline freshness, so nothing shows between games.
  - **Phone**: brand and status stay on the first row, and the nav moves to a second full-width row that scrolls horizontally.
  - The LIVE state comes from a lightweight shared SWR key on `/api/live`, using the existing adaptive interval (12s live, 300s idle).
- **Page container**: max-width 1320px, 22px gutter (14px on phone), sections separated by 28px.

## Pages

### Home (`/home`)

1. **Hero row** (1.55fr / 1fr; stacks on tablet and phone):
   - **Next game panel**:
     - Header: eyebrow plus a context chip ("Season opener", "Home stand · 2 of 4", or "Back-to-back").
     - Matchup: `TeamMark xl` for both teams with name and home/away.
     - Tip-off: date and time in PT, and a countdown (days/hrs/min, updating every minute on the client).
     - Odds strip (spread from the LAC perspective, moneyline, total) when present.
   - **Season panel**:
     - Record at 56px and the last-10 line.
     - Home/away split bars and net/off/def rating stats.
     - **Offseason rule:** if the current season has 0 games played, show the prior season (the latest season with results, from `/api/history/seasons` plus `/api/history/games`), labeled "Last season". Home/away splits always come from history games for the displayed season.
2. **Last 10**: diverging bar chart (wins up, losses down from a zero line) with opponent labels, the record, average margin and best result. Each bar links to that game.
3. **Two-column row**:
   - **Player trends**: ranked leaderboard with headshots (joined from `/api/players` on `player_id`), showing PTS/REB/AST/MIN. REB/AST are hidden on phone. Rows link to player pages.
   - **Verified insight**: `InsightRotator` fed by `/api/insights?scope=between_games`.
4. **Up next**: the next 4 games as compact rows (logo, date, time, home/away, odds, B2B/rest chips), linking to `/schedule`.

### Live (`/live`)

- **Scoreboard hero**:
  - `TeamMark lg`, team names, and the scores at 88px (the trailing score in mute). There are no team records, since the live payload has none.
  - Center: LIVE pill, clock, and period plus bonus/OT label.
  - Odds strip from live `odds`: spread, moneyline, total, and "line as of".
  - **Win-probability bar** from the no-vig implied moneyline probability, with LAC in naval→pacific against the opponent.
  - When a score changes, the new number flashes briefly.
- **Sticky mini-scoreboard**: after the hero scrolls out of view, a slim bar (logos, score, clock) sticks under the TopBar.
- **Key metrics**: eFG%, TOV margin, REB margin, pace, and FT edge as `Stat` panels with meters. Grid is 5 → 3 → 2 columns.
- **Box score**:
  - `Segmented` team tabs (LAC first).
  - Starters marked with a pacific left rule and listed first.
  - Totals row; column leaders bolded.
  - Sticky player column on phone.
- **Insights feed**: newest first. The newest card gets a pacific ring.
- **Tab title and favicon** while LIVE: title becomes `LAC 84–78 DEN · Q3 7:42`, and the favicon swaps to a red-dot variant. Both restore on unmount or when the game ends.
- **Delayed state**: a slim amber inline notice under the hero that reads "Delayed · last update 3m ago". It replaces the old full-width banner.
- **No game**: a designed idle state. It reuses the Next game panel (countdown and odds), plus a "Last game" result card linking to its history page and a note that the page updates automatically when the game tips. **Offseason**: "Next game" shows the season opener; if nothing is scheduled, the copy says the schedule hasn't been published yet.

### Players (`/players`)

- Header: title, season label, count, and a `Segmented` Cards | Table control. The "Show traded" toggle uses the API's `include_traded`.
- **Cards** (default): responsive grid (4 / 3 / 2 columns) of headshot cards with name, position, and chips for starter or traded.
- **Table**: name with avatar, position, and status.
- Empty and error states are designed.

### Player detail (`/players/[player_id]`)

- **Hero**:
  - Large headshot cropped on a Naval gradient, with name, position and the season label.
  - Key averages as big stats: season vs L10, with deltas colored pos/neg.
- **Trends**:
  - Themed line chart; the metric toggle (PTS/REB/AST/TS%) uses `Segmented`, and a second toggle switches L5/L10.
  - The latest point is emphasized.
- **Splits**: home/away and wins/losses shown as paired comparison bars for PTS and TS%.
- **Game log**:
  - `DataTable` with opponent logo, result context and stats.
  - Rows link to `/history/[game_id]`.
  - Mobile: sticky date column.

### Schedule (`/schedule`)

- Next game panel (shared with Home).
- **Remaining schedule grouped by month**. Each row shows date, weekday, time in PT, `TeamMark` and opponent name, home/away, odds, and chips.
- **Chips and grouping**, all computed from dates only, in `src/lib/ui/schedule.ts` with tests:
  - `B2B` for the second night of a back-to-back.
  - `Rest n` when there are 2 or more rest days.
  - Consecutive home or away games grouped under a subtle label: "Home stand · 4 games" or "Road trip · 3 games".

### History (`/history`)

- **Controls**: season select plus `Segmented` All/Home/Away and All/W/L. These stay URL-driven.
- **Summary**: Overall, Home and Away records, plus average margin (computed from final scores). This replaces the Net Rating tile that never had a value.
- **Season strip**:
  - One small bar per played game, colored W/L with height set by margin, in date order.
  - Hover shows opponent, score and date; clicking a bar opens the game.
  - Longest win and loss streaks are called out.
- **Game list**:
  - Month-grouped rows: date, opponent logo, home/away, score, and a result chip with OT.
  - Unplayed games collapse into a "Remaining · n games" group at the end instead of 60 rows of `—`/`sch`.

### Game detail (`/history/[game_id]`)

- Final scoreboard hero: the same component as Live in `final` mode, with FINAL/OT chip and date.
- Box scores via team `Segmented` tabs, with the totals row the API already returns but the UI never showed.
- Verified insights sidebar (stacks below on phone).
- Back link and previous/next game navigation within the season, using the history games list.

## Extras

1. **Live polish**: tab title, favicon, sticky mini-scoreboard, win-probability bar, and score flash (see Live).
2. **Connected navigation + ⌘K**:
   - Everything links: game rows, bars and log rows go to `/history/[id]`; player names everywhere go to `/players/[id]`.
   - `CommandPalette` (⌘K / Ctrl+K and a TopBar button) is built with `cmdk` (the one new dependency) inside a Radix Dialog.
   - Palette sources: pages, the roster (`/api/players`), and current- and last-season games (`/api/history/games`), with lazy loading on first open.
3. **Schedule intelligence**: B2B, rest days, home stand/road trip, season results strip, and streaks. All are pure functions with unit tests.
4. **Installable + transitions**:
   - `app/manifest.ts`, generated `app/icon.tsx` and `app/apple-icon.tsx` (LAC tile via `next/og`), `themeColor`, and `appleWebApp` metadata, so the app opens fullscreen from the iPhone home screen with safe-area padding respected.
   - Page transitions use Next 16's view-transition support if the experimental flag works cleanly with this app. Otherwise the CSS enter animation alone.

## UI bugs fixed along the way

- `LiveScoreboard` fallbacks are swapped: away defaults to `LAC` and home to `OPP`.
- `NextGameHero` types odds as strings, but the API sends numbers.
- Home `PlayerTrendsTable` hardcodes the TS% and L5 Δ columns to `—`. Those columns are removed; TS% returns only if the API starts providing it.
- History "Net Rating" tile never receives a value. It is replaced by average margin.
- `/history/[game_id]` never renders the box-score `totals`.
- Players page shows a blank page on fetch failure. It gets a designed error state.
- `BarChartWrapper` is unused and is deleted.

## Dev fixture for Live

Live can't be verified in the offseason. Add a dev-only route, `app/dev/live/page.tsx`, that renders the Live view from a static fixture payload in the exact `/api/live` shape. It is gated with `notFound()` when `NODE_ENV === 'production'`. This lets both the design and future changes be checked without a real game.

## Coordination with the audit agent

The audit agent runs in a cloud session this session can't message directly. Handoff: a note for Luke to paste into that session, covering:

- **Production data issues:**
  - Traded/inactive players still appear in the roster.
  - `player_trends.ts_pct` is always null.
  - `conference_seed` is always null.
  - `other_games` is always `[]`.
  - Confirm that the stale Live snapshot, the 0–0 record next to "Last 10 5–5", and the UTC time are fixed in the next production deploy.
- **Nice-to-have API additions** (the UI renders them if present, and works without them):
  - Per-quarter line scores in the `/api/live` and `/api/history/games/[id]` payloads.
  - `nba_player_id` on `player_trends` and box-score players.
  - `other_games` populated during live games.
- **File ownership:** the redesign touches only the paths listed under Boundaries, so the two branches won't conflict.

## Testing and verification

- **Unit tests (vitest)** for new pure helpers in `src/lib/ui/`:
  - Implied probability (no-vig).
  - Schedule chips and stands.
  - Season strip and streaks.
  - Offseason season selection.
  - Live tab title formatting.
  - Headshot URL.
- Existing tests, `npm run lint`, `tsc --noEmit` and `next build` stay green.
- **Visual verification:**
  - Playwright screenshots of every route against local `next dev` on the real Neon DB, at 1440×900 and 390×844.
  - Plus `/dev/live` for the LIVE state and a forced no-game state.
  - Check for overflow, clipped text and contrast.
- Keyboard pass: tab order, focus rings, ⌘K open/close, Escape handling.

## Out of scope

- Light theme.
- API or pipeline changes (owned by the audit agent).
- New data sources.
- Auth.
- Push notifications.
