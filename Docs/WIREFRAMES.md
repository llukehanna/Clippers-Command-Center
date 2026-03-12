# WIREFRAMES.md

This document defines the structural layout, information hierarchy, interaction expectations, and module contracts for the MVP screens of **Clippers Command Center**.

This is a **layout and UX contract**, not a visual design file.

It answers:

- what appears on each page
- what order it appears in
- how dense each section should be
- which modules are primary vs secondary
- what should remain visible above the fold
- how each screen behaves in desktop-first MVP

Visual styling must follow:

- `docs/DESIGN-SYSTEM.md`
- `design-system/clippers-command-center/MASTER.md`
- `design-system/clippers-command-center/pages/[page].md` where relevant

---

# Global Wireframe Rules

## Platform Scope

The MVP is **desktop / laptop only**.

Target widths:

- 1024px minimum supported desktop
- 1280px primary target
- 1440px ideal target

Mobile layout is out of scope for this file.

## Layout Model

All pages use a **12-column desktop grid**.

Standard page frame:

- max width: 1440px
- horizontal padding: 24px
- section spacing: 24px
- dense card spacing: 12–16px

## Information Hierarchy Rules

Across the product, page structure should follow this priority:

1. current game state or current team state
2. most important performance indicators
3. primary analytical table or chart
4. generated insights
5. supporting context
6. secondary league information

## Update and Motion Rules

For live pages:

- live updates must not cause layout shift
- scores, clocks, and rotating insights must update in place
- component heights should remain stable
- avoid flashy motion, pulsing cards, or repositioning modules during refresh

## Module Priority Rules

Each page distinguishes between:

- **Primary modules**: always visible, central to purpose
- **Secondary modules**: supportive, visible but less prominent
- **Tertiary modules**: optional lower-page context

---

# Site Map

MVP screens:

1. Live Game Dashboard
2. Between-Games Dashboard (Home)
3. Player Trends Page
4. Schedule Page
5. Historical Explorer
6. Historical Game Detail View

Optional supporting states:

- No Active Game state
- Data Delayed state
- Empty / Missing Odds state
- Historical Data Loading state

---

# 1. Live Game Dashboard

## Purpose

Provide a second-screen desktop dashboard for an active Clippers game with:

- immediate game-state awareness
- dense stat visibility
- contextual team and player information
- rotating, provable insights
- Clippers-relevant league context

This is the **highest-priority screen in the product**.

## Page-Level Hierarchy

Priority order:

1. scoreboard band
2. key live metrics
3. full box score
4. insight tiles
5. other-games context
6. lower analytical context

## Grid Structure

Desktop 12-column layout:

- row 1: scoreboard band (12 columns)
- row 2: key metrics row (12 columns)
- row 3:
  - left/main column: 8 columns
  - right/sidebar column: 4 columns
- row 4+: lower context modules (12 columns, or 8/4 split where needed)

## Above-the-Fold Contract

The following must be visible without major scrolling on a standard 1280px laptop display:

- scoreboard band
- key metrics row
- top portion of the box score table
- at least 2 insight tiles
- at least 1 other-games context module

## Page Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ SCOREBOARD BAND                                                             │
│ Clippers Score | Opponent Score | Quarter | Clock | Status/Possession       │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ KEY METRICS ROW                                                             │
│ eFG% | TO Margin | Rebound Margin | Pace | FT Edge | Foul Pressure          │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────┬───────────────────────────────┐
│ MAIN ANALYTICS COLUMN (8 cols)              │ CONTEXT SIDEBAR (4 cols)      │
│                                              │                               │
│ FULL BOX SCORE TABLE                         │ INSIGHT TILES                 │
│ - starters / bench                           │ - 2–3 visible                 │
│ - sortable stat columns                      │ - rotating                    │
│ - compact rows                               │ - fixed height                │
│                                              │                               │
│                                              │ OTHER GAMES CONTEXT           │
│                                              │ - relevant games only         │
│                                              │ - score / time / note         │
└──────────────────────────────────────────────┴───────────────────────────────┘

┌──────────────────────────────────────────────┬───────────────────────────────┐
│ LOWER CONTEXT                               │ LOWER CONTEXT                 │
│ Momentum / game state chart                 │ Player highlights             │
│ Quarter splits / recent trend module        │ Team context / season refs    │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

## Required Modules

### A. Scoreboard Band
**Priority:** Primary

#### Contents
- Clippers score
- opponent score
- quarter / period
- game clock
- game status (live/final/halftime/etc.)
- possession indicator if available

#### Layout behavior
- full-width horizontal band
- largest numeric treatment on page
- stable position at top of page
- score visually dominates metadata

#### Interaction
- no major interactivity required
- no layout movement during refresh

### B. Key Metrics Row
**Priority:** Primary

#### Contents
Compact stat cards for the most explanatory live metrics.

Default module set:
- effective FG%
- turnover margin
- rebound margin
- pace
- free throw edge
- foul pressure or other relevant game-state metric

#### Layout behavior
- single horizontal row under scoreboard
- cards should remain compact
- metrics may change order if relevance engine later exists, but for MVP use fixed order

### C. Full Box Score Table
**Priority:** Primary

#### Contents
- Clippers player rows
- opponent player rows or toggle/tab if needed
- standard box score fields
- team totals

Recommended columns:
- MIN
- PTS
- REB
- AST
- STL
- BLK
- TO
- FG
- 3PT
- FT
- +/-

#### Layout behavior
- main content anchor of the page
- must remain high on the page
- compact row density
- sticky table header
- right-aligned numerics
- hover highlight only

#### Scroll behavior
- if height exceeds viewport, inner table scroll is acceptable
- avoid pushing insight tiles below the fold unnecessarily

### D. Insight Tiles
**Priority:** Primary

#### Contents
2–3 simultaneous insight cards.

Each tile contains:
- short headline
- supporting stat or proof context
- category label

Example categories:
- scoring run
- clutch alert
- streak
- milestone
- league comparison
- opponent context

#### Layout behavior
- fixed heights
- stacked vertically in sidebar
- rotation must not shift surrounding modules

#### Rotation behavior
- later implementation will define timing
- wireframe assumes stable replacement in place

### E. Other Games Context Panel
**Priority:** Secondary

#### Contents
Only games relevant to Clippers.

Each item includes:
- matchup
- score
- time or game status
- one short Clippers-relevant note

Possible note themes:
- standings implications
- seeding implications
- rival result
- future opponent scouting context

#### Layout behavior
- below insights in sidebar
- visually secondary to Clippers modules
- compact stacked list

### F. Lower Context Modules
**Priority:** Secondary / Tertiary

Candidate modules:
- momentum strip or run history
- quarter-by-quarter comparison
- top player highlights
- mini trend charts
- season context reference

These should sit below the primary fold and support deeper game understanding.

## Live State Variants

### Active Game
Normal live layout.

### Halftime
Same layout, but scoreboard status changes and lower modules may emphasize first-half summary.

### Final
Live dashboard may still render briefly with final state before app routes to between-games dashboard or recap behavior later.

### Data Delayed
If live source fails/rate limits:

- scoreboard remains visible
- stale data banner appears near top
- cached values remain on screen
- no fake freshness indicators

---

# 2. Between-Games Dashboard (Home)

## Purpose

Provide the default dashboard when no Clippers game is active.

It should answer:

- how are the Clippers doing recently?
- what matters next?
- which players are trending?
- what are the biggest current insights?
- what upcoming context matters (including odds)?

## Page-Level Hierarchy

Priority order:

1. team snapshot
2. upcoming schedule / next game
3. player trends
4. team insights
5. secondary context modules

## Grid Structure

Desktop 12-column layout with stacked sections, mostly full-width.

Recommended row pattern:
- row 1: team snapshot (12)
- row 2: next game + schedule context (12)
- row 3: player trend cards or charts (12)
- row 4: insights (12)
- row 5: supporting modules (12 or 8/4 split)

## Page Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ TEAM SNAPSHOT                                                               │
│ Record | Net Rating | Last 10 | Off Rtg | Def Rtg | Conference Position     │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ UPCOMING SCHEDULE / NEXT GAME                                               │
│ Opponent | Date | Time | Home/Away | Spread | Moneyline | Total             │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ PLAYER TRENDS                                                               │
│ Top trend cards or compact trend modules for key Clippers players           │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ TEAM INSIGHTS                                                               │
│ Rotating insight tiles about recent performance, streaks, season context    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────┬───────────────────────────────┐
│ SUPPORTING CONTEXT (8 cols)                 │ SECONDARY CONTEXT (4 cols)    │
│ Recent performance chart                     │ League context / standings     │
│ Schedule density / rest context              │ Odds note / watchlist          │
└──────────────────────────────────────────────┴───────────────────────────────┘
```

## Required Modules

### A. Team Snapshot
**Priority:** Primary

Contents:
- record
- net rating
- last 10 record
- offensive rating
- defensive rating
- conference seed / position if available

### B. Upcoming Schedule / Next Game
**Priority:** Primary

Contents:
- next opponent
- date/time
- home/away
- Vegas odds when available
- likely relevant context note

### C. Player Trends
**Priority:** Primary

Contents:
- top Clippers players by recent trend
- compact modules showing last N games summary
- direct link path to full player trends page later

### D. Team Insights
**Priority:** Primary

Contents:
- rotating insights on recent performance
- streaks
- milestone watch
- recent-clippers-context facts

### E. Supporting Context
**Priority:** Secondary

Possible modules:
- last 10 chart
- team trend line
- recent schedule difficulty
- rest-day note
- opponent preview note

## No Active Game Contract

This page is the default state whenever no Clippers game is active.

It should feel complete and useful, not like an empty placeholder.

---

# 3. Player Trends Page

## Purpose

Allow the user to inspect recent performance trends for individual Clippers players.

This page is not meant to be a full scouting database in MVP. It is a focused trends page.

## Page-Level Hierarchy

Priority order:

1. player selector / header
2. trend summary
3. charts
4. game log table
5. supporting splits/context

## Grid Structure

12-column layout:
- row 1: player header + filters (12)
- row 2: summary metrics (12)
- row 3: chart area (8) + quick splits/context (4)
- row 4: game log table (12)

## Page Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ PLAYER HEADER / SELECTOR                                                    │
│ Player name | team role | quick season summary | filter controls            │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ TREND SUMMARY CARDS                                                         │
│ PPG | RPG | APG | TS% | Last 5 | Last 10                                    │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────┬───────────────────────────────┐
│ TREND CHARTS (8 cols)                       │ QUICK SPLITS (4 cols)         │
│ Rolling averages                             │ Home/Away                     │
│ Shooting trend                               │ Wins/Losses                   │
│ Usage/efficiency trend if available          │ Last 5 / Last 10             │
└──────────────────────────────────────────────┴───────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ GAME LOG TABLE                                                              │
│ Date | Opp | MIN | PTS | REB | AST | STL | BLK | FG | 3PT | FT | +/-        │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Required Modules

### A. Player Header / Selector
**Priority:** Primary

Contents:
- player dropdown or selector
- player name
- quick season snapshot

### B. Trend Summary Cards
**Priority:** Primary

Contents:
- recent averages
- key efficiency indicator(s)
- last 5 / last 10 anchor metrics

### C. Trend Charts
**Priority:** Primary

Minimum charts:
- rolling scoring trend
- one additional trend chart (rebounds, assists, efficiency, or selected metric)

### D. Quick Splits
**Priority:** Secondary

Examples:
- home vs away
- wins vs losses
- last 5 vs season

### E. Game Log Table
**Priority:** Primary

Dense table with sortable columns.

---

# 4. Schedule Page

## Purpose

Provide a clean view of upcoming Clippers schedule and contextual game information, especially odds.

## Page-Level Hierarchy

Priority order:

1. upcoming games table
2. next game emphasis
3. odds availability
4. supporting schedule context

## Grid Structure

Mostly single-column full-width table page.

## Page Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ NEXT GAME SUMMARY                                                           │
│ Opponent | Date | Time | Home/Away | Spread | Moneyline | Total             │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ UPCOMING GAMES TABLE                                                        │
│ Date | Opponent | Home/Away | Time | Spread | Moneyline | O/U | Status      │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ SUPPORTING SCHEDULE CONTEXT                                                 │
│ Rest days | Back-to-back note | travel density | notable stretch            │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Required Modules

### A. Next Game Summary
**Priority:** Primary

Highlights the next upcoming Clippers game.

### B. Upcoming Games Table
**Priority:** Primary

Required columns:
- date
- opponent
- home/away
- time
- spread
- moneyline
- over/under
- status / odds availability

### C. Supporting Schedule Context
**Priority:** Secondary

Possible modules:
- rest advantage/disadvantage
- back-to-back flags
- stretch difficulty note

## Missing Odds State

If odds are unavailable:
- keep schedule row visible
- replace odds with hidden/blank or unavailable marker
- do not invent values

---

# 5. Historical Explorer

## Purpose

Allow the user to browse past Clippers seasons and games without becoming a full research platform.

This page is a browser/index page.

## Page-Level Hierarchy

Priority order:

1. season selector
2. game list
3. game summary context
4. drill-in path to game detail

## Grid Structure

12-column layout:
- top controls (12)
- game list/table (12)
- optional secondary summary row above table

## Page Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ SEASON SELECTOR / FILTERS                                                   │
│ Season dropdown | basic filters                                             │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ SEASON SUMMARY                                                              │
│ Record | Net Rating | Playoff Result | Key Notes                            │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ GAME LIST                                                                   │
│ Date | Opponent | Result | Score | Home/Away | OT? | Link to detail         │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Required Modules

### A. Season Selector / Filters
**Priority:** Primary

Minimum:
- season dropdown

Optional MVP filter:
- home/away
- wins/losses

### B. Season Summary
**Priority:** Secondary

Simple summary row for selected season.

### C. Game List
**Priority:** Primary

Dense table with click-through to game detail.

---

# 6. Historical Game Detail View

## Purpose

Show one historical Clippers game in enough detail to review box score and generated insights.

## Page-Level Hierarchy

Priority order:

1. game header
2. box score
3. generated insights
4. supporting context

## Grid Structure

12-column layout:
- row 1: game header (12)
- row 2: main content split 8/4
- row 3: lower support section (12)

## Page Wireframe

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ GAME HEADER                                                                 │
│ Date | Opponent | Final Score | Home/Away | Overtime | Season               │
└──────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────┬───────────────────────────────┐
│ BOX SCORE / TEAM STATS (8 cols)             │ GAME INSIGHTS (4 cols)        │
│ Player tables                                │ Historical insight tiles      │
│ Team totals                                  │ Milestones / streak context   │
└──────────────────────────────────────────────┴───────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│ SUPPORTING CONTEXT                                                          │
│ Quarter breakdown | advanced stat summary | notes                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

## Required Modules

### A. Game Header
**Priority:** Primary

### B. Box Score / Team Stats
**Priority:** Primary

### C. Historical Insights
**Priority:** Primary

These insights follow the same proof rules as live/generated insights.

### D. Supporting Context
**Priority:** Secondary

---

# Shared States and UX Contracts

## Loading State
For all major pages:

- use skeleton blocks, not spinners-only
- preserve final layout footprint
- do not collapse major modules while loading

## Error State
For all major pages:

- preserve page shell
- show concise error message in-module
- do not replace whole page with blank error unless catastrophic failure

## Empty State
Should be practical and compact.

Examples:
- no odds available
- no live game active
- no historical data for selected filter

## Data Delayed State
Live pages must support a “data delayed” indicator without breaking layout.

---

# Navigation Expectations

MVP navigation should expose:

- Home
- Live
- Players
- Schedule
- History

Recommended nav placement:
- persistent top navigation or left rail
- top navigation is simpler for MVP

---

# Cross-Page Consistency Rules

These rules apply to all screens:

- box score style should remain consistent everywhere
- insight tile structure should remain consistent everywhere
- section titles should use the same hierarchy and spacing rules
- data-dense tables must always favor visibility over decorative spacing
- sidebars must remain visually secondary to primary Clippers content

---

# Ship-Ready Notes

This file is complete enough to support:

- design-system enforcement
- DB schema planning
- API planning
- GSD phase planning
- UI implementation without layout guessing

After this file, the next planning artifacts should be:

1. `docs/DB_SCHEMA.sql`
2. `docs/DATA_DICTIONARY.md`
3. `docs/API_SPEC.md`
