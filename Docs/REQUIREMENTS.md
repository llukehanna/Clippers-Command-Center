# REQUIREMENTS.md

This document defines the **minimum functional and technical requirements for the MVP** of Clippers Command Center. Every requirement must be testable.

---

# 1. MVP Definition of Done

The MVP is considered complete when the following capabilities exist:

• Live Clippers game dashboard
• Between-games dashboard (default homepage)
• Player trends exploration
• Schedule view
• Historical game explorer

All data must be pulled from real NBA data sources and stored in the application database.

---

# 2. Functional Requirements

## 2.1 Live Game Mode

The application must detect when a Clippers game is active and automatically switch to Live Mode.

The live dashboard must display:

• live score
• game clock and quarter
• full team box score
• player box score
• contextual stats (recent games + season metrics)
• rotating insight tiles

### Live Data Refresh

• Live data must refresh approximately **every 12 seconds**.
• A snapshot of the game state must be stored on every poll.

### Run Detection

The system must detect scoring runs defined as:

**8–0 or greater scoring run by either team.**

### Clutch Detection

Clutch situations are defined as:

**last 5 minutes of the 4th quarter or overtime with score margin ≤ 8 points.**

### Insight Display

The interface must display **2–3 insight tiles simultaneously**.

Insight tiles rotate periodically or when new insights appear.

---

## 2.2 Between-Games Dashboard

When no Clippers game is active, the application must show a dashboard containing:

• recent team performance trends
• upcoming Clippers schedule
• player trend summaries
• rotating insights about team performance
• Vegas odds for upcoming games (when available)

---

## 2.3 Player Trends Page

The application must allow viewing player performance trends.

Minimum features:

• player game logs
• rolling averages
• season averages
• trend charts

---

## 2.4 Schedule Page

The schedule page must display:

• upcoming Clippers games
• opponent
• date and time
• Vegas odds (spread, moneyline, total) when available

---

## 2.5 Historical Explorer

The system must allow exploration of historical game data.

Minimum capabilities:

• browse games by season
• view full game box scores
• view insights related to historical games

---

# 3. Insight Engine Requirements

The system must generate algorithmic insights from stored data.

Insights must be derived from:

• live game events
• player performance
• team performance
• recent game history
• season statistics
• historical franchise data

### Insight Categories

The system must support the following insight types:

• scoring runs
• clutch alerts
• player streaks
• historical milestones
• rare statistical events
• opponent context
• league comparisons

### Insight Proof Requirement

Each insight must store:

• SQL query used to validate the insight
• referenced entity IDs (game_id, player_id, etc.)
• query result snapshot

Insights that cannot be verified must not be displayed.

---

# 4. Historical Data Requirements

Initial system must store:

**3 full NBA seasons of data (2022–2024).**

The MVP dataset must include:

• all teams
• all players
• complete game schedule and metadata (dates, opponents, final scores, status)

**Box scores:** Historical box scores for pre-pipeline games are out of scope for MVP. The `game_team_box_scores` and `game_player_box_scores` tables exist and will be populated going forward by the live JSON finalization pipeline (Phase 7). Full historical box score backfill can be added post-MVP.

The architecture must allow expansion to additional seasons and richer historical data later.

---

# 5. Vegas Odds Requirements

The system must display Vegas betting odds for Clippers games.

Supported odds types:

• point spread
• moneyline
• game total (over/under)

Rules:

• Odds are display-only context.
• Odds must come from an external API.
• If odds data is unavailable, the UI hides the odds section.

---

# 6. Performance Requirements

• Page load target: under 2 seconds under normal conditions.
• Live updates must appear within **3 seconds of polling**.
• Database queries must return results in under **200ms** for dashboard queries.

---

# 7. Reliability Requirements

If the NBA API fails or rate limits:

• the system must display a **"data delayed" indicator**
• the UI must continue displaying the **most recent cached snapshot**

The system must never display unverified insights.

---

# 8. Data Integrity

All insights must be provable from stored database queries.

The system must not display:

• unverifiable claims
• approximations
• probabilistic statements presented as facts

---

# 9. Non‑Goals for MVP

The following features are explicitly excluded:

• user accounts
• push notifications
• fantasy integrations
• video highlights
• social sharing
• betting functionality

Odds are informational only.