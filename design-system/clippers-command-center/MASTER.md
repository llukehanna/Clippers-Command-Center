# Clippers Command Center — Design System

*Last updated: Phase 10.1 — Design System Refinement*
*Canonical source of truth for Phases 11–14*

---

## Design Philosophy

- **References (priority order):** Apple Sports (hierarchy/restraint), Linear (spacing, borders, surfaces), Raycast (compact premium dark), Vercel dashboard (clean analytics), Superhuman (typography precision)
- **Tone:** Calm, restrained. Prefer restraint over decoration at every decision point.
- **Density:** High information density, highly readable — Linear/Raycast compactness.
- **Elevation model:** Subtle surface layering (`background` → `surface` → `surface-alt`). Not heavy raised cards.
- **Not:** Generic admin dashboard, heavy cards, over-decorated surfaces, color overuse.

---

## Color Tokens

All values defined in `app/globals.css` `:root` and `.dark` blocks (identical — dark-only design).

### Base palette

| Token | Value | Use |
|-------|-------|-----|
| `--background` | `#090B10` | Page background — deep blue-black |
| `--foreground` | `#EDEFF2` | Primary text — near-white, slightly warm |
| `--surface` | `#141620` | Elevated surfaces: cards, panels, table heads |
| `--surface-alt` | `#1C2030` | Second elevation: hover areas, tooltips |
| `--muted` | `rgba(255,255,255,0.05)` | Skeleton shimmer base, subtle fills |
| `--muted-foreground` | `rgba(255,255,255,0.45)` | Secondary text, labels, captions |
| `--border` | `rgba(255,255,255,0.06)` | Hairline borders — visible but not assertive |
| `--ring` | `rgba(255,255,255,0.12)` | Focus rings |

### Brand colors (use sparingly)

| Token | Value | Use |
|-------|-------|-----|
| `--primary` | `#C8102E` | Clippers red — active states, live indicator, critical accents ONLY |
| `--secondary` | `#1D428A` | Clippers blue — data highlights, not UI chrome |

### Semantic colors

| Token | Value | Use |
|-------|-------|-----|
| `--positive` | `#34D399` | Positive deltas, favorable stats |
| `--negative` | `#F87171` | Negative deltas, unfavorable stats |

### Chart palette (4-color set — exhaustive for MVP)

| Token | Value | Use |
|-------|-------|-----|
| `--chart-1` | `#60A5FA` | Blue-400 — primary series |
| `--chart-2` | `#34D399` | Emerald-400 — secondary series |
| `--chart-3` | `#FBBF24` | Amber-400 — tertiary series |
| `--chart-4` | `#F87171` | Red-400 — quaternary / negative emphasis |

### Special

| Token | Value | Use |
|-------|-------|-----|
| Amber pulse | `#F59E0B` / `#FBBF24` | Live dot ONLY — not used elsewhere |

### Tailwind utilities

Exposed via `@theme inline` in `globals.css`:
`bg-surface`, `bg-surface-alt`, `text-positive`, `text-negative`, `bg-chart-1` through `bg-chart-4`, `stroke-chart-1` etc.

---

## Typography

**Font:** Inter — Google Fonts, loaded via Next.js `next/font/google`.

### Scale (5 levels)

| Level | Size | Line height | Weight | Tracking | Case | Use |
|-------|------|-------------|--------|----------|------|-----|
| Page title | `1.5rem` | `2rem` | 600 | `-0.02em` | Normal | H1-level page headings |
| Section title | `0.6875rem` (11px) | `1rem` | 600 | `0.08em` | ALL CAPS | Stat card labels, table section headers |
| Stat value | `1.75rem` | `1` (leading-none) | 700 | `-0.03em` | Normal | StatCard values — visually dominant |
| Body | `0.875rem` | `1.5rem` | 400 | — | Normal | Standard text, table cell values |
| Caption | `0.75rem` | `1rem` | 400 | — | Normal | Metadata, deltas, timestamps |

**Nav labels:** `0.8125rem` (13px), weight 500, slight tracking. Wordmark: `0.875rem`, weight 700, `tracking-widest`.

**Tabular numbers:** `font-feature-settings: "tnum" 1` is global on `body` — all numbers are tabular by default. Use `tabular-nums` Tailwind class in JSX as explicit reinforcement where stat values appear.

**Table headers:** Section title scale — 11px, font-semibold, uppercase, tracking-[0.06em], muted-foreground color.
**Table cell values:** 13px (0.8125rem), right-aligned for numbers, tabular-nums.

---

## Spacing

**Base unit:** 4px.

| Token | Value | Tailwind equivalent | Use |
|-------|-------|---------------------|-----|
| `--space-1` | `4px` | `p-1`, `gap-1` | Icon gaps, micro spacing |
| `--space-2` | `8px` | `p-2`, `gap-2` | Inline, tight component internals |
| `--space-3` | `12px` | `p-3`, `gap-3` | Compact component padding |
| `--space-4` | `16px` | `p-4`, `gap-4` | Standard component padding |
| `--space-6` | `24px` | `p-6`, `gap-6` | Section gaps within a panel |
| `--space-8` | `32px` | `p-8`, `gap-8` | Between major sections |
| `--space-12` | `48px` | `p-12`, `gap-12` | Page-level vertical rhythm |

**Use Tailwind's existing spacing utilities** (p-3, p-4, gap-4 etc.) — they align with the 4px base. The `--space-N` tokens are available via `var()` for inline styles when needed.

### Component defaults

| Component | Dimension | Value |
|-----------|-----------|-------|
| TopNav height | h-12 | 48px |
| StatCard padding | px-4 py-3 | 16px / 12px |
| Table row height | h-9 | 36px |
| Section gap | gap-6 | 24px |
| Page horizontal padding | px-6 | 24px |
| Dashboard grid gap | gap-4 | 16px |

---

## Border and Radius

**Default border:** `rgba(255,255,255,0.06)` via `--border` token. Applied globally via shadcn's `@layer base`. Nearly invisible — visible in context, not assertive.
**Hairline table borders:** `rgba(255,255,255,0.04)` for row separators — even more subtle than component borders.
**Global radius:** `--radius: 0.5rem` (8px). shadcn components scale proportionally.

---

## Component Specifications

### TopNav

```
Height:      48px (h-12)
Background:  bg-background/80 backdrop-blur-md
Border:      border-b border-white/[0.06]
Wordmark:    0.8125rem font-bold tracking-widest text-foreground
Nav links:   gap-5 (20px between links), gap-6 from wordmark to links
Active link: border-b border-primary pb-0.5 (1px, not 2px)
Inactive:    text-[rgba(255,255,255,0.45)] hover:text-foreground
LiveDot:     Amber pulsing — h-2 w-2, bg-amber-500, animate-ping bg-amber-400
```

### StatCard

```
Surface:     bg-surface (not Card wrapper — use plain div)
Border:      border border-white/[0.06]
Radius:      rounded-lg (driven by --radius: 0.5rem)
Padding:     px-4 py-3 (16px / 12px)
Label:       0.6875rem, font-semibold, uppercase, tracking-[0.08em], text-muted-foreground
Value:       1.75rem, font-bold, tabular-nums, leading-none, tracking-[-0.03em], text-foreground
Delta/ctx:   0.75rem, leading-none — text-positive or text-negative for deltas, text-muted-foreground otherwise
Hover:       NONE — StatCard is display-only, no interactive states
```

### BoxScoreTable

```
Outer:       No card border — table floats in section context (overflow-y-auto rounded-md only)
thead:       sticky top-0 z-10 bg-surface border-b border-white/[0.04]
th:          px-3 py-2, 0.6875rem, font-semibold, uppercase, tracking-[0.06em], text-muted-foreground
             right-aligned for numeric columns
tr (data):   border-b border-white/[0.04] last:border-0, hover:bg-white/[0.03], h-9 (36px)
td:          px-3 py-2, 0.8125rem, text-right + tabular-nums for numbers, text-left for names
Name col:    font-medium, text-foreground (slightly more weight than stat columns)
Gridlines:   Horizontal only. NO vertical separators.
```

### Charts (LineChartWrapper, BarChartWrapper)

```
CartesianGrid:  strokeOpacity={0.08}, vertical={false}, no dashes (strokeDasharray="")
Axes:           axisLine={false}, tickLine={false}, tick {{ fontSize: 11, fill: 'var(--muted-foreground)' }}
Tooltip:        bg-[var(--surface-alt)], border border-white/[0.06], px-3 py-2, 0.8125rem text
Series colors:  Default to CHART_COLORS array ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)']
Titles:         NONE inside wrappers — section titles above provide context
Fill gradients: None by default
```

### Skeletons

```
Base color:   bg-muted (driven by --muted: rgba(255,255,255,0.05))
Animation:    animate-pulse (Tailwind built-in)
StatCardSkeleton:  Outer matches StatCard (bg-surface, border-white/[0.06], px-4 py-3)
                   label: h-[0.6875rem] w-20, value: mt-1.5 h-[1.75rem] w-16, context: mt-1 h-3 w-24
BoxScoreSkeleton:  Matches BoxScoreTable: header row + 5 data rows at h-9
ChartSkeleton:     Full-width Skeleton at chart height (default 200px)
```

### StaleBanner

```
Container:    bg-amber-950/40 border-b border-amber-800/30 px-6 py-2
Text:         0.75rem text-amber-400
Tone:         Informational only — "Data delayed — last updated X min ago"
Icon:         Small amber icon + text (no bold, no all-caps)
```

---

## Anti-Patterns

Future phases must avoid:

- **Hardcoding hex in JSX** — All colors via CSS variables. If a token doesn't exist, add it to `globals.css` first.
- **Using Tailwind color scale directly** (`slate-800`, `gray-600`) — These bypass the token system. Use `bg-surface`, `text-muted-foreground` etc.
- **Heavy borders** — No `#334155` or `slate-700` borders. Default is `rgba(255,255,255,0.06)`.
- **Hover lift on stat cards** — StatCard is display-only. Hover belongs on interactive elements only.
- **Thick active nav underline** — `border-b` (1px) not `border-b-2` (2px).
- **Vertical chart gridlines** — `vertical={false}` always.
- **Dashed chart gridlines** — `strokeDasharray=""` for solid hairlines.
- **Over-carding** — Not every section needs a card border. Layout regions can be separated by spacing and subtle section headers.
- **Color decoration** — Clippers red (`--primary`) is for active states and live signals only. Not decoration.
- **Adding `.dark` values different from `:root`** — dark-only design; both blocks are identical.

---

## Tailwind v4 Patterns

This project uses Tailwind v4 with `@theme inline` in `globals.css`:

- All design tokens are CSS custom properties in `:root`
- `@theme inline` maps select tokens to Tailwind utility names
- `border-white/[0.06]` — arbitrary opacity on built-in Tailwind colors (valid syntax)
- `bg-[var(--surface-alt)]` — arbitrary CSS variable reference (valid syntax)
- Do not map spacing tokens through `@theme inline` — conflicts with Tailwind's own spacing scale

---

*This document is auto-updated by the GSD planning workflow. Do not edit manually.*
*Source: Phase 10.1 CONTEXT.md decisions, implemented in Plans 01–02.*
