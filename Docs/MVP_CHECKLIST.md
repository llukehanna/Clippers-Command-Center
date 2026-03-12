
# MVP_CHECKLIST.md

This document defines the **definition of done for the MVP release of Clippers Command Center (CCC)**.

A feature is considered complete only when it satisfies the functional, technical, and data correctness criteria listed here.

The checklist is designed so the product can be validated end‑to‑end without ambiguity.

---

# 1. System Boot Checklist

The project is considered operational when the following basic conditions are true:

- The Next.js application starts locally with `npm run dev`
- The database connection succeeds
- All required environment variables load correctly
- API routes respond without server errors
- The database schema from `DB_SCHEMA.sql` is applied successfully

Verification:

- `/api/health` (or similar test endpoint) returns status OK
- Database tables exist and are queryable

---

# 2. Data Ingestion Validation

## Reference Data

The system must successfully populate:

- `teams`
- `players`
- `seasons`
- `player_team_stints`

Verification:

- Clippers team row exists (`LAC`)
- Active Clippers roster players exist
- Current season exists

---

## Schedule Ingestion

The schedule ingestion job must populate:

- upcoming Clippers games
- recent completed games

Verification:

- `games` table contains upcoming Clippers games
- each game has:

  - `home_team_id`
  - `away_team_id`
  - `game_date`
  - `start_time_utc`

The `/api/schedule` endpoint returns valid data.

---

# 3. Live Game System

## Live Polling

During an active Clippers game:

- live polling runs approximately every **12 seconds**
- a snapshot row is inserted into `live_snapshots`

Verification:

- multiple rows appear in `live_snapshots`
- timestamps increment correctly
- scores update correctly

---

## Live API

The endpoint:

```
GET /api/live
```

must return:

- current score
- clock
- quarter
- key metrics
- box score
- insights (2–3 eligible)
- odds if available

Verification:

Opening `/live` during a game shows:

- scoreboard updating
- box score populated
- insight tiles visible
- no layout shifts

---

# 4. Final Game Processing

After a game finishes:

The following must occur:

1. `games.status` becomes `"final"`
2. `game_team_box_scores` rows exist
3. `game_player_box_scores` rows exist

Verification:

- querying the game shows final score and player stats

---

# 5. Advanced Statistics

Derived metrics must populate after final box scores exist.

Tables populated:

- `advanced_team_game_stats`
- `advanced_player_game_stats` (optional but preferred)

Verification:

Metrics exist for the completed game:

- possessions
- pace
- offensive rating
- defensive rating
- net rating
- eFG%
- TS%

---

# 6. Rolling Statistics

Rolling windows must populate:

- last 5 games
- last 10 games

Tables populated:

- `rolling_team_stats`
- `rolling_player_stats`

Verification:

- `/api/home` returns valid player trend and team trend data

---

# 7. Insight System

Insights must satisfy **provable fact rules**.

Requirements:

- every insight contains

  - `headline`
  - `detail`
  - `proof.summary`
  - `proof.result`

- insights must originate from deterministic queries

Verification:

- querying `/api/insights` returns insights with proof payloads
- removing the proof data invalidates the insight

---

# 8. Home Dashboard

Opening the homepage when no Clippers game is active must show:

- team snapshot
- next game
- upcoming schedule
- player trend cards
- rotating insights

Verification:

- `/api/home` returns all required data
- UI renders without empty sections

---

# 9. Schedule Page

Opening `/schedule` must show:

- next Clippers game
- upcoming games list
- odds when available

Verification:

- each game row includes

  - date
  - opponent
  - home/away
  - spread
  - moneyline
  - total

If odds are unavailable:

- odds fields return `null`
- UI does not fabricate values

---

# 10. Player Trends Page

Opening `/players/{player_id}` must show:

- trend summary
- rolling charts
- splits
- game log

Verification:

- chart data is ordered chronologically
- game log rows match `game_player_box_scores`

---

# 11. Historical Explorer

Opening `/history` must allow:

- selecting a season
- browsing games
- opening game detail

Verification:

- `/api/history/seasons` returns seasons
- `/api/history/games` returns games
- `/api/history/games/{game_id}` returns box score and insights

---

# 12. Odds Integration

Odds ingestion must populate:

- `odds_snapshots`

Verification:

- latest odds appear on:

  - `/api/home`
  - `/api/schedule`
  - `/api/live` (optional)

Rules:

- odds snapshots are append‑only
- API always returns the latest snapshot

---

# 13. Failure Handling

The system must remain usable when external APIs fail.

Verification scenarios:

### Live API outage

- `/api/live` returns `DATA_DELAYED`
- last known snapshot is displayed

### Odds API outage

- odds return `null`
- schedule still renders

### Schedule API outage

- cached schedule remains visible

---

# 14. Performance Targets

MVP performance goals:

- `/api/live` response < 200ms
- `/api/home` response < 300ms
- `/api/history` responses < 400ms

Database queries should avoid:

- full table scans on large tables
- repeated heavy aggregations (use rolling tables)

---

# 15. Observability

Operational visibility must exist for:

- last schedule sync
- last odds sync
- last finalized game
- last rolling stats run

Verification:

- `app_kv` contains timestamps for each job

---

# 16. UX Acceptance Criteria

The application is considered usable when:

- the Live dashboard provides immediate situational awareness
- the Home dashboard provides meaningful insights between games
- the Historical explorer enables quick game lookup
- insights never appear without proof
- no page renders empty or broken modules

---

# 17. Final MVP Release Criteria

CCC MVP is considered **ready to ship** when:

1. All ingestion jobs run successfully
2. Historical backfill for at least **3 seasons** is complete
3. Live polling works during a real Clippers game
4. Insight system produces valid insights
5. All API endpoints in `API_SPEC.md` function correctly
6. All pages in `WIREFRAMES.md` render correctly
7. No fabricated data appears in the UI
8. The system continues functioning during upstream outages

When these criteria are satisfied, the MVP is ready for real usage.
