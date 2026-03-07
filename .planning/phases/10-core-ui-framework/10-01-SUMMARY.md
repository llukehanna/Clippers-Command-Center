---
phase: 10-core-ui-framework
plan: 01
subsystem: ui
tags: [shadcn, tailwind, next.js, inter, swr, design-tokens, dark-mode, clippers]

# Dependency graph
requires: []
provides:
  - Clippers dark-mode design token system in globals.css (background #0F172A, primary #C8102E)
  - Inter font root layout with html.dark and min-w-[1024px]
  - 5 page route stubs: /live (client), /home, /players, /schedule, /history (RSC)
  - 6 shadcn UI primitives: Table, Skeleton, Badge, Button, Card, Tooltip
  - SWR installed and resolvable
affects: [11-live-dashboard, 12-home-dashboard, 13-player-explorer, 14-historical-explorer, 10-02, 10-03]

# Tech tracking
tech-stack:
  added: [swr, shadcn table/skeleton/badge/button/card/tooltip]
  patterns:
    - Clippers dark-first design tokens mapped via @theme inline CSS variables
    - Permanent dark mode via html className="dark" (no theme toggle)
    - Inter font loaded via next/font/google with --font-inter CSS variable
    - Page stubs for future phases — 'use client' for interactive, RSC for data pages

key-files:
  created:
    - app/live/page.tsx
    - app/home/page.tsx
    - app/players/page.tsx
    - app/schedule/page.tsx
    - app/history/page.tsx
    - components/ui/table.tsx
    - components/ui/skeleton.tsx
    - components/ui/badge.tsx
    - components/ui/button.tsx
    - components/ui/card.tsx
    - components/ui/tooltip.tsx
  modified:
    - app/globals.css
    - app/layout.tsx
    - app/page.tsx
    - package.json
    - package-lock.json

key-decisions:
  - "Clippers dark palette is dark-first — :root and .dark have identical hex values since html.dark is always active"
  - "shadcn CLI (not manual) used for UI primitives — keeps components in sync with registry versioning"
  - "TopNav placeholder commented in layout.tsx — uncommented in Plan 02 when TopNav component is created"
  - "font-feature-settings tnum+lnum added to body — tabular numerals required for stat column alignment"

patterns-established:
  - "Design tokens: CSS hex values in :root/.dark, mapped to Tailwind via @theme inline"
  - "Page stubs: minimal shell with phase annotation comment for future implementation"

requirements-completed:
  - foundation for LIVE-02, LIVE-03, LIVE-04, LIVE-05, LIVE-10, LIVE-11, HOME-01, HOME-02, HOME-03, HOME-04, HOME-05, HOME-06, PLAYER-01, PLAYER-02, PLAYER-03, PLAYER-04, PLAYER-05, PLAYER-06, SCHED-01, SCHED-02, SCHED-03, SCHED-04, HIST-01, HIST-02, HIST-03, HIST-04

# Metrics
duration: 12min
completed: 2026-03-06
---

# Phase 10 Plan 01: Core UI Framework — Design Tokens, Layout, Page Stubs Summary

**Clippers dark design token system (#0F172A/#C8102E), Inter font root layout, 5 page route stubs, and 6 shadcn UI primitives scaffolded via CLI with SWR installed**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-06T17:53:51Z
- **Completed:** 2026-03-06T18:05:00Z
- **Tasks:** 3
- **Files modified:** 12 (5 created pages + 6 UI components + globals.css/layout/page/package)

## Accomplishments
- Replaced boilerplate shadcn/Next.js defaults with Clippers dark palette (#0F172A background, #C8102E primary, #1D428A secondary)
- Root layout upgraded from Geist to Inter font with permanent dark class and 1024px minimum width
- All 5 page routes now exist with appropriate stubs (client stub for /live, RSC for rest)
- 6 shadcn primitives installed via CLI: Table, Skeleton, Badge, Button, Card, Tooltip

## Task Commits

Each task was committed atomically:

1. **Task 1: Install SWR and apply Clippers design tokens** - `3d873d1` (feat)
2. **Task 2: Replace root layout with Inter font and create 5 page stubs** - `26ebaa5` (feat)
3. **Task 3: Install shadcn UI primitives via CLI** - `5325e52` (feat)

## Files Created/Modified
- `app/globals.css` - Clippers dark token system: @theme inline mapped to :root/.dark hex values
- `app/layout.tsx` - Inter font, className="dark", min-w-[1024px], TopNav placeholder comment
- `app/page.tsx` - redirect('/live') replaces Next.js boilerplate
- `app/live/page.tsx` - 'use client' stub for Phase 11
- `app/home/page.tsx` - RSC stub for Phase 12
- `app/players/page.tsx` - RSC stub for Phase 13
- `app/schedule/page.tsx` - RSC stub for Phase 12
- `app/history/page.tsx` - RSC stub for Phase 14
- `components/ui/table.tsx` - shadcn Table primitive (CLI-generated)
- `components/ui/skeleton.tsx` - shadcn Skeleton primitive (CLI-generated)
- `components/ui/badge.tsx` - shadcn Badge primitive (CLI-generated)
- `components/ui/button.tsx` - shadcn Button primitive (CLI-generated)
- `components/ui/card.tsx` - shadcn Card primitive (CLI-generated)
- `components/ui/tooltip.tsx` - shadcn Tooltip primitive (CLI-generated)
- `package.json` / `package-lock.json` - SWR and Radix UI dependencies added

## Decisions Made
- Clippers dark palette uses identical hex values in both `:root` and `.dark` blocks — since `html.dark` is always active, the light root values are unreachable placeholder stubs. Design intent is dark-only.
- shadcn CLI used exclusively (no manual file creation) — ensures components stay synchronized with the shadcn registry and use correct new-york style variants.
- TopNav import left commented in layout.tsx with explicit TODO comment — Plan 02 will uncomment it once the component exists. This avoids a broken import that would crash dev server.
- `font-feature-settings: "tnum" 1, "lnum" 1` added to body — required for stat table column digit alignment (design system requirement specified in plan).

## Deviations from Plan

None — plan executed exactly as written.

Note: The plan's verify script used `grep -q 'class="dark"'` but the JSX source has `className="dark"` (correct JSX). Verified with the correct pattern — the layout renders `class="dark"` in the browser DOM as expected.

## Issues Encountered
None significant. The plan's verify grep for `class="dark"` didn't match JSX source `className="dark"` — but this is expected; the source is correct JSX and renders correctly.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 (TopNav component) can now import from all 6 shadcn primitives and use all Clippers design tokens
- Plan 03 (StatCard/component library) has Card, Badge, Skeleton primitives ready
- All 5 page routes are registered and return stubs — no 404s on navigation
- `npm test` passes: 94 tests across 11 test files, no regressions

---
*Phase: 10-core-ui-framework*
*Completed: 2026-03-06*
