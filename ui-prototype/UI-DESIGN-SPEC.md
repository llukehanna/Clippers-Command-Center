# Clippers Command Center — Full UI Design Specification

This document specifies the complete UI design for the CCC live prototype and product direction. It extends the vision in `UI-Prototype.rtf` with concrete layout, hierarchy, components, polish rules, **interaction and hover behavior**, **surface treatment and liquid-glass influence**, and **surface layering (z-depth)** so the UI feels physically elevated, tactile, and premium (Apple Sports, Raycast, Vercel).

---

## 1. Product identity and design direction

### 1.1 Role of the product

- **Clippers Command Center (CCC)** is a premium analytics terminal for Clippers fans.
- It combines the power of an analytics dashboard with the polish of modern software (Vercel, Linear, Apple Sports, Raycast).
- **Experience balance:** ~70% command center / analytics terminal, ~30% premium sports application.
- Goal: the interface serious Clippers fans prefer during games for deeper insight and situational awareness.

### 1.2 Design tone

- Premium, polished, crisp, intentional, modern software-grade.
- **Avoid:** generic dashboards, sportsbook UIs, fantasy sports layouts, outdated stat-site aesthetics (e.g. Basketball Reference).
- Closer to high-end developer/analytics tools than traditional sports websites.

### 1.3 Design inspiration (weighted)

| Weight | Source    | Use |
|--------|-----------|-----|
| 30%    | Vercel    | Layout structure, modular analytics cards, data hierarchy |
| 30%    | Linear    | Typography discipline, spacing, borders, hierarchy |
| 25%    | Apple Sports | Scoreboard hierarchy, team identity, logos, live indicator |
| 10%    | Raycast   | Dark mode polish, floating surfaces, hover capsules |
| 5%     | Superhuman | Interaction quality, subtle motion |

---

## 2. Color and theme

### 2.1 Base palette (dark only)

- **Background:** Deep Clippers navy–leaning dark (`--background`). Key surfaces use `--surface` and `--surface-alt` so the product feels navy-tinted, not generic blue-black.
- **Foreground:** Near-white primary text (`--foreground`).
- **Muted:** Secondary text and labels (`--muted-foreground`).
- **Borders:** Hairline, low opacity (`border-white/[0.06]` to `0.08`). Restrained, not heavy.

### 2.2 Brand colors

- **Clippers red (`--primary`):** Accent only — active nav tab, live indicator dot, category labels, critical highlights. Never the main fill.
- **Clippers navy (`--secondary`):** Dominant dark tone for key surfaces and subtle gradients/glows. Used for tonal shift (e.g. very subtle gradient at bottom of scoreboard), not bright UI chrome.

### 2.3 Surface treatment

- **Scoreboard hero:** Premium dark surface. No strong gradient; optional very subtle Clippers navy tonal shift (e.g. linear gradient from solid `--surface-alt` to a hint of `--secondary` at bottom). Should feel like a single dark panel, not a visible “gradient card.”
- **Floating panels:** Slight elevation via shadow and optional light border/ring. Subtle backdrop blur where appropriate (liquid-glass influence) without heavy glassmorphism.

---

## 3. Typography

### 3.1 Hierarchy (Linear-inspired)

- **Tier 1 — Hero:** Score numbers and dominant stats. Largest on page (e.g. `text-7xl`), bold, tabular-nums.
- **Tier 2 — Module titles:** Section titles, card headings. Small (e.g. 11px / 0.6875rem), semibold, uppercase, tracking.
- **Tier 3 — Labels / metadata:** Very small, uppercase, muted, wider tracking (Vercel/Linear metadata style). Used for metric card labels and table headers (e.g. 10px / 0.625rem, tracking 0.12em).
- **Body / values:** Standard readable size for table cells and supporting copy (e.g. 0.8125rem–0.875rem).

### 3.2 Metric cards

- **Label:** Very small, uppercase, muted, wider tracking. Should feel like metadata, not a loud title. Stat value remains dominant.
- **Value:** Large, bold, tabular-nums (e.g. 1.75rem).
- **Support:** Small muted line below (e.g. 0.75rem).

---

## 4. Layout and structure

### 4.1 Global layout

- **Max width:** 1440px, centered.
- **Horizontal padding:** 24px (e.g. `px-6`).
- **Section spacing:** Consistent vertical rhythm (e.g. `gap-6`, `mt-6`, `mt-8`).
- **Grid:** 12-column desktop grid where needed (e.g. main 8 cols + sidebar 4 cols).

### 4.2 Live page structure (order)

1. Centered floating navigation bar  
2. Scoreboard hero  
3. Key analytics metrics row  
4. Main content area: box score (8 cols) + insights sidebar (4 cols)  

Layout and information hierarchy stay fixed; polish is applied within this structure.

---

## 5. Navigation

### 5.1 Placement and form

- **Centered floating bar.** Not full-width; not attached to viewport edges.
- **Prototype:** Legacy app TopNav is hidden on `/live/prototype` so only this floating nav is visible.

### 5.2 Floating nav surface (elevated, liquid-glass)

The nav must feel **physically elevated above the page**, not like a rounded dark bar sitting on the background.

- **Translucency:** Semi-transparent background (e.g. `rgba(20, 22, 32, 0.72)`) so the page shows through; increases contrast between nav and background.
- **Backdrop blur:** Strong blur (e.g. `backdrop-blur-2xl`) for a frosted, glass-like bar.
- **Soft inner highlight:** Inset box-shadow (e.g. `0 0 0 1px rgba(255,255,255,0.06) inset`) so the surface reads as softly lit from above.
- **Faint outer edge / ring:** Visible border (e.g. `border-white/[0.12]`) and optional outer ring or second shadow (e.g. `0 0 1px 0 rgba(255,255,255,0.08)`) for a clear edge.
- **Elevation shadow:** Pronounced drop shadow (e.g. `0 24px 64px -12px rgba(0,0,0,0.85)`) so the bar reads as hovering above the content.
- **Shape:** Rounded pill (e.g. `rounded-2xl`). Premium and tactile.

### 5.3 Content

- Wordmark “CCC” (left).
- Links: Home, Live, Players, Schedule, History.
- **Active tab (Live):** Clippers red accent — visible pill with border, light red tint background, and optional soft red inner glow. Reads as “selected,” not hovered.

### 5.4 Nav hover (Raycast / Apple Sports–style)

Hovered nav items must feel **clearly hovered** and tactile, not just a text color change.

- **Visible hover capsule:** A rounded pill appears **behind** the hovered link (absolute-positioned span, full pill shape). Not just background on the text.
- **Elevated, softly lit:** Pill uses a brighter tint (e.g. `bg-white/[0.1]`), a **soft inner edge highlight** (inset box-shadow, e.g. `0 0 0 1px rgba(255,255,255,0.12) inset`), and a faint drop shadow (e.g. `0 1px 2px rgba(0,0,0,0.2)`) so it feels raised and lit.
- **Smooth transitions:** `transition-all duration-200 ease-out` on the pill (opacity, scale, shadow).
- **Slight scale:** Pill scales up on hover (e.g. `scale-[1.04]`) for tactility; text stays crisp.
- **Text:** Inactive items are muted; on hover, text can brighten to foreground for clarity.
- **Active tab:** Keeps Clippers red treatment; no scale on active so “selected” is distinct from “hovered.”

---

## 6. Scoreboard hero

### 6.1 Role

- The scoreboard is the most important element on the live page. It must visually dominate and act as the anchor.

### 6.2 Structure

- **Two teams:** Each side has (1) team logo, (2) team abbreviation, (3) score.
- **Layout (Apple Sports–style):**
  - Logo and score sit cleanly next to each other (logo first for away, score first for home so scores are toward center).
  - Team abbreviation sits **directly below the logo**, not above the score.
- **Center block:** Game state. Hierarchy: (1) score is dominant elsewhere; (2) **clock** is most prominent in center; (3) quarter below clock; (4) LIVE indicator with a subtle red dot before the word “LIVE.”

### 6.3 Team logos

- **Size:** **Much larger** than minimal — base 80px (e.g. `h-20 w-20`), 96px on medium breakpoints and up (e.g. `md:h-24 md:w-24`). Logos should feel like a dominant part of the scoreboard, not small icons.
- **No** circular badge, outline, or ring around logos. Logos are clean image only.
- **Asset:** Real team logos (e.g. `/logos/lac.png`, `/logos/lal.png`). Rendered with Next.js `Image`, object-contain, no extra chrome.

### 6.4 Score and type

- Score: Very large (e.g. `text-7xl`), bold, tabular-nums. Remains the largest numeric element on the page.
- Clock: Prominent in center (e.g. `text-2xl`), semibold, tabular-nums.
- Quarter: Smaller, uppercase, muted (e.g. 0.6875rem, tracking 0.12em).
- LIVE: Small uppercase label with a small red dot (`bg-primary`) before the word. Red used only for the dot and text.

### 6.5 Analytics strip (below main score row)

- Single line of key live metrics (e.g. PACE, REB, FT, eFG) with values. Muted, small type. Separators (e.g. |) between items. No card treatment; part of the scoreboard surface.

### 6.6 Scoreboard hero surface (frosted glass, premium module)

The scoreboard should feel like a **premium command center module** with Apple Sports–style liquid-glass influence, not a generic dashboard panel.

- **Frosted surface:** Semi-transparent background with **backdrop blur** (e.g. `backdrop-blur-xl`) so it reads as a soft, frosted layer. Use a subtle tonal gradient (e.g. light-to-dark or slight navy shift) for variation, not a strong or visible blue gradient.
- **Softer tonal variation:** Gradient from slightly lighter to darker (e.g. `rgba(28,32,48,0.88)` → `rgba(20,22,32,0.92)`) so the surface has depth without looking like a “gradient panel.”
- **Gentle edge lighting:** Top and left edges can use a slightly brighter border (e.g. `border-t-white/[0.1]`, `border-l-white/[0.08]`) for a soft highlight and layered feel.
- **Refined layered treatment:** Combine (1) inner highlight (very subtle inset box-shadow), (2) drop shadow for elevation, (3) clear border. Reduces “flat dashboard panel” and increases “premium module.”
- **Center game-state block:** Clock/quarter/LIVE block can sit on a subtle inner surface (e.g. light tint + backdrop-blur + inset shadow) so it feels like a small nested layer.
- **Restraint:** No heavy glassmorphism; the goal is a soft, premium, modern feel aligned with Apple Sports liquid-glass and Vercel clarity.

---

## 7. Metric cards (key analytics row)

### 7.1 Structure

- One row of compact cards (e.g. 6 cards on large screens, responsive grid).
- Each card: **label** (top) → **value** (dominant) → **supporting line** (bottom). Vercel-style hierarchy.

### 7.2 Label style

- Very small (e.g. 0.625rem), uppercase, muted, wider letter-spacing (e.g. 0.12em). Feels like metadata; value stays dominant.

### 7.3 Card hover (tactile, modern)

Metric cards need **clear, tactile hover feedback** so the UI feels alive, not static.

- **Slight lift:** Translate up on hover (e.g. `-translate-y-0.5`) so the card feels like it lifts toward the user.
- **Surface brightening:** Background lightens on hover (e.g. to `surface-alt/80` or equivalent) so the card clearly “activates.”
- **Border:** Border can brighten slightly (e.g. `hover:border-white/[0.1]`).
- **Shadow:** On hover, add a soft inner highlight (inset box-shadow) and/or a slightly stronger drop shadow so the card reads as elevated.
- **Motion:** `transition-all duration-200 ease-out`. Smooth and predictable.
- **Optional:** Light backdrop blur on the card base for a subtle glass feel; keep value and label hierarchy dominant.

---

## 8. Box score table

### 8.1 Role

- Primary data module for player stats. Compact, scannable, data-terminal feel.

### 8.2 Header

- Sticky header. Slightly more premium than body: e.g. `bg-surface-alt`, slightly stronger border (e.g. border-white/[0.08]). Header typography: very small, uppercase, wider tracking (e.g. 0.625rem, 0.12em), muted. Align: left for Player, right for numeric columns.

### 8.3 Rows

- Compact row height (e.g. h-9). Horizontal dividers only; no vertical gridlines.
- **Hover:** More visible than before but still restrained (e.g. `hover:bg-white/[0.08]`). Smooth transition (e.g. duration-150).

### 8.4 Cells

- Player name: left-aligned, medium weight. Numeric cells: right-aligned, tabular-nums. Consistent padding (e.g. px-3 py-2).

---

## 9. Insights card (sidebar)

### 9.1 Structure

- Vertical stack of insight blocks. Each block: **category** (small, red/muted accent) → **headline** → **supporting line** (muted).

### 9.2 Spacing and breathing room

- Increased spacing between blocks (e.g. gap-6, pb-6 between items). Let the stack breathe; avoid cramped blocks.

### 9.3 Insight tile hover (tactile)

Insight blocks should have **clear hover feedback** consistent with metric cards.

- **Slight lift:** Translate up on hover (e.g. `-translate-y-0.5`).
- **Surface brightening:** Light background tint on hover (e.g. `hover:bg-white/[0.05]`).
- **Optional:** Very subtle inset shadow on hover so the block feels slightly elevated.
- **Motion:** `transition-all duration-200 ease-out`. Structure and copy hierarchy unchanged.

---

## 10. Floating surfaces, liquid glass, and surface layering

### 10.1 Principle

- Cards and key surfaces (nav, scoreboard, metric cards, box score container, insights container) should feel like **floating panels** with clear depth, not flat blocks on a single plane.
- **Liquid-glass influence (Apple Sports–style):** Translucency, backdrop blur, soft inner highlights, and gentle edge lighting where appropriate. Soft, premium, modern — not heavy glassmorphism or flashy transparency.
- **Raycast polish:** Floating nav that clearly sits above the page; tactile hover capsules; restrained motion.
- **Vercel clarity:** Clear visual hierarchy and layer separation; shadows and borders used consistently for elevation.

### 10.2 Surface layering (z-depth)

Create **clear visual depth** between layers using translucency, border treatment, and elevation. From back to front:

1. **Page background:** Solid (e.g. `--background`). Base layer; no blur.
2. **Floating nav:** Highest elevation. Strongest translucency + backdrop blur, soft inner highlight, faint outer edge/ring, largest drop shadow. Should read as “hovering above” the page.
3. **Scoreboard hero:** Next layer down. Frosted glass (semi-transparent + blur), subtle tonal gradient, gentle edge lighting, refined inner highlight + drop shadow. Premium command center module.
4. **Metric cards:** One step below scoreboard. Semi-transparent base, light blur optional; clear but smaller shadow; on hover: lift, brighten, stronger shadow.
5. **Box score container and insights container:** Same depth as each other. Semi-transparent dark surface, light inset + drop shadow, rounded corners. Clearly “cards” above the background but below the scoreboard.

Use **subtle changes** in opacity, border strength (e.g. white/[0.06] vs 0.08 vs 0.12), and shadow size/softness to reinforce which layer is in front. The nav should never be mistaken for part of the page; the scoreboard should read as the main hero; cards should feel like distinct panels.

### 10.3 Restraint

- Avoid strong or gimmicky shadows and excessive transparency. Premium and restrained over decorative.

---

## 11. Interaction and motion

### 11.1 General

- **transition-all** (or transition-colors/transform as needed) with short duration (150–200ms) and ease-out.
- Hover states must be **visually obvious and tactile** so the interface feels physically layered and responsive, not static. No loud or gimmicky motion.

### 11.2 Targets

- **Nav links:** Visible rounded capsule/pill behind hovered item; pill is elevated and softly lit (inset highlight + faint shadow); smooth transition; slight scale (e.g. 1.04) on the pill. Active tab: Clippers red, no scale.
- **Metric cards:** Slight lift (`-translate-y-0.5`), surface brightening, border brighten, stronger shadow (inset + drop) on hover. Smooth motion.
- **Insight tiles:** Slight lift, surface brightening, optional subtle inset shadow on hover. Same motion language as metric cards.
- **Box score rows:** Background change on hover (e.g. `hover:bg-white/[0.06]`); smooth transition. Restrained but visible.

---

## 12. Assets and tokens

### 12.1 Design tokens

- Use existing CSS variables and Tailwind theme (e.g. `--background`, `--foreground`, `--surface`, `--surface-alt`, `--primary`, `--secondary`, `--muted-foreground`). No hardcoded hex in component classNames where a token exists.

### 12.2 Logos

- Team logos: real assets (e.g. `public/logos/lac.png`, `public/logos/lal.png`). **Scoreboard size:** 80px base, 96px on md+ (e.g. `h-20 w-20`, `md:h-24 md:w-24`). No badge or ring.

---

## 13. Prototype-specific notes

- **Route:** `/live/prototype` renders only the live prototype component. Legacy app TopNav is hidden on this route.
- **Data:** Prototype uses in-component placeholder data only (no API or hooks).
- **Matchup:** Example matchup LAC vs LAL; logos and copy reflect that.
- This spec describes the intended visual and interaction design; the live prototype component (`live-prototype.tsx`) implements it for the live dashboard view.

---

*This spec is the single source of truth for the live prototype UI design and should be updated when the design direction or components change.*
