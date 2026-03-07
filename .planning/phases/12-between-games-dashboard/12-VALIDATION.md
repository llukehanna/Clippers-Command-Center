---
phase: 12
slug: between-games-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npx vitest run src/lib/` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + visual inspection of home page at `http://localhost:3000/home`
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 0 | HOME-06 | unit | `npx vitest run src/lib/home-utils.test.ts` | ❌ W0 | ⬜ pending |
| 12-01-02 | 01 | 1 | HOME-01 | manual | visual inspection at `/home` | N/A | ⬜ pending |
| 12-01-03 | 01 | 1 | HOME-02 | manual | stat cards visible, record/L10/ratings shown | N/A | ⬜ pending |
| 12-01-04 | 01 | 1 | HOME-03 | manual | schedule shows 5 games with opponent/date/time/H-A | N/A | ⬜ pending |
| 12-01-05 | 01 | 1 | HOME-04 | manual | player trends table shows top players | N/A | ⬜ pending |
| 12-01-06 | 01 | 1 | HOME-05 | manual | rotating insights cycle every 8s | N/A | ⬜ pending |
| 12-01-07 | 01 | 1 | HOME-06 | unit | `npx vitest run src/lib/home-utils.test.ts` | ❌ W0 | ⬜ pending |
| 12-01-08 | 01 | 1 | SCHED-01 | manual | upcoming games list populates | N/A | ⬜ pending |
| 12-01-09 | 01 | 1 | SCHED-02 | manual | schedule rows have opponent/date/time/H-A | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/home-utils.test.ts` — stubs for HOME-06 (odds conditional logic) and date/time formatting utilities

*Existing Vitest infrastructure covers all other phase requirements. React component rendering is manual-only due to no jsdom/RTL configured.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Home page renders when no live game active | HOME-01 | RSC page, no jsdom configured | Load `http://localhost:3000/home`, verify dashboard displays |
| Team snapshot stat cards | HOME-02 | React component rendering | Verify record, L10, ratings visible in stat card area |
| Upcoming schedule 5 games | HOME-03 | React component rendering | Confirm 5 rows with opponent, date, time, home/away |
| Player trends table | HOME-04 | React component rendering | Confirm top players shown with PPG/RPG/APG/TS% columns |
| Rotating team insights | HOME-05 | Timed animation | Confirm insights rotate on ~8s interval |
| Upcoming games list | SCHED-01 | React component rendering | Confirm games populate from API |
| Schedule row fields | SCHED-02 | React component rendering | Confirm opponent, date, time, H/A present on each row |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
