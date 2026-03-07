# Phase 10: Core UI Framework - Context

**Gathered:** 2026-03-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Build the base frontend shell — navigation layout, layout grid, and all reusable components — so page implementations (Phases 11–14) compose from working parts. No page-specific data logic here. Deliverables: root layout, sticky top nav, stat card component, box score table component, chart wrappers, skeleton loaders, and a design system token configuration.

</domain>

<decisions>
## Implementation Decisions

### Navigation
- **Layout:** Sticky top bar spanning full width. Remains pinned while scrolling.
- **Logo area:** "CCC" text mark on the left, no logo image required.
- **Page links (left to right):** Live / Home / Players / Schedule / History
- **Active state:** Underline with accent color (Clippers red or blue) on the active tab. Inactive tabs use muted text color.
- **Live indicator:** Small pulsing dot displayed next to the "Live" label when a Clippers game is active (driven by API response state). Amber or red dot, subtle animation.
- **Nav content:** Wordmark + page links only. No timestamps, no utility info on the right side.

### Live data refresh pattern
- **Live page:** Client Component using SWR with `refreshInterval: 12000` (~12s polling). SWR handles stale-while-revalidate, focus/blur deduplication, and error state automatically.
- **Other pages (Home, Players, Schedule, History):** React Server Components — data fetched server-side, no client-side polling. Simpler and faster initial load for non-live content.
- **Stale state display:** When `meta.stale = true` (poll daemon down), show a non-blocking banner just below the scoreboard band: "Data delayed — last updated X min ago". Data still renders; user is informed without being blocked.
- **Initial loading state:** Skeleton loaders matching the layout shape for all pages. Use shadcn `Skeleton` component. Prevents layout shift on load.

### shadcn/ui integration
- **Approach:** Configure shadcn as the design system foundation. Update `globals.css` with dark-mode CSS variables matching the design system (Clippers colors, Inter font, spacing tokens). Use shadcn components styled to match — do not fight the defaults, override via CSS variables.
- **Core components to install:** Table, Skeleton, Badge, Button, Card, Tooltip
  - Table → box score tables with sticky header + sort
  - Skeleton → loading states on all pages
  - Badge → live status indicators, insight category labels
  - Button → nav or filter actions (used sparingly)
  - Card → stat card wrapper, panel containers
  - Tooltip → stat label explanations on hover

### Box score table behavior
- Sticky column header: stays visible while scrolling through player rows
- Sortable columns: click any stat header to sort ascending/descending
- Numeric alignment: right-aligned
- Row highlight on hover
- Compact row height (design system: minimize padding, maximize visible player rows)

### Chart wrappers
- **Build in Phase 10:** Two generic Recharts wrappers: `<LineChart>` and `<BarChart>`
- **API:** `data` array + `series[]` (key, color, label) + optional `title` and `height`. The wrapper handles Recharts internals, dark mode palette, axis formatting, and responsive container.
- **Hover tooltips:** Yes — custom dark-styled Recharts `<Tooltip>` showing value + series label on hover.
- **Usage:** These wrappers are consumed by Phase 12 (Home Dashboard team trends), Phase 13 (Player Trends rolling averages), and Phase 14 (History charts if any).

### Claude's Discretion
- Exact Recharts axis label formatting (abbreviate large numbers, handle null gracefully)
- Loading skeleton shape details for each component
- Error boundary placement and fallback UI
- SWR fetcher implementation (standard `fetch`, no custom middleware needed)
- Exact CSS variable names to map design system tokens to shadcn's CSS variable slots
- Whether `useParams`/`usePathname` or a context provides active nav state

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/db.ts`: Next.js-safe `sql` singleton — already exists, Phase 10 does not touch it
- `src/lib/api-utils.ts`: API helpers (meta envelope, error formatting) — Server Components can import these or just `fetch`
- `src/lib/types/live.ts`: `LiveGameState` and `LiveDashboardPayload` — Client Component for live page should import these for typing SWR response
- `src/lib/odds.ts`: typed odds helpers — already abstracted, no changes needed

### Established Patterns
- All API routes return `meta: { generated_at, source, stale, stale_reason, ttl_seconds }` — SWR hook on live page should surface `meta.stale` to trigger stale banner
- `bigint` values fetched as `::text` in DB — API layer already handles this; frontend receives normal number strings

### Integration Points
- `src/app/api/` — all 10 API routes already exist; Phase 10 creates `src/app/layout.tsx`, `src/app/page.tsx` (redirect or live), and page directories
- No `src/components/` directory exists yet — Phase 10 creates it from scratch
- No `src/app/layout.tsx` exists yet — Phase 10 creates the root layout with nav
- `next.config.ts` and `tailwind.config.ts` exist but are default/empty — Phase 10 configures Tailwind with design system tokens

</code_context>

<specifics>
## Specific Ideas

- The nav live indicator (pulsing dot) is data-driven: the live page's SWR hook result can be exported or a lightweight separate SWR call to `/api/live?minimal=true` (or just check the full response) can power the dot from the nav bar.
- Insight tile rotation (used in Phase 11) should be implemented in Phase 11, not Phase 10 — Phase 10 only builds the static InsightTile card component.
- Design system already defines the full token set: colors, spacing, typography, radius, shadows — Tailwind config should map all of these exactly so downstream phases can use `bg-surface`, `text-text-primary`, etc. rather than raw hex values.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 10-core-ui-framework*
*Context gathered: 2026-03-06*
