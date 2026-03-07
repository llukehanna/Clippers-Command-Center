# Phase 10: Core UI Framework - Research

**Researched:** 2026-03-06
**Domain:** Next.js 16 App Router, Tailwind v4, shadcn/ui, Recharts 3, SWR
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Navigation layout:** Sticky top bar, full width, pinned while scrolling
- **Nav content:** "CCC" text mark left, page links (Live / Home / Players / Schedule / History), no right-side utility info
- **Active state:** Underline with Clippers red or blue on active tab; inactive = muted text
- **Live indicator:** Small pulsing dot next to "Live" when a game is active; amber or red, subtle animation; data-driven from API state
- **Live page refresh:** SWR `refreshInterval: 12000` (~12s polling); SWR handles stale-while-revalidate, focus/blur dedup, error state
- **Other pages:** React Server Components — data fetched server-side, no client-side polling
- **Stale state display:** When `meta.stale = true`, show non-blocking banner below scoreboard band: "Data delayed — last updated X min ago"
- **Skeleton loaders:** shadcn `Skeleton` component on all pages, matching layout shape
- **shadcn/ui:** Configure as design system foundation. Update `globals.css` with dark-mode CSS variables (Clippers colors, Inter font, spacing tokens). Override via CSS variables, not fighting defaults.
- **Core shadcn components to install:** Table, Skeleton, Badge, Button, Card, Tooltip
- **Box score table behavior:** sticky column header, sortable columns, right-aligned numeric, row highlight on hover, compact row height
- **Chart wrappers:** Two generic Recharts wrappers — `<LineChart>` and `<BarChart>`. API: `data` + `series[]` (key, color, label) + optional `title` and `height`. Wrapper handles Recharts internals, dark mode palette, axis formatting, responsive container.
- **Chart hover tooltips:** Custom dark-styled Recharts `<Tooltip>` showing value + series label

### Claude's Discretion
- Exact Recharts axis label formatting (abbreviate large numbers, handle null gracefully)
- Loading skeleton shape details for each component
- Error boundary placement and fallback UI
- SWR fetcher implementation (standard `fetch`, no custom middleware needed)
- Exact CSS variable names to map design system tokens to shadcn's CSS variable slots
- Whether `useParams`/`usePathname` or a context provides active nav state

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

## Summary

Phase 10 builds the frontend shell for a data-dense, dark-mode sports analytics dashboard using Next.js 16 App Router, Tailwind CSS v4, and shadcn/ui. The stack is already partially installed (Tailwind v4, shadcn CLI, Recharts 3.8.0, Lucide icons, radix-ui) but SWR is not yet in node_modules and must be added. The existing `app/layout.tsx` and `app/page.tsx` are boilerplate and must be replaced.

The design system MASTER.md already exists at `design-system/clippers-command-center/MASTER.md` with a complete token set (dark background `#0F172A`, Clippers red `#C8102E`, blue `#1D428A`, Inter font, spacing and radius tokens). The `globals.css` currently has neutral/Geist defaults — Phase 10 replaces these with the Clippers design system tokens. Tailwind v4 uses `@theme` in CSS (not `tailwind.config.ts`) for design tokens.

Key non-obvious facts: Recharts 3 introduced a `responsive` prop as an alternative to `<ResponsiveContainer>` but `<ResponsiveContainer>` still works; the `accessibilityLayer` now defaults to `true`. SWR must be installed via `npm install swr`. The shadcn table sticky-header pattern requires careful overflow management — the default Table wrapper with overflow breaks `position: sticky`. Active nav state requires a `'use client'` component using `usePathname()` from `next/navigation`.

**Primary recommendation:** Install SWR first, then replace globals.css with Clippers design tokens using Tailwind v4 `@theme`, install shadcn components in one pass, build nav + layout, then build the three reusable component families (stat cards, box score table, chart wrappers).

---

## Standard Stack

### Core (already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| next | 16.1.6 | App Router, RSC, API routes | Installed |
| react | 19.2.3 | UI rendering | Installed |
| tailwindcss | ^4 | Utility CSS, `@theme` design tokens | Installed |
| shadcn (CLI) | ^3.8.5 | Component scaffolding | Installed (devDep) |
| radix-ui | 1.4.3 | Headless primitives under shadcn | Installed |
| recharts | 3.8.0 | LineChart, BarChart wrappers | Installed |
| lucide-react | ^0.577.0 | SVG icon set | Installed |
| clsx | ^2.1.1 | Conditional class names | Installed |
| tailwind-merge | ^3.5.0 | Merge Tailwind classes | Installed |
| tw-animate-css | ^1.4.0 | CSS animation utilities (pulsing dot) | Installed |

### Must Install
| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| swr | ^2 | Client-side polling on live page | Not in node_modules; required by CONTEXT decision |

**Installation:**
```bash
npm install swr
```

### shadcn Components to Install
Run one by one via shadcn CLI:
```bash
npx shadcn@latest add table skeleton badge button card tooltip
```

---

## Architecture Patterns

### Project Structure (Phase 10 creates)
```
src/
  app/
    layout.tsx          # Root layout — replace boilerplate with nav + dark bg
    page.tsx            # Root page — redirect to /live or /home
    live/
      page.tsx          # Stub: "use client" placeholder for Phase 11
    home/
      page.tsx          # Stub: RSC placeholder for Phase 12
    players/
      page.tsx          # Stub: RSC placeholder for Phase 13
    schedule/
      page.tsx          # Stub: RSC placeholder for Phase 12
    history/
      page.tsx          # Stub: RSC placeholder for Phase 14
  components/
    ui/                 # shadcn auto-generated (Table, Skeleton, Badge, Card, Button, Tooltip)
    nav/
      TopNav.tsx        # Server Component shell — imports NavLinks client component
      NavLinks.tsx      # 'use client' — usePathname() for active state
      LiveDot.tsx       # 'use client' — lightweight SWR call for pulsing indicator
    stat-card/
      StatCard.tsx      # Server-compatible, props-driven
    box-score/
      BoxScoreTable.tsx # 'use client' — sortable, uses shadcn Table primitives
    charts/
      LineChartWrapper.tsx   # 'use client' — wraps Recharts LineChart
      BarChartWrapper.tsx    # 'use client' — wraps Recharts BarChart
    skeletons/
      StatCardSkeleton.tsx
      BoxScoreSkeleton.tsx
      ChartSkeleton.tsx
    stale-banner/
      StaleBanner.tsx   # Conditional banner, props-driven
```

### Pattern 1: Server/Client Split for Navigation

The root layout is a Server Component. Navigation shell lives in `TopNav.tsx` (Server). Active link detection requires `usePathname()` which is client-only — extract into `NavLinks.tsx` with `'use client'`. The live indicator dot needs a SWR call — extract into `LiveDot.tsx` with `'use client'`.

```tsx
// src/components/nav/NavLinks.tsx
'use client'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

const NAV_ITEMS = [
  { href: '/live', label: 'Live' },
  { href: '/home', label: 'Home' },
  { href: '/players', label: 'Players' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/history', label: 'History' },
]

export function NavLinks() {
  const pathname = usePathname()
  return (
    <nav className="flex items-center gap-6">
      {NAV_ITEMS.map(({ href, label }) => {
        const isActive = pathname === href || pathname.startsWith(href + '/')
        return (
          <Link
            key={href}
            href={href}
            className={`text-sm font-medium transition-colors duration-150 ${
              isActive
                ? 'text-foreground border-b-2 border-primary pb-0.5'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
```

### Pattern 2: Tailwind v4 Design Token Configuration

In Tailwind v4, tokens are defined in CSS using `@theme` — not in `tailwind.config.ts`. The existing `globals.css` uses default shadcn neutral tokens. Phase 10 replaces `:root` variables with Clippers design system values.

```css
/* app/globals.css — replace :root and .dark blocks */
@theme inline {
  /* Map design system to Tailwind utility names */
  --color-background: var(--background);
  --color-surface: var(--color-surface-raw);
  --color-primary: var(--color-primary-raw);
  /* ... etc */
}

:root {
  /* Clippers dark theme as default */
  --background: #0F172A;
  --color-surface-raw: #111827;
  --color-surface-alt: #1F2937;
  --color-primary-raw: #C8102E;       /* Clippers red */
  --color-secondary-raw: #1D428A;     /* Clippers blue */
  --color-highlight: #F59E0B;
  --color-border: #334155;
  --foreground: #F8FAFC;
  --color-text-secondary: #CBD5E1;
  --color-positive: #22C55E;
  --color-negative: #EF4444;
  --color-neutral: #94A3B8;
  /* shadcn slot overrides */
  --card: #111827;
  --card-foreground: #F8FAFC;
  --muted: #1F2937;
  --muted-foreground: #94A3B8;
  --border: #334155;
  --primary: #C8102E;
  --primary-foreground: #F8FAFC;
  --radius: 0.75rem;
}
```

**Critical:** Tailwind v4 `@theme inline` maps CSS variable values to utility classes. Any token you want as `bg-surface`, `text-primary` etc. must have a corresponding `--color-*` entry in `@theme inline`. Use `var()` references to the `:root` variables, not raw hex, to keep dark mode toggling possible.

### Pattern 3: Recharts 3 Chart Wrapper

Recharts 3.8.0 is installed. The `responsive` prop is new in v3 but `<ResponsiveContainer>` still works and is the proven pattern. Use `<ResponsiveContainer>` for now — the `responsive` prop shorthand is less documented.

```tsx
// src/components/charts/LineChartWrapper.tsx
'use client'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'

interface Series {
  key: string
  color: string
  label: string
}

interface LineChartWrapperProps {
  data: Record<string, unknown>[]
  series: Series[]
  xKey?: string
  title?: string
  height?: number
}

export function LineChartWrapper({
  data,
  series,
  xKey = 'date',
  title,
  height = 240,
}: LineChartWrapperProps) {
  return (
    <div>
      {title && <p className="text-sm font-medium text-muted-foreground mb-2">{title}</p>}
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={data} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis dataKey={xKey} tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
          <YAxis tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} tickFormatter={formatStat} />
          <Tooltip content={<CustomTooltip />} />
          <Legend />
          {series.map(s => (
            <Line key={s.key} type="monotone" dataKey={s.key} stroke={s.color} name={s.label} dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function formatStat(v: unknown): string {
  if (v == null) return '—'
  const n = Number(v)
  if (isNaN(n)) return String(v)
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return n % 1 === 0 ? String(n) : n.toFixed(1)
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 text-muted-foreground">{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {formatStat(p.value)}
        </p>
      ))}
    </div>
  )
}
```

### Pattern 4: SWR Live Hook

```tsx
// src/hooks/useLiveData.ts  (or inline in live page)
'use client'
import useSWR from 'swr'
import type { LiveDashboardPayload } from '@/lib/types/live'

const fetcher = (url: string) => fetch(url).then(res => res.json())

export function useLiveData() {
  return useSWR<LiveDashboardPayload>('/api/live', fetcher, {
    refreshInterval: 12_000,
    revalidateOnFocus: true,
    dedupingInterval: 6_000,
  })
}
```

### Pattern 5: Sticky Header Box Score Table

The default shadcn `Table` wraps the `<table>` in a `div` with `overflow-auto`. `position: sticky` on `<thead>` does NOT work inside an element with `overflow` set. The pattern: wrap in a container with `max-h-*` and `overflow-y-auto`, then add `sticky top-0` to the `<TableHeader>` element with an opaque background.

```tsx
// BoxScoreTable.tsx — simplified pattern
<div className="max-h-[480px] overflow-y-auto rounded-md border border-border">
  <Table>
    <TableHeader className="sticky top-0 z-10 bg-surface">
      {/* sortable headers */}
    </TableHeader>
    <TableBody>
      {/* player rows with hover:bg-muted */}
    </TableBody>
  </Table>
</div>
```

For sortability, use local React state (`useState`) — no TanStack Table needed for this phase. A `sortKey` and `sortDir` state drives a `useMemo` sort of the `rows` array.

### Pattern 6: Pulsing Live Dot

```tsx
// src/components/nav/LiveDot.tsx
'use client'
import useSWR from 'swr'

export function LiveDot() {
  const { data } = useSWR('/api/live', (url) => fetch(url).then(r => r.json()), {
    refreshInterval: 30_000,  // less frequent than main live page
    revalidateOnFocus: false,
  })
  const isLive = data?.meta?.source === 'live' && !data?.meta?.stale
  if (!isLive) return null
  return (
    <span
      className="relative flex h-2 w-2"
      aria-label="Live game in progress"
    >
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" />
    </span>
  )
}
```

`animate-ping` is a built-in Tailwind animation. `tw-animate-css` (already installed) provides additional animation classes if needed.

### Anti-Patterns to Avoid
- **Landing page sections:** No hero panels, CTAs, marketing layouts — see MASTER.md anti-patterns
- **Geist font:** Replace with Inter. The current boilerplate `next/font/google` imports `Geist` — remove and use `Inter` from next/font/google
- **tailwind.config.ts for tokens in v4:** In Tailwind v4, all theme customization goes in CSS via `@theme`. `tailwind.config.ts` is used only for plugins, not theme colors
- **overflow on sticky header parent:** Do not set `overflow-auto` on the same element as the sticky target's parent — use a wrapping container
- **SWR in Server Components:** SWR only works in `'use client'` components. The live page must be a client component or have a client wrapper
- **Recharts in SSR without 'use client':** Recharts uses browser APIs — all chart wrappers must be `'use client'`

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Polling with dedup + focus-blur | Custom interval/timer logic | SWR `refreshInterval` | SWR handles tab visibility, deduplication, error state, stale-while-revalidate automatically |
| Skeleton loaders | Custom shimmer divs | shadcn `<Skeleton>` | Consistent pulse animation, already sized with className |
| Accessible tooltips | Raw hover state | shadcn `<Tooltip>` (Radix) | Keyboard accessible, portal-rendered, no z-index battles |
| Icon SVGs | Inline SVG paths | Lucide React (already installed) | Consistent 24px viewbox, treeshakeable, accessible |
| Chart responsiveness | ResizeObserver + state | `<ResponsiveContainer>` | Handles resize events, SSR safety |
| Class merging | Manual string concat | `cn()` from `@/lib/utils` (clsx + tailwind-merge) | Prevents Tailwind class conflicts on overrides |
| CSS animation for live dot | Custom keyframes | Tailwind `animate-ping` | Built-in, `prefers-reduced-motion` respected by Tailwind |

**Key insight:** The stack is already assembled and intentional. Every "simple" problem (polling, tooltips, icons, responsive charts) has a pre-selected solution. Custom implementations introduce edge cases the libraries already handle.

---

## Common Pitfalls

### Pitfall 1: `position: sticky` Fails on Table Header
**What goes wrong:** Adding `sticky top-0` to `<TableHeader>` inside a default shadcn Table has no effect — the header scrolls with the body.
**Why it happens:** The shadcn Table component wraps `<table>` in `<div className="overflow-auto">`. `position: sticky` only works relative to the nearest ancestor with `overflow` set. The overflow div becomes the scroll container and the sticky reference, but sticky children need the scroll container to be the *outer* element.
**How to avoid:** Restructure so the outer container has `max-h-* overflow-y-auto` and the `<table>` is a direct child. In practice, wrap with a custom div rather than relying on the shadcn Table's default wrapper div. Add `bg-[color]` to `<TableHeader>` to ensure rows don't show through.
**Warning signs:** Header scrolls away when scrolling the player list.

### Pitfall 2: Recharts Components Rendered Without `'use client'`
**What goes wrong:** Build errors or hydration mismatches when chart components are used in Server Components.
**Why it happens:** Recharts uses browser APIs (`ResizeObserver`, SVG measurement). Next.js 16 App Router makes all components Server Components by default.
**How to avoid:** Every file that imports from `recharts` must have `'use client'` at the top.
**Warning signs:** `TypeError: window is not defined` during build or hydration error in browser.

### Pitfall 3: Tailwind v4 `@theme` vs `:root` Confusion
**What goes wrong:** Custom CSS variables defined in `:root` are not available as Tailwind utilities like `bg-surface`.
**Why it happens:** In Tailwind v4, `@theme inline` maps variable names to utility classes. Variables defined only in `:root` without corresponding `@theme` entries become regular CSS custom properties but not Tailwind utilities.
**How to avoid:** For every token you want as a utility class (e.g. `bg-surface`, `text-text-primary`), add a `--color-surface: var(--color-surface-raw)` entry inside `@theme inline`. Define the actual hex values in `:root`.
**Warning signs:** `bg-surface` renders as no background despite the CSS variable being visible in DevTools.

### Pitfall 4: SWR Hook Called Before Install
**What goes wrong:** `Cannot find module 'swr'` at runtime or build time.
**Why it happens:** SWR is not in `package.json` or `node_modules`.
**How to avoid:** `npm install swr` before writing any component that imports it. Verify `node_modules/swr` exists.
**Warning signs:** Module resolution error on first dev run.

### Pitfall 5: Inter Font Not Loaded (Geist Left in Root Layout)
**What goes wrong:** The design system specifies Inter; the boilerplate uses Geist and Geist Mono.
**Why it happens:** `app/layout.tsx` is being replaced but the old font imports are forgotten.
**How to avoid:** Replace `Geist`/`Geist_Mono` imports in `layout.tsx` with `Inter` from `next/font/google`. Configure `font-feature-settings: "tnum" 1, "lnum" 1` via CSS for numeric stat columns.

### Pitfall 6: `activeIndex` Prop Removed in Recharts 3
**What goes wrong:** If any chart code references `activeIndex` prop on chart components, it silently does nothing (removed in v3).
**Why it happens:** Recharts 3 removed internal state props that leaked into the external API.
**How to avoid:** Use `Tooltip` for all hover-based data disclosure. Do not pass `activeIndex` to `LineChart` or `BarChart`.

### Pitfall 7: Page Stubs Block Future Phase Work
**What goes wrong:** If Phase 10 does not create the 5 page directories with minimal stubs, Phases 11–14 have nowhere to put their files without creating conflicts.
**How to avoid:** Create `src/app/live/page.tsx`, `home/page.tsx`, `players/page.tsx`, `schedule/page.tsx`, `history/page.tsx` as minimal stubs — even just `export default function Page() { return null }` — during Phase 10. Phase 10 does not implement page data logic.

---

## Code Examples

### Stat Card Component
```tsx
// src/components/stat-card/StatCard.tsx
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: string | number
  delta?: string       // e.g. "+2.3"
  context?: string     // e.g. "last 5 games"
  positive?: boolean   // drives color of delta
  className?: string
}

export function StatCard({ label, value, delta, context, positive, className }: StatCardProps) {
  return (
    <Card className={cn('p-3', className)}>
      <CardContent className="p-0 space-y-0.5">
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
        <p className="text-2xl font-semibold tabular-nums leading-none">{value}</p>
        {(delta || context) && (
          <p className={cn('text-xs', delta && positive !== undefined
            ? positive ? 'text-[var(--color-positive)]' : 'text-[var(--color-negative)]'
            : 'text-muted-foreground'
          )}>
            {delta} {context}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
```

### Root Layout Replacement
```tsx
// app/layout.tsx
import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { TopNav } from '@/components/nav/TopNav'

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'Clippers Command Center',
  description: 'Live Clippers game dashboard',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${inter.variable} font-sans antialiased bg-background text-foreground min-w-[1024px]`}>
        <TopNav />
        <main className="pt-14">   {/* offset for sticky nav height */}
          {children}
        </main>
      </body>
    </html>
  )
}
```

Note: `min-w-[1024px]` enforces the 1024px minimum per success criteria. The `dark` class on `<html>` enables shadcn dark mode variant.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `tailwind.config.js` with `theme.extend.colors` | `@theme` directive in CSS | Tailwind v4 (2025) | No JS config for tokens; all in CSS |
| `recharts` `activeIndex` prop | Use `Tooltip` hook instead | Recharts v3 | Must not pass `activeIndex` to charts |
| `<ResponsiveContainer>` only | `responsive` prop OR `<ResponsiveContainer>` | Recharts v3 | `ResponsiveContainer` still valid; prefer it for now |
| `accessibilityLayer={false}` default | `accessibilityLayer={true}` default | Recharts v3 | Charts are more accessible out of the box |
| Geist font (Next.js default) | Inter (design system spec) | Phase 10 | Replace root layout font |
| SWR 1.x | SWR 2.x | 2023 | New mutation APIs, DevTools; basic `useSWR` API unchanged |

**Deprecated/outdated:**
- `tailwind.config.ts` for color tokens: Valid for plugins but not for design tokens in v4
- Custom fetch polling with `setInterval`: Replaced by SWR `refreshInterval`

---

## Open Questions

1. **LiveDot SWR call: full `/api/live` or a minimal variant?**
   - What we know: CONTEXT.md says "lightweight separate SWR call to `/api/live?minimal=true` (or just check the full response)" — but the API route does not currently support a `?minimal=true` query param
   - What's unclear: Whether to call the full `/api/live` (larger payload) or add a minimal mode to the API route (out of Phase 10 scope)
   - Recommendation: Call the full `/api/live` from `LiveDot` with `refreshInterval: 30_000` (slower than the live page's 12s). The `meta.source` field in the response is small enough to check. Avoid scope-creeping into API changes.

2. **Dark mode toggle vs. forced dark**
   - What we know: Design system is dark-first; the MASTER.md says "dark mode by default"; CONTEXT says configure dark CSS variables
   - What's unclear: Whether a light mode should be accessible at all
   - Recommendation: Force dark via `className="dark"` on `<html>`. No toggle needed for MVP. The shadcn neutral `:root` light values can remain in globals.css as-is — they won't activate unless the `dark` class is removed.

3. **`cn()` utility location**
   - What we know: shadcn expects `@/lib/utils` to export `cn`; the `components.json` alias is set to `@/lib/utils`
   - What's unclear: Whether `src/lib/utils.ts` exists (Phase 9 created other files in `src/lib/`)
   - Recommendation: Check if `src/lib/utils.ts` exists; if not, create it with `import { clsx } from 'clsx'; import { twMerge } from 'tailwind-merge'; export function cn(...inputs) { return twMerge(clsx(inputs)) }`. shadcn CLI will also create this when the first component is added.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.0.18 |
| Config file | `vitest.config.ts` (root) — currently covers `scripts/lib/**/*.test.ts` and `src/lib/**/*.test.ts` |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

Phase 10 has no dedicated v1 requirement IDs. It is a foundational phase — correctness is verified by visual inspection and smoke tests. The three success criteria map as follows:

| Success Criterion | Behavior | Test Type | Command |
|---------|----------|-----------|---------|
| Navigation routes between all 5 pages | Nav renders, links work | manual smoke | `npm run dev` — navigate each page |
| Stat cards, tables, charts render with mock data | Components render without error | manual smoke | Inspect with mock props |
| Layout respects 1024px minimum and 1280px target | `min-w-[1024px]` applied | manual smoke | Browser resize test |

No unit tests are required for Phase 10 UI components — these are presentational and verified visually. Existing test suite (`src/lib/**/*.test.ts`) must continue to pass.

### Wave 0 Gaps
- [ ] `npm install swr` — SWR not in node_modules; must be installed before any component imports it
- [ ] Verify `src/lib/utils.ts` exports `cn()` — shadcn CLI creates this, but confirm before hand-writing components

*(No new test files required — Phase 10 is UI-only with no business logic to unit test)*

---

## Sources

### Primary (HIGH confidence)
- Next.js official docs — App Router layouts, `usePathname`, linking: https://nextjs.org/docs/app/getting-started/layouts-and-pages
- Tailwind CSS v4 official docs — `@theme` directive, CSS variables: https://tailwindcss.com/docs/theme
- Recharts 3.0 migration guide (verified): https://github.com/recharts/recharts/wiki/3.0-migration-guide
- `package.json` (project root) — verified installed versions
- `components.json` — shadcn configuration (new-york style, RSC=true, lucide icons)
- `design-system/clippers-command-center/MASTER.md` — full token set and component specs
- `app/globals.css` — current shadcn neutral CSS variable baseline

### Secondary (MEDIUM confidence)
- SWR docs (verified with official swr.vercel.app source): https://swr.vercel.app/docs/with-nextjs
- shadcn/ui table sticky header pattern: https://ui.shadcn.com/blocks/table-sticky-header-01
- Active link pattern with `usePathname`: https://nextjs.org/learn/dashboard-app/navigating-between-pages

### Tertiary (LOW confidence)
- Recharts dark mode CSS variable approach — multiple blog sources agree but no single official doc: https://www.amolsidhu.com/blog/frontend-charts

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified from installed `node_modules` and `package.json`
- Architecture: HIGH — patterns verified against Next.js docs and existing project structure
- Pitfalls: HIGH — sticky header issue verified from shadcn official blocks; Recharts v3 changes verified from migration guide; Tailwind v4 verified from official docs
- SWR not installed: HIGH — confirmed from `node_modules` inspection

**Research date:** 2026-03-06
**Valid until:** 2026-04-06 (stable libraries; Tailwind v4 and Next.js 16 are current stable)
