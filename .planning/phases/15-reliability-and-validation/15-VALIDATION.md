---
phase: 15
slug: reliability-and-validation
status: ready
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-11
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `npm test -- --reporter=verbose src/lib/api-live.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds (all DB mocked, no I/O) |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- src/lib/api-live.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-01-01 | 01 | 1 | PERF-01, RELY-01 | integration | `npm test -- src/lib/api-live.test.ts` | ✅ | ⬜ pending |
| 15-01-02 | 01 | 1 | RELY-02 | unit | `npm test -- scripts/lib/poll-live-logic.test.ts` | ✅ | ⬜ pending |
| 15-02-01 | 02 | 1 | PERF-02, PERF-03 | integration | `npm test -- src/lib/api-home.test.ts src/lib/api-history.test.ts` | ❌ created by plan | ⬜ pending |
| 15-02-02 | 02 | 1 | — | cleanup | `npm test` | N/A | ⬜ pending |
| 15-03-01 | 03 | 2 | RELY-03 | TS compile + integration | `npx tsc --noEmit && npm test -- src/lib/api-live.test.ts` | ✅ | ⬜ pending |
| 15-03-02 | 03 | 2 | RELY-03 | manual | Manual smoke test (see below) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Notes

Wave 0 gaps are handled by Wave 1 parallel plans (15-01 and 15-02). All tasks have automated verify commands. `api-home.test.ts` and `api-history.test.ts` are created by Plan 15-02 Task 1 — no pre-existing stub files needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| UI renders last scoreboard data + StaleBanner during DATA_DELAYED | RELY-03 | React render behavior requires browser; Playwright not in scope | 1. Update a live_snapshot row: set `payload.is_stale = true`, `payload.stale_reason = 'poll daemon offline'`, `captured_at` to 90+ seconds ago. 2. Open /live in browser. 3. Verify: StaleBanner visible below scoreboard, last scoreboard + box score data still rendered (not blank/skeleton), banner text shows correct staleness time relative to `captured_at`. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify commands
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 gaps handled by Wave 1 parallel plans (15-01 and 15-02)
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** ready for execution
