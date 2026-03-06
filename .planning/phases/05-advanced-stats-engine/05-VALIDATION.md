---
phase: 5
slug: advanced-stats-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | None installed — validation is manual (DB queries + Basketball-Reference cross-check) |
| **Config file** | none — Wave 0 installs seed script and verification SQL |
| **Quick run command** | `npx tsx scripts/compute-stats.ts` (inspect console for errors) |
| **Full suite command** | Manual: run compute-stats, then query all four derived tables for row counts + eFG% spot-check |
| **Estimated runtime** | ~30 seconds (compute-stats runtime) |

---

## Sampling Rate

- **After every task commit:** Run `npx tsx scripts/compute-stats.ts` and confirm zero errors in console output
- **After every plan wave:** Execute verification SQL against DB, confirm row counts in all four derived tables
- **Before `/gsd:verify-work`:** All four derived tables populated; eFG% for at least one seeded game within ±1% of Basketball-Reference value

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 5-01-01 | 01 | 0 | DATA-02 | manual | `npx tsx scripts/seed-test-games.ts` | ❌ W0 | ⬜ pending |
| 5-01-02 | 01 | 1 | DATA-02 | manual | `psql $DATABASE_URL -c "SELECT game_id, team_id, efg_pct, ts_pct, pace, off_rating, def_rating FROM advanced_team_game_stats"` | ❌ W0 | ⬜ pending |
| 5-01-03 | 01 | 1 | DATA-02 | manual | Basketball-Reference eFG% cross-check (developer lookup) | N/A | ⬜ pending |
| 5-02-01 | 02 | 1 | DATA-03 | manual | `psql $DATABASE_URL -c "SELECT team_id, window_games, as_of_game_date, off_rating FROM rolling_team_stats"` | ❌ W0 | ⬜ pending |
| 5-02-02 | 02 | 1 | DATA-03 | manual | `psql $DATABASE_URL -c "SELECT player_id, window_games, as_of_game_date, efg_pct FROM rolling_player_stats"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/seed-test-games.ts` — hardcoded Basketball-Reference box scores for 2-3 Clippers games (DATA-02 validation fixture)
- [ ] `scripts/verification-phase5.sql` — SQL queries to inspect derived table counts and spot-check eFG%

*No test framework to install — validation is manual per phase decisions (see CONTEXT.md)*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| advanced_stats table populated with possessions, pace, off rating, def rating, eFG%, TS% | DATA-02 | No test framework; DB state verification | Run `npx tsx scripts/compute-stats.ts`, then `psql $DATABASE_URL -c "SELECT COUNT(*) FROM advanced_team_game_stats"` — expect >0 rows |
| eFG% within ±1% of Basketball-Reference value | DATA-02 | Requires external reference lookup | After compute-stats, look up seeded game on Basketball-Reference, compare eFG% values |
| Rolling windows (last 5 / last 10) computed for teams and players | DATA-03 | DB state verification | `psql $DATABASE_URL -c "SELECT DISTINCT window_games FROM rolling_team_stats"` — expect {5,10} |
| Player rolling windows populated | DATA-03 | DB state verification | `psql $DATABASE_URL -c "SELECT DISTINCT window_games FROM rolling_player_stats"` — expect {5,10} |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
