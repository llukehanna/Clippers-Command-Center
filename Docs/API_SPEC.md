# API_SPEC.md

This document defines the MVP API contracts for **Clippers Command Center (CCC)**.

Target implementation: **Next.js API routes** (App Router), e.g. `src/app/api/.../route.ts`.

Principles:

- Prefer **simple, deterministic** JSON contracts.
- Avoid over-fetching in MVP: each page gets a page-shaped endpoint.
- Include enough metadata to render stable UI and handle stale/delayed data.
- Never fabricate facts. If data is missing, return null/empty with an explicit status.

---

# Global Conventions

## Base URL

Local dev (typical): `http://localhost:3000`

All endpoints are under:

- `/api/*`

## Content Type

All endpoints return:

- `Content-Type: application/json; charset=utf-8`

## Time

All timestamps are ISO 8601 strings in UTC unless stated otherwise.

- Example: `"2026-03-06T01:23:45Z"`

## Team Focus

By default, endpoints return **Clippers-centric** views.

- Clippers team abbreviation: `LAC`
- Many endpoints accept `team=...` but MVP can default to `LAC` if omitted.

## Pagination

When endpoints return lists that can grow large, use:

- `limit` (default varies; max recommended 200)
- `cursor` (opaque string)

Response includes:

- `next_cursor` (string | null)

## Errors

Non-2xx responses use a consistent error envelope:

```json
{
  "error": {
    "code": "BAD_REQUEST",
    "message": "Human readable message",
    "details": { "optional": "object" }
  }
}
```

Suggested codes:

- `BAD_REQUEST`
- `NOT_FOUND`
- `RATE_LIMITED`
- `UPSTREAM_UNAVAILABLE`
- `DATA_NOT_READY`
- `INTERNAL_ERROR`

## Caching and Staleness

Every endpoint includes a `meta` object:

- `generated_at` (timestamp)
- `source` (string: `"nba_live" | "balldontlie" | "db" | "odds_provider" | "mixed"`)
- `stale` (boolean)
- `stale_reason` (string | null)
- `ttl_seconds` (number | null)

Recommended HTTP headers:

- live: `Cache-Control: no-store`
- non-live: `Cache-Control: public, max-age=300` (or similar)

---

# Endpoint Index (MVP)

**Live Game**
- `GET /api/live` (page-shaped: Live Dashboard)

**Between-Games Home**
- `GET /api/home`

**Players**
- `GET /api/players`
- `GET /api/players/{player_id}`

**Schedule**
- `GET /api/schedule`

**History**
- `GET /api/history/seasons`
- `GET /api/history/games`
- `GET /api/history/games/{game_id}`

**Insights**
- `GET /api/insights` (eligible rotating insights for scope)

**Odds**
- `GET /api/odds` (optional standalone; typically embedded into schedule/live/home)

---

# 1) GET /api/live

## Purpose

Provide everything required to render the **Live Game Dashboard** for the Clippers.

If no Clippers game is currently live, return a `state` indicating no active game and enough data to render a useful fallback.

## Query Params

- `team` (optional, default `LAC`)
- `include_other_games` (optional boolean, default `true`)
- `include_insights` (optional boolean, default `true`)

## Response (200)

### Shape

```json
{
  "meta": {
    "generated_at": "2026-03-06T01:23:45Z",
    "source": "mixed",
    "stale": false,
    "stale_reason": null,
    "ttl_seconds": 5
  },
  "state": "LIVE",
  "game": {
    "game_id": 12345,
    "nba_game_id": 987654321,
    "season_id": 2025,
    "game_date": "2026-03-05",
    "start_time_utc": "2026-03-06T03:00:00Z",
    "status": "in_progress",
    "period": 3,
    "clock": "05:32",
    "home": {
      "team_id": 14,
      "abbreviation": "LAC",
      "name": "Clippers",
      "score": 88,
      "is_home": true
    },
    "away": {
      "team_id": 7,
      "abbreviation": "DEN",
      "name": "Nuggets",
      "score": 84,
      "is_home": false
    }
  },
  "key_metrics": [
    { "key": "efg_pct", "label": "eFG%", "value": 0.545, "team": "LAC", "delta_vs_opp": 0.021 },
    { "key": "tov_margin", "label": "TO Margin", "value": 3, "team": "LAC", "delta_vs_opp": 3 },
    { "key": "reb_margin", "label": "Reb Margin", "value": -2, "team": "LAC", "delta_vs_opp": -2 },
    { "key": "pace", "label": "Pace", "value": 98.2, "team": "GAME", "delta_vs_opp": null }
  ],
  "box_score": {
    "columns": ["MIN","PTS","REB","AST","STL","BLK","TO","FG","3PT","FT","+/-"],
    "teams": [
      {
        "team_abbr": "LAC",
        "players": [
          { "player_id": 1001, "name": "Kawhi Leonard", "starter": true, "MIN": "29:10", "PTS": 22, "REB": 6, "AST": 3, "STL": 1, "BLK": 1, "TO": 2, "FG": "9-15", "3PT": "2-5", "FT": "2-2", "+/-": 4 }
        ],
        "totals": { "PTS": 88, "REB": 34, "AST": 18, "TO": 9, "FG": "33-70", "3PT": "9-24", "FT": "13-16" }
      },
      {
        "team_abbr": "DEN",
        "players": [],
        "totals": {}
      }
    ]
  },
  "insights": [
    {
      "insight_id": "b6a7b8f8-3a1c-4c4d-9c9e-123456789abc",
      "category": "streak",
      "headline": "Clippers have won 7 of their last 9 at home",
      "detail": "Last 9 home games: 7–2",
      "importance": 78,
      "proof": { "summary": "home_last9_record", "result": { "wins": 7, "losses": 2 } }
    }
  ],
  "other_games": [
    {
      "nba_game_id": 555,
      "home_abbr": "PHX",
      "away_abbr": "GSW",
      "home_score": 101,
      "away_score": 99,
      "status": "in_progress",
      "period": 4,
      "clock": "01:12",
      "note": "Warriors loss improves Clippers tiebreak outlook"
    }
  ],
  "odds": {
    "provider": "example",
    "captured_at": "2026-03-06T01:00:00Z",
    "spread_home": -2.5,
    "spread_away": 2.5,
    "moneyline_home": -140,
    "moneyline_away": 120,
    "total_points": 224.5
  }
}
```

### Fields and Rules

- `state`:
  - `"LIVE"` when Clippers game is active and in progress
  - `"NO_ACTIVE_GAME"` when no Clippers game is active
  - `"DATA_DELAYED"` when upstream is failing but cached data is served

- `key_metrics`: order is fixed for MVP.
- `box_score`: return `columns` and team arrays; team player rows can be empty if data missing.
- `insights`: should be limited to 2–3 for the Live page (UI decides what to show; API can still return up to 6).
- `odds`: nullable. Do not fabricate. If no odds, return `odds: null`.

## Response (200) — No Active Game

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "mixed", "stale": false, "stale_reason": null, "ttl_seconds": 60 },
  "state": "NO_ACTIVE_GAME",
  "game": null,
  "key_metrics": [],
  "box_score": null,
  "insights": [],
  "other_games": [],
  "odds": null
}
```

---

# 2) GET /api/home

## Purpose

Provide the **Between-Games Dashboard (Home)** data.

## Query Params

- `team` (optional, default `LAC`)
- `window_games` (optional, default `10`) — affects rolling stats blocks
- `include_schedule` (optional boolean, default `true`)
- `include_insights` (optional boolean, default `true`)

## Response (200)

```json
{
  "meta": {
    "generated_at": "2026-03-06T01:23:45Z",
    "source": "mixed",
    "stale": false,
    "stale_reason": null,
    "ttl_seconds": 300
  },
  "team_snapshot": {
    "team_abbr": "LAC",
    "season_id": 2025,
    "record": { "wins": 38, "losses": 24 },
    "conference_seed": 5,
    "net_rating": 3.2,
    "off_rating": 117.8,
    "def_rating": 114.6,
    "last_10": { "wins": 7, "losses": 3 }
  },
  "next_game": {
    "game_id": 999,
    "game_date": "2026-03-07",
    "start_time_utc": "2026-03-08T03:00:00Z",
    "opponent_abbr": "SAC",
    "home_away": "home",
    "odds": {
      "provider": "example",
      "captured_at": "2026-03-06T01:00:00Z",
      "spread_home": -1.5,
      "spread_away": 1.5,
      "moneyline_home": -125,
      "moneyline_away": 105,
      "total_points": 229.5
    }
  },
  "upcoming_schedule": [
    {
      "game_id": 999,
      "game_date": "2026-03-07",
      "start_time_utc": "2026-03-08T03:00:00Z",
      "opponent_abbr": "SAC",
      "home_away": "home",
      "odds": { "spread_home": -1.5, "moneyline_home": -125, "total_points": 229.5 }
    }
  ],
  "player_trends": [
    {
      "player_id": 1001,
      "name": "Kawhi Leonard",
      "window_games": 10,
      "minutes_avg": 33.8,
      "pts_avg": 24.2,
      "reb_avg": 6.3,
      "ast_avg": 3.7,
      "ts_pct": 0.604
    }
  ],
  "insights": [
    {
      "insight_id": "9c9e1234-1111-2222-3333-444455556666",
      "category": "comparison",
      "headline": "Clippers rank top-5 in halfcourt efficiency (last 10)",
      "detail": "Last 10 games halfcourt points/possession: 1.02",
      "importance": 80,
      "proof": { "summary": "last10_rank", "result": { "rank": 5, "metric": 1.02 } }
    }
  ]
}
```

Rules:
- `player_trends` should return the “top” set for Home (e.g., 5–8 players).
- Schedule rows should include odds if available.

---

# 3) GET /api/players

## Purpose

Return the Clippers roster (or last-known roster) for selection and navigation.

## Query Params

- `team` (optional, default `LAC`)
- `season_id` (optional)
- `active_only` (optional boolean, default `true`)

## Response (200)

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "db", "stale": false, "stale_reason": null, "ttl_seconds": 3600 },
  "players": [
    { "player_id": 1001, "nba_player_id": 202, "display_name": "Kawhi Leonard", "position": "F", "is_active": true }
  ]
}
```

---

# 4) GET /api/players/{player_id}

## Purpose

Provide the Player Trends page data.

## Query Params

- `window_games` (optional, default `10`)
- `season_id` (optional)
- `include_game_log` (optional boolean, default `true`)
- `game_log_limit` (optional, default `25`, max `82`)
- `include_splits` (optional boolean, default `true`)

## Response (200)

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "mixed", "stale": false, "stale_reason": null, "ttl_seconds": 600 },
  "player": { "player_id": 1001, "display_name": "Kawhi Leonard", "position": "F" },
  "trend_summary": {
    "window_games": 10,
    "minutes_avg": 33.8,
    "pts_avg": 24.2,
    "reb_avg": 6.3,
    "ast_avg": 3.7,
    "ts_pct": 0.604,
    "efg_pct": 0.555
  },
  "charts": {
    "rolling_pts": [
      { "game_date": "2026-02-10", "value": 22.0 },
      { "game_date": "2026-02-12", "value": 24.0 }
    ],
    "rolling_ts": [
      { "game_date": "2026-02-10", "value": 0.59 },
      { "game_date": "2026-02-12", "value": 0.61 }
    ]
  },
  "splits": {
    "home": { "pts_avg": 25.1, "ts_pct": 0.62 },
    "away": { "pts_avg": 23.0, "ts_pct": 0.59 },
    "wins": { "pts_avg": 26.4, "ts_pct": 0.63 },
    "losses": { "pts_avg": 21.2, "ts_pct": 0.57 }
  },
  "game_log": [
    { "game_id": 12345, "game_date": "2026-03-05", "opp": "DEN", "home_away": "home", "MIN": "34:10", "PTS": 27, "REB": 7, "AST": 4, "FG": "10-18", "3PT": "3-6", "FT": "4-4", "+/-": 6 }
  ]
}
```

Rules:
- `charts` arrays should be ordered by date ascending.
- If no split data, return `splits: null`.

---

# 5) GET /api/schedule

## Purpose

Provide upcoming games and odds (Schedule page).

## Query Params

- `team` (optional, default `LAC`)
- `season_id` (optional)
- `from` (optional date `YYYY-MM-DD`, default today)
- `to` (optional date, default today + 30 days)
- `include_odds` (optional boolean, default `true`)

## Response (200)

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "mixed", "stale": false, "stale_reason": null, "ttl_seconds": 1800 },
  "next_game": {
    "game_id": 999,
    "game_date": "2026-03-07",
    "start_time_utc": "2026-03-08T03:00:00Z",
    "opponent_abbr": "SAC",
    "home_away": "home",
    "odds": { "spread_home": -1.5, "moneyline_home": -125, "total_points": 229.5 }
  },
  "games": [
    {
      "game_id": 999,
      "game_date": "2026-03-07",
      "start_time_utc": "2026-03-08T03:00:00Z",
      "opponent_abbr": "SAC",
      "home_away": "home",
      "status": "scheduled",
      "odds": { "spread_home": -1.5, "moneyline_home": -125, "total_points": 229.5 }
    }
  ]
}
```

Rules:
- If odds missing for a game: `odds: null`.

---

# 6) GET /api/history/seasons

## Purpose

Provide available seasons for browsing (Historical Explorer).

## Query Params

- none

## Response (200)

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "db", "stale": false, "stale_reason": null, "ttl_seconds": 86400 },
  "seasons": [
    { "season_id": 2023, "label": "2023-24" },
    { "season_id": 2024, "label": "2024-25" },
    { "season_id": 2025, "label": "2025-26" }
  ]
}
```

---

# 7) GET /api/history/games

## Purpose

Provide a list of historical games for a given season (and optional filters).

## Query Params

- `season_id` (required)
- `team` (optional, default `LAC`)
- `limit` (optional, default `82`, max `200`)
- `cursor` (optional)
- `home_away` (optional: `"home" | "away"`)
- `result` (optional: `"win" | "loss"`)

## Response (200)

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "db", "stale": false, "stale_reason": null, "ttl_seconds": 86400 },
  "season": { "season_id": 2024, "label": "2024-25" },
  "games": [
    {
      "game_id": 777,
      "game_date": "2025-01-12",
      "opponent_abbr": "PHX",
      "home_away": "away",
      "result": "W",
      "final_score": { "team": 118, "opp": 112 }
    }
  ],
  "next_cursor": null
}
```

---

# 8) GET /api/history/games/{game_id}

## Purpose

Provide the Historical Game Detail view (header, box score, insights).

## Query Params

- `include_insights` (optional boolean, default `true`)

## Response (200)

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "mixed", "stale": false, "stale_reason": null, "ttl_seconds": 86400 },
  "game": {
    "game_id": 777,
    "game_date": "2025-01-12",
    "status": "final",
    "home": { "abbr": "PHX", "score": 112 },
    "away": { "abbr": "LAC", "score": 118 },
    "season_id": 2024
  },
  "box_score": {
    "columns": ["MIN","PTS","REB","AST","STL","BLK","TO","FG","3PT","FT","+/-"],
    "teams": [
      { "team_abbr": "LAC", "players": [], "totals": {} },
      { "team_abbr": "PHX", "players": [], "totals": {} }
    ]
  },
  "insights": [
    {
      "insight_id": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "category": "milestone",
      "headline": "First time in franchise history with 50 points in a quarter",
      "detail": "Q3 points: 50",
      "importance": 92,
      "proof": { "summary": "franchise_quarter_record", "result": { "quarter_points": 50, "rank": 1 } }
    }
  ]
}
```

Rules:
- For historical games, insights should come from DB `insights` if computed, else empty array.

---

# 9) GET /api/insights

## Purpose

Return eligible insights for rotation given a scope.

This endpoint supports the rotation system: the client can fetch a pool and locally rotate 2–3 at a time.

## Query Params

- `scope` (required): `"live" | "between_games" | "historical"`
- `team` (optional, default `LAC`)
- `game_id` (optional, recommended for `scope=live`)
- `player_id` (optional)
- `limit` (optional, default `10`, max `50`)

## Response (200)

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "db", "stale": false, "stale_reason": null, "ttl_seconds": 30 },
  "insights": [
    {
      "insight_id": "b6a7b8f8-3a1c-4c4d-9c9e-123456789abc",
      "scope": "live",
      "category": "streak",
      "headline": "Clippers have won 7 of their last 9 at home",
      "detail": "Last 9 home games: 7–2",
      "importance": 78,
      "proof": { "summary": "home_last9_record", "result": { "wins": 7, "losses": 2 } }
    }
  ]
}
```

Rules:
- Must return only `is_active=true` insights.
- Should be pre-sorted by `importance DESC` and secondarily `created_at DESC`.

---

# 10) GET /api/odds (optional standalone)

## Purpose

Retrieve the latest odds snapshot for a given game.

In MVP, odds can be embedded into `/api/live`, `/api/home`, and `/api/schedule`. This endpoint exists for debugging and optional modular usage.

## Query Params

- `game_id` (required)
- `provider` (optional)

## Response (200)

```json
{
  "meta": { "generated_at": "2026-03-06T01:23:45Z", "source": "odds_provider", "stale": false, "stale_reason": null, "ttl_seconds": 600 },
  "game_id": 999,
  "odds": {
    "provider": "example",
    "captured_at": "2026-03-06T01:00:00Z",
    "spread_home": -1.5,
    "spread_away": 1.5,
    "moneyline_home": -125,
    "moneyline_away": 105,
    "total_points": 229.5,
    "market_type": "pregame"
  }
}
```

---

# MVP Implementation Notes

## Polling cadence

Client polling recommendation:

- Live page: call `/api/live` every ~12 seconds during an active Clippers game.
- Non-live pages: refresh every 6 hours (or on navigation) for MVP.

## Data provenance

Where possible, include stable IDs:

- `game_id` (internal DB id)
- `nba_game_id` (provider id)
- `player_id` (internal DB id)
- `nba_player_id` (provider id)

## “Provable” insight requirement

Every insight returned to the UI must include proof fields:

- `proof.summary`
- `proof.result`

Back end must ensure `proof.result` aligns with `proof_sql` stored in DB (see `insights` table).

If proof is unavailable, do not return the insight.

---

# Out of Scope for MVP

- Authentication
- Multi-user features
- Write endpoints (all endpoints are GET in MVP)
- Full-league browsing UI (Clippers-first only)
