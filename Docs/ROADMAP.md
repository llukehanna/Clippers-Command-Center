# ROADMAP.md

This roadmap defines the build sequence for Clippers Command Center. Each phase must produce a concrete deliverable and a verification step before moving forward.

---

# Phase 1 — Product Specification Lock

Purpose:
Finalize the core planning artifacts so implementation never relies on guessing.

Deliverables:

• Final PROJECT.md
• Final REQUIREMENTS.md
• Final DESIGN-SYSTEM.md
• Initial ROADMAP.md

Verification:

• All documents reviewed
• No ambiguous product behavior remaining

---

# Phase 2 — UX Wireframes and Screen Contracts

Purpose:
Define the exact structure of each application screen before UI coding begins.

Screens to define:

• Live Game Dashboard
• Between-Games Dashboard (Home)
• Player Trends Page
• Schedule Page
• Historical Explorer

Deliverables:

• docs/WIREFRAMES.md

Each screen must specify:

• layout structure
• section hierarchy
• data modules displayed

Verification:

• All screens have defined layouts
• UI components map to DESIGN-SYSTEM.md

---

# Phase 3 — Database Schema Design

Purpose:
Define the full data model used by the system.

Core tables:

• games
• teams
• players
• team_box_scores
• player_box_scores
• live_snapshots
• advanced_stats
• generated_insights

Deliverables:

• docs/DB_SCHEMA.sql
• docs/DATA_DICTIONARY.md

Verification:

• Schema supports all requirements
• Snapshot storage supports live trend detection

---

# Phase 4 — Historical Data Ingestion

Purpose:
Populate the database with historical NBA data.

Scope:

• 3 NBA seasons
• full league data

Deliverables:

• ingestion scripts
• populated database

Verification:

• historical games load successfully
• box scores match source data

---

# Phase 5 — Advanced Stats Engine

Purpose:
Compute derived metrics used by insights and dashboards.

Metrics:

• possessions
• offensive rating
• defensive rating
• pace
• effective field goal %
• true shooting %
• rolling averages

Deliverables:

• derived stat calculation scripts
• populated advanced_stats table

Verification:

• computed stats validated against known values

---

# Phase 6 — Insight Engine

Purpose:
Generate contextual insights using stored data.

Insight types:

• scoring runs
• clutch alerts
• player streaks
• milestones
• rare statistical events
• opponent context
• league comparisons

Deliverables:

• insight generation algorithm
• proof query system

Each insight must store:

• SQL query
• referenced entity IDs
• query result snapshot

Verification:

• sample insights generated
• all insights provably correct

---

# Phase 7 — Live Data Pipeline

Purpose:
Handle real-time game data.

Features:

• poll NBA live endpoint every ~12 seconds
• detect active Clippers games
• store live snapshots
• detect scoring runs and clutch situations

Deliverables:

• live polling service
• snapshot storage system

Verification:

• simulated live game successfully processed
• snapshots stored correctly

---

# Phase 8 — Odds Data Integration

Purpose:
Add Vegas betting odds as contextual signals.

Features:

• integrate free odds API
• provider-swappable adapter layer

Deliverables:

• odds data service
• odds displayed in schedule and dashboard

Verification:

• odds appear correctly for upcoming games
• system hides odds if provider unavailable

---

# Phase 9 — API Layer

Purpose:
Expose backend data to the frontend.

Endpoints:

• live game state
• team stats
• player stats
• insights
• historical game data
• odds data

Deliverables:

• REST API routes

Verification:

• endpoints return correct structured JSON

---

# Phase 10 — Core UI Framework

Purpose:
Build the base frontend structure.

Deliverables:

• navigation
• layout grid
• stat cards
• tables
• chart components

Verification:

• UI renders using mock data

---

# Phase 11 — Live Game Dashboard

Purpose:
Implement the primary product experience.

Features:

• live scoreboard
• box score tables
• contextual stats
• rotating insight tiles
• side panels for other games

Verification:

• simulated live game updates correctly

---

# Phase 12 — Between-Games Dashboard

Purpose:
Provide insights when no game is active.

Features:

• recent team trends
• upcoming schedule
• player trend summaries
• odds for upcoming games

Verification:

• dashboard loads correctly without live game

---

# Phase 13 — Player Trends Page

Purpose:
Explore individual player performance.

Features:

• game logs
• rolling averages
• trend charts

Verification:

• player trends render correctly

---

# Phase 14 — Historical Explorer

Purpose:
Allow browsing historical Clippers games.

Features:

• season selection
• game list
• box score viewer
• related insights

Verification:

• historical games accessible

---

# Phase 15 — Reliability and Validation

Purpose:
Validate system behavior under real conditions.

Checks:

• API failure handling
• rate limit backoff
• cached snapshot fallback
• insight verification

Verification:

• system behaves correctly during simulated failures

---

# Phase 16 — MVP Launch

Purpose:
Ship the first fully usable version.

Deliverables:

• deployed application
• stable data pipelines
• working live dashboard

Verification:

• end-to-end workflow tested

