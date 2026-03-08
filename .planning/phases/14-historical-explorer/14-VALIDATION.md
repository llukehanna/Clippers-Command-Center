---
phase: 14
slug: historical-explorer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (current version in project) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run src/lib/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | HIST-01 | manual/visual | — | N/A | ⬜ pending |
| 14-01-02 | 01 | 1 | HIST-02 | manual/visual | — | N/A | ⬜ pending |
| 14-01-03 | 01 | 1 | HIST-01 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |
| 14-02-01 | 02 | 2 | HIST-03 | manual/visual | — | N/A | ⬜ pending |
| 14-02-02 | 02 | 2 | HIST-04 | manual/visual | — | N/A | ⬜ pending |
| 14-03-01 | 03 | 3 | SCHED-03 | manual/visual | — | N/A | ⬜ pending |
| 14-03-02 | 03 | 3 | SCHED-04 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/history-utils.test.ts` — stubs for `computeSeasonRecord()` (W-L calculation from games array), OT detection from status string
- [ ] `src/lib/history-utils.ts` — extract `computeSeasonRecord()` utility (if not already inline)

*Note: `formatGameDate()` is already covered in `src/lib/format.test.ts`. Existing `src/lib/api-history.test.ts` covers API contract. Only new utility function needs a new test file.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Season browser renders with season dropdown | HIST-01 | UI component, no DOM testing setup | Navigate to `/history`, verify dropdown shows seasons |
| Game list shows correct 5 columns | HIST-02 | Visual layout verification | Check Date, Opponent, H/A, Score, Result columns present |
| Box score renders when available:true | HIST-03 | UI component render | Open a game with box score data, verify player rows |
| Box score empty state when available:false | HIST-03 | UI component render | Open a game without box score, verify muted message |
| Insights render on game detail | HIST-04 | UI component render | Open a game with insights, verify InsightTileArea shown |
| Insights hidden when none exist | HIST-04 | UI component render | Open a game without insights, verify no empty state |
| Odds columns appear when odds available | SCHED-03 | Visual — depends on live data | Navigate to `/schedule` with odds data |
| Row click navigates to game detail | HIST-01 | Browser interaction | Click a row in GameListTable, verify navigation |
| Sticky controls stay visible on scroll | HIST-01 | Browser scroll behavior | Scroll game list, verify controls stay at top |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
