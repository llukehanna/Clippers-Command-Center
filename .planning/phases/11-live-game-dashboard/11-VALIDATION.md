---
phase: 11
slug: live-game-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 11 — Validation Strategy

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
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 11-01-01 | 01 | 0 | LIVE-02 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |
| 11-01-02 | 01 | 0 | LIVE-05 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |
| 11-01-03 | 01 | 0 | LIVE-10 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |
| 11-02-01 | 02 | 1 | LIVE-02 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |
| 11-02-02 | 02 | 1 | LIVE-03 | manual | visual inspection at dev server | N/A | ⬜ pending |
| 11-02-03 | 02 | 1 | LIVE-04 | manual | visual inspection at dev server | N/A | ⬜ pending |
| 11-02-04 | 02 | 1 | LIVE-05 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |
| 11-02-05 | 02 | 1 | LIVE-10 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |
| 11-02-06 | 02 | 1 | LIVE-11 | unit | `npx vitest run src/lib/` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/format.test.ts` — formatClock utility tests (LIVE-02 clock display)
- [ ] `src/lib/live-utils.test.ts` — FT edge computation tests (LIVE-05)
- [ ] `src/lib/use-insight-rotation.test.ts` — rotation logic pure function tests (LIVE-10)

*Note: Vitest config includes only `src/lib/**/*.test.ts` — no jsdom/React Testing Library. UI component rendering tests (LIVE-03, LIVE-04, LIVE-11 render) are manual-only due to missing jsdom configuration.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| BoxScoreModule renders both teams' columns correctly | LIVE-03 | No jsdom in Vitest config — component rendering not automatable | Visual inspection at dev server: verify MIN, PTS, REB, AST, STL, BLK, TO, FG, 3PT, FT, +/- columns present for both teams |
| Player rows display with compact h-9 density | LIVE-04 | Visual/layout behavior, no DOM test infra | Visual inspection at dev server: verify row height and readability |
| Other games panel hides when array is empty | LIVE-11 | Component render behavior, no DOM test infra | Visual inspection: load page with no other games in API response, verify panel not shown |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
