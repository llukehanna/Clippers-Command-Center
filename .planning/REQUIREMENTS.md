# Requirements: Clippers Command Center

**Defined:** 2026-03-05
**Core Value:** A fan watching a Clippers game opens the dashboard and immediately sees the live score, full box score, and 2–3 provable insight tiles about the game.

## v1 Requirements

### Live Game Mode

- [x] **LIVE-01**: Application detects when a Clippers game is active and automatically switches to Live Mode
- [ ] **LIVE-02**: Live dashboard displays live score, game clock, and quarter
- [ ] **LIVE-03**: Live dashboard displays full team box score with standard columns (MIN, PTS, REB, AST, STL, BLK, TO, FG, 3PT, FT, +/-)
- [ ] **LIVE-04**: Live dashboard displays player box score rows with compact density
- [ ] **LIVE-05**: Live dashboard displays key live metrics row (eFG%, TO margin, rebound margin, pace, FT edge)
- [ ] **LIVE-06**: Live data refreshes approximately every 12 seconds
- [ ] **LIVE-07**: A snapshot of game state is stored in live_snapshots on every poll
- [ ] **LIVE-08**: System detects scoring runs of 8–0 or greater by either team
- [ ] **LIVE-09**: System detects clutch situations (last 5 min of Q4/OT, score margin ≤ 8)
- [ ] **LIVE-10**: Dashboard displays 2–3 rotating insight tiles simultaneously
- [ ] **LIVE-11**: Dashboard displays other NBA games relevant to Clippers (score, time, Clippers-relevant note)
- [x] **LIVE-12**: If live source fails, system displays "data delayed" indicator and serves last cached snapshot

### Between-Games Dashboard

- [ ] **HOME-01**: Default dashboard displays when no Clippers game is active
- [ ] **HOME-02**: Dashboard shows recent team performance trends
- [ ] **HOME-03**: Dashboard shows upcoming Clippers schedule
- [ ] **HOME-04**: Dashboard shows player trend summaries for top Clippers players
- [ ] **HOME-05**: Dashboard shows rotating insights about team performance
- [ ] **HOME-06**: Dashboard shows Vegas odds for upcoming games when available

### Player Trends

- [ ] **PLAYER-01**: User can select a Clippers player and view their performance trends
- [ ] **PLAYER-02**: Player page shows rolling averages (last 5, last 10 games)
- [ ] **PLAYER-03**: Player page shows season averages
- [ ] **PLAYER-04**: Player page shows trend charts (rolling scoring, secondary metric)
- [ ] **PLAYER-05**: Player page shows game log table with standard box score columns
- [ ] **PLAYER-06**: Player page shows splits (home/away, wins/losses)

### Schedule

- [ ] **SCHED-01**: Schedule page shows upcoming Clippers games
- [ ] **SCHED-02**: Schedule rows include opponent, date, time, and home/away
- [ ] **SCHED-03**: Schedule rows include Vegas spread, moneyline, and over/under when available
- [ ] **SCHED-04**: If odds are unavailable, UI shows null/unavailable rather than fabricated values

### Historical Explorer

- [ ] **HIST-01**: User can browse Clippers games by season
- [ ] **HIST-02**: Game list shows date, opponent, result, and final score
- [ ] **HIST-03**: User can open a historical game and view full box score
- [ ] **HIST-04**: Historical game detail shows insights related to that game

### Insight Engine

- [x] **INSIGHT-01**: System generates algorithmic insights from stored data
- [x] **INSIGHT-02**: Insight engine supports: scoring runs, clutch alerts, player streaks, milestones, rare statistical events, opponent context, league comparisons
- [x] **INSIGHT-03**: Every insight stores proof_sql, proof_params, and proof_result
- [x] **INSIGHT-04**: Insights without valid proof are never displayed
- [x] **INSIGHT-05**: Live insights generated on-demand from current snapshot + rolling windows

### Data Pipeline

- [x] **DATA-01**: System ingests 3 full NBA seasons of historical data (all teams, players, games)
- [x] **DATA-02**: System computes advanced stats after final box scores: possessions, pace, off/def/net rating, eFG%, TS%
- [x] **DATA-03**: System computes rolling windows (last 5 / last 10) for teams and players
- [x] **DATA-04**: Ingestion jobs are idempotent and resumable
- [x] **DATA-05**: Final box scores ingest correctly after games end

### Odds Integration

- [ ] **ODDS-01**: Odds data ingests from external provider into odds_snapshots (append-only)
- [ ] **ODDS-02**: System displays spread, moneyline, and over/under for Clippers games
- [ ] **ODDS-03**: System hides odds sections when odds data is unavailable — never fabricates
- [ ] **ODDS-04**: Odds provider is swappable via adapter layer

### API Layer

- [ ] **API-01**: GET /api/live returns complete Live Dashboard payload
- [ ] **API-02**: GET /api/home returns complete Between-Games Dashboard payload
- [ ] **API-03**: GET /api/players and GET /api/players/{id} return player data and trends
- [ ] **API-04**: GET /api/schedule returns upcoming games with odds
- [ ] **API-05**: GET /api/history/seasons, /games, /games/{id} return historical data
- [ ] **API-06**: GET /api/insights returns eligible insights by scope with proof payloads
- [ ] **API-07**: All endpoints include meta with generated_at, source, stale, stale_reason, ttl_seconds

### Performance and Reliability

- [ ] **PERF-01**: /api/live response time < 200ms
- [ ] **PERF-02**: /api/home response time < 300ms
- [ ] **PERF-03**: /api/history/* response time < 400ms
- [ ] **RELY-01**: System continues serving cached data during upstream API outages
- [ ] **RELY-02**: Exponential backoff on live polling failures
- [ ] **RELY-03**: UI remains functional and meaningful during all upstream outage scenarios

## v2 Requirements

### Multi-team and public access

- **MULTI-01**: Support dashboards for teams other than Clippers
- **MULTI-02**: User accounts and authentication
- **MULTI-03**: Public hosting for wider audience

### Additional data

- **HIST-EXP-01**: Full NBA historical data beyond 3 seasons
- **HIST-EXP-02**: Basketball Reference scraping integration

### Notifications and sharing

- **NOTF-01**: Push notifications for game events
- **SHARE-01**: Social sharing of insights

### Mobile

- **MOB-01**: Mobile-responsive layout

## Out of Scope

| Feature | Reason |
|---------|--------|
| User accounts / authentication | Personal use only for MVP; architecture keeps path open |
| Push notifications | Deferred to v2 |
| Fantasy integrations | Out of product scope |
| Video highlights | Out of product scope |
| Social sharing | Deferred to v2 |
| Betting functionality | Odds are display-only by design |
| Mobile layout | Desktop-first MVP |
| Live betting odds | Out of scope unless trivially available |
| Play-by-play animation | Out of scope |
| Full-league explorer UI | Clippers-first only |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01 | Phase 4: Historical Data Ingestion | Complete |
| DATA-04 | Phase 4: Historical Data Ingestion | Complete |
| DATA-05 | Phase 4: Historical Data Ingestion | Complete |
| DATA-02 | Phase 5: Advanced Stats Engine | Complete |
| DATA-03 | Phase 5: Advanced Stats Engine | Complete |
| INSIGHT-01 | Phase 6: Insight Engine | Complete |
| INSIGHT-02 | Phase 6: Insight Engine | Complete |
| INSIGHT-03 | Phase 6: Insight Engine | Complete |
| INSIGHT-04 | Phase 6: Insight Engine | Complete |
| INSIGHT-05 | Phase 6: Insight Engine | Complete |
| LIVE-01 | Phase 7: Live Data Pipeline | Complete |
| LIVE-06 | Phase 7: Live Data Pipeline | Pending |
| LIVE-07 | Phase 7: Live Data Pipeline | Pending |
| LIVE-08 | Phase 7: Live Data Pipeline | Pending |
| LIVE-09 | Phase 7: Live Data Pipeline | Pending |
| LIVE-12 | Phase 7: Live Data Pipeline | Complete |
| ODDS-01 | Phase 8: Odds Integration | Pending |
| ODDS-02 | Phase 8: Odds Integration | Pending |
| ODDS-03 | Phase 8: Odds Integration | Pending |
| ODDS-04 | Phase 8: Odds Integration | Pending |
| API-01 | Phase 9: API Layer | Pending |
| API-02 | Phase 9: API Layer | Pending |
| API-03 | Phase 9: API Layer | Pending |
| API-04 | Phase 9: API Layer | Pending |
| API-05 | Phase 9: API Layer | Pending |
| API-06 | Phase 9: API Layer | Pending |
| API-07 | Phase 9: API Layer | Pending |
| LIVE-02 | Phase 11: Live Game Dashboard | Pending |
| LIVE-03 | Phase 11: Live Game Dashboard | Pending |
| LIVE-04 | Phase 11: Live Game Dashboard | Pending |
| LIVE-05 | Phase 11: Live Game Dashboard | Pending |
| LIVE-10 | Phase 11: Live Game Dashboard | Pending |
| LIVE-11 | Phase 11: Live Game Dashboard | Pending |
| HOME-01 | Phase 12: Between-Games Dashboard | Pending |
| HOME-02 | Phase 12: Between-Games Dashboard | Pending |
| HOME-03 | Phase 12: Between-Games Dashboard | Pending |
| HOME-04 | Phase 12: Between-Games Dashboard | Pending |
| HOME-05 | Phase 12: Between-Games Dashboard | Pending |
| HOME-06 | Phase 12: Between-Games Dashboard | Pending |
| SCHED-01 | Phase 12: Between-Games Dashboard | Pending |
| SCHED-02 | Phase 12: Between-Games Dashboard | Pending |
| PLAYER-01 | Phase 13: Player Trends Page | Pending |
| PLAYER-02 | Phase 13: Player Trends Page | Pending |
| PLAYER-03 | Phase 13: Player Trends Page | Pending |
| PLAYER-04 | Phase 13: Player Trends Page | Pending |
| PLAYER-05 | Phase 13: Player Trends Page | Pending |
| PLAYER-06 | Phase 13: Player Trends Page | Pending |
| HIST-01 | Phase 14: Historical Explorer | Pending |
| HIST-02 | Phase 14: Historical Explorer | Pending |
| HIST-03 | Phase 14: Historical Explorer | Pending |
| HIST-04 | Phase 14: Historical Explorer | Pending |
| SCHED-03 | Phase 14: Historical Explorer | Pending |
| SCHED-04 | Phase 14: Historical Explorer | Pending |
| PERF-01 | Phase 15: Reliability and Validation | Pending |
| PERF-02 | Phase 15: Reliability and Validation | Pending |
| PERF-03 | Phase 15: Reliability and Validation | Pending |
| RELY-01 | Phase 15: Reliability and Validation | Pending |
| RELY-02 | Phase 15: Reliability and Validation | Pending |
| RELY-03 | Phase 15: Reliability and Validation | Pending |

**Coverage:**
- v1 requirements: 50 total
- Mapped to phases: 50
- Unmapped: 0

**Notes:**
- Phases 1–3 (Spec Lock, Wireframes, DB Schema) are pre-implementation planning phases with no v1 requirement IDs — their deliverables are the Docs/ artifacts.
- Phase 10 (Core UI Framework) is a foundational phase; its requirements are delivered implicitly through the UI phases that depend on it (11–14).
- Phase 16 (MVP Launch) is a deployment phase; no discrete v1 requirement IDs, but it closes the loop on all Active items in PROJECT.md.
- SCHED-01/02 assigned to Phase 12 (Between-Games Dashboard, which contains the schedule view); SCHED-03/04 assigned to Phase 14 (Historical Explorer schedule detail with odds display).

---
*Requirements defined: 2026-03-05*
*Source: Docs/REQUIREMENTS.md (authoritative)*
*Traceability updated: 2026-03-05*
