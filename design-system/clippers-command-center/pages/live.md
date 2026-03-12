# Live Page Overrides

> **PROJECT:** Clippers Command Center
> **Generated:** 2026-03-05 17:39:20
> **Page Type:** Dashboard / Data View

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1400px or full-width
- **Grid:** 12-column grid for data flexibility
- **Sections:** 1. Hero (Topic + Timer + Form), 2. What you'll learn, 3. Speaker Bio, 4. Urgency/Bonuses, 5. Form (again)

### Spacing Overrides

- **Content Density:** High — optimize for information display

### Typography Overrides

- No overrides — use Master typography

### Color Overrides

- **Strategy:** Urgency: Red/Orange. Professional: Blue/Navy. Form: High contrast white.

### Component Overrides

- Avoid: Single row actions only
- Avoid: Auto-play high-res video loops

---

## Page-Specific Components

- No unique components for this page

---

## Recommendations

- Effects: Real-time chart animations, alert pulse/glow, status indicator blink animation, smooth data stream updates, loading effect
- Data Entry: Allow multi-select and bulk edit
- Sustainability: Click-to-play or pause when off-screen
- CTA Placement: Hero (Right side form) + Bottom anchor

# Live Page Overrides

> **PROJECT:** Clippers Command Center
> **Generated:** 2026-03-05 17:39:20
> **Page Type:** Live Game Dashboard

> ⚠️ **IMPORTANT:** Rules in this file **override** the Master file (`design-system/clippers-command-center/MASTER.md`).
> Only deviations from the Master are documented here. For all other rules, refer to the Master.

---

## Page-Specific Rules

### Layout Overrides

- **Max Width:** 1440px or full-width when needed for box score visibility.
- **Grid:** 12-column desktop grid.
- **Above-the-fold priority order:**
  1. Scoreboard band
  2. Key team metrics
  3. Main box score table
  4. Insight tiles
  5. Secondary league context
- **Primary page regions:**
  - Top: Scoreboard band spanning full width
  - Main left / center: box score + key metrics
  - Main right: rotating insight tiles + other-games context
  - Lower section: deeper team/player context or trend modules

### Spacing Overrides

- **Content Density:** Very high — optimize for rapid scanning during live games.
- **Card Padding:** Prefer `12px` for dense modules unless readability suffers.
- **Table Density:** Keep rows compact so a meaningful number of players are visible without excessive scrolling.

### Typography Overrides

- **Score Display:** Use the largest numeric size in the system for team scores.
- **Metadata:** Quarter, clock, possession, and status labels should be visually subordinate to score.

### Color Overrides

- Use Clippers primary/secondary accents only for:
  - active team emphasis
  - selected states
  - key comparison highlights
- Use `--color-highlight` for alerts, momentum, and noteworthy live moments.
- Do not use bright alert colors continuously across the page.

### Motion and Update Rules

- Live data updates must not cause layout shift.
- Avoid blinking indicators except for small, isolated live-status markers.
- Insight rotation and score updates must feel stable, not flashy.
- Prefer subtle transitions and content replacement over animated movement.

### Component Overrides

#### Scoreboard Band
- Must remain pinned to the top of the page flow.
- Must clearly show:
  - Clippers score
  - opponent score
  - quarter / period
  - game clock
  - status / possession if available
- Score values must dominate the band visually.

#### Key Metrics Row
- Should appear directly below the scoreboard.
- Use compact stat cards for the most important live metrics.
- Prioritize metrics that explain the current game state, such as:
  - rebound margin
  - turnover margin
  - shooting efficiency
  - pace / foul pressure / free throw edge when relevant

#### Box Score Table
- The box score is the primary analytical module on the page.
- Keep it visible high on the page.
- Prioritize player visibility over decorative spacing.
- Support horizontal compression before forcing excessive vertical growth.

#### Insight Tiles
- Show **2–3 insight tiles** simultaneously.
- Keep tile heights stable.
- Use short headlines and one supporting line only.
- Insights should feel editorial, not like notifications.

#### Other Games Context Panel
- Show only games relevant to the Clippers.
- Each item should include:
  - matchup
  - score
  - time / status
  - one short Clippers-relevant note when available
- This panel is secondary and must never visually overpower Clippers data.

---

## Page-Specific Components

### Recommended Unique Modules

- **Momentum / Game State Strip**
  - Compact module showing runs, clutch state, or current game swing.
- **Other Games Context Panel**
  - Secondary sidebar panel for Clippers-relevant league activity.

---

## Explicit Anti-Patterns for This Page

- ❌ Hero sections
- ❌ Forms or CTA blocks
- ❌ Speaker / webinar / event layouts
- ❌ Large decorative banners
- ❌ Auto-play video
- ❌ Heavy glow/pulse effects for every live update
- ❌ Oversized padding that hides box score rows
- ❌ Long paragraph-style insight copy

---

## Live Page Delivery Checklist

- [ ] Scoreboard band is visually dominant and readable at a glance
- [ ] Key metrics appear directly below the scoreboard
- [ ] Box score table remains one of the first visible modules on page load
- [ ] Insight tile rotation does not move surrounding layout
- [ ] Other-games context stays visually secondary
- [ ] Live updates do not create distracting motion
- [ ] Dense layout remains readable at 1280px and 1440px