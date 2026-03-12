---
phase: 4
slug: historical-data-ingestion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-05
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | No automated test runner — ETL script validated via DB verification queries |
| **Config file** | `scripts/verification.sql` — Wave 0 creates this |
| **Quick run command** | `psql $DATABASE_URL -c "SELECT count(*) FROM games, teams, players"` |
| **Full suite command** | `psql $DATABASE_URL -f scripts/verification.sql` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `psql $DATABASE_URL -c "SELECT count(*) FROM games, teams, players"`
- **After every plan wave:** Run `psql $DATABASE_URL -f scripts/verification.sql`
- **Before `/gsd:verify-work`:** Full verification suite must pass (counts + spot checks)
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 0 | DATA-01 | setup | `psql $DATABASE_URL -c "SELECT 1"` | ❌ W0 | ⬜ pending |
| 4-01-02 | 01 | 1 | DATA-01 | manual | `psql $DATABASE_URL -c "SELECT count(*) FROM teams"` | ❌ W0 | ⬜ pending |
| 4-01-03 | 01 | 1 | DATA-01 | manual | `psql $DATABASE_URL -c "SELECT count(*) FROM players"` | ❌ W0 | ⬜ pending |
| 4-01-04 | 01 | 1 | DATA-01, DATA-04 | manual | `npm run backfill` (idempotent re-run check) | ❌ W0 | ⬜ pending |
| 4-01-05 | 01 | 1 | DATA-01 | manual | `psql $DATABASE_URL -c "SELECT count(*) FROM games"` | ❌ W0 | ⬜ pending |
| 4-01-06 | 01 | 2 | DATA-01, DATA-05 | manual | `psql $DATABASE_URL -f scripts/verification.sql` | ❌ W0 | ⬜ pending |
| 4-01-07 | 01 | 2 | DATA-04 | manual | Re-run backfill; counts must be identical | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `Docs/DB_SCHEMA.sql` applied to Neon — run `psql $DATABASE_URL -f Docs/DB_SCHEMA.sql`
- [ ] `.env.local` created with real `DATABASE_URL` and `BALLDONTLIE_API_KEY` values
- [ ] `.env.example` committed with placeholder values
- [ ] `scripts/verification.sql` — SQL queries to verify backfill success (counts per table, season breakdown, spot-check a known game's box scores)

*Existing infrastructure covers all phase requirements once Wave 0 is complete.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 3 seasons of data present | DATA-01 | ETL script — no automated test runner | `SELECT season_id, count(*) FROM games GROUP BY season_id` — expect rows for 2022, 2023, 2024 |
| Box scores match source data | DATA-01 | Requires cross-referencing BDL API response | Pick a known game ID, compare `game_player_box_scores` rows to BDL API response |
| Idempotent re-run | DATA-04 | Requires running script twice | Run `npm run backfill` twice; row counts must be identical both times |
| Final box scores only | DATA-05 | Requires checking `status = "Final"` filter | Verify no rows exist for games with non-Final status via `SELECT g.id FROM games g LEFT JOIN game_team_box_scores b ON b.game_id = g.id WHERE g.status != 'Final' AND b.id IS NOT NULL` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
