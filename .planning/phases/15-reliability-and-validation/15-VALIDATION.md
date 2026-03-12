---
phase: 15
slug: reliability-and-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
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
| 15-01-01 | 01 | 0 | PERF-02 | integration | `npm test -- src/lib/api-home.test.ts` | ❌ W0 | ⬜ pending |
| 15-01-02 | 01 | 0 | PERF-03 | integration | `npm test -- src/lib/api-history.test.ts` | ❌ W0 | ⬜ pending |
| 15-02-01 | 02 | 1 | PERF-01 | integration | `npm test -- src/lib/api-live.test.ts` | ✅ | ⬜ pending |
| 15-02-02 | 02 | 1 | RELY-01 | integration | `npm test -- src/lib/api-live.test.ts` | ✅ | ⬜ pending |
| 15-02-03 | 02 | 1 | RELY-01 | integration | `npm test -- src/lib/api-live.test.ts` | ✅ | ⬜ pending |
| 15-03-01 | 03 | 1 | RELY-02 | unit | `npm test -- scripts/lib/poll-live-logic.test.ts` | ✅ | ⬜ pending |
| 15-04-01 | 04 | 2 | RELY-01 | integration | `npm test -- src/lib/api-live.test.ts` | ✅ | ⬜ pending |
| 15-04-02 | 04 | 2 | RELY-03 | manual | Manual smoke test (see below) | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/api-home.test.ts` — stubs for PERF-02 (minimal timing test, mocked DB)
- [ ] `src/lib/api-history.test.ts` — stubs for PERF-03 (minimal timing test, mocked DB)

*Existing infrastructure (vitest.config.ts, `src/lib/api-live.test.ts`, `scripts/lib/poll-live-logic.test.ts`) covers all other phase requirements. No framework installation needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| UI renders last scoreboard data + StaleBanner during DATA_DELAYED | RELY-03 | React render behavior requires browser; Playwright not in scope | 1. Update a live_snapshot row: set `payload.is_stale = true`, `payload.stale_reason = 'poll daemon offline'`, `captured_at` to 90+ seconds ago. 2. Open /live in browser. 3. Verify: StaleBanner visible below scoreboard, last scoreboard + box score data still rendered (not blank/skeleton), banner text shows correct staleness time relative to `captured_at`. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
