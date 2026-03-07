---
phase: 9
slug: api-layer
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `vitest.config.ts` (exists, includes `src/lib/**/*.test.ts`) |
| **Quick run command** | `npm test -- --reporter=verbose` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds (unit tests only, no DB) |

---

## Sampling Rate

- **After every task commit:** Run `npm test`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 0 | API-01..07 | infra | `npm test` | ❌ W0 | ⬜ pending |
| 9-01-02 | 01 | 0 | API-01, API-07 | unit | `npm test -- src/lib/api-live.test.ts` | ❌ W0 | ⬜ pending |
| 9-01-03 | 01 | 0 | API-02, API-07 | unit | `npm test -- src/lib/api-home.test.ts` | ❌ W0 | ⬜ pending |
| 9-01-04 | 01 | 0 | API-03, API-07 | unit | `npm test -- src/lib/api-players.test.ts` | ❌ W0 | ⬜ pending |
| 9-01-05 | 01 | 0 | API-04, API-07 | unit | `npm test -- src/lib/api-schedule.test.ts` | ❌ W0 | ⬜ pending |
| 9-01-06 | 01 | 0 | API-05, API-07 | unit | `npm test -- src/lib/api-history.test.ts` | ❌ W0 | ⬜ pending |
| 9-01-07 | 01 | 0 | API-06, API-07 | unit | `npm test -- src/lib/api-insights.test.ts` | ❌ W0 | ⬜ pending |
| 9-02-01 | 02 | 1 | API-01 | unit | `npm test -- src/lib/api-live.test.ts` | ❌ W0 | ⬜ pending |
| 9-03-01 | 03 | 1 | API-02 | unit | `npm test -- src/lib/api-home.test.ts` | ❌ W0 | ⬜ pending |
| 9-04-01 | 04 | 1 | API-03 | unit | `npm test -- src/lib/api-players.test.ts` | ❌ W0 | ⬜ pending |
| 9-05-01 | 05 | 1 | API-04 | unit | `npm test -- src/lib/api-schedule.test.ts` | ❌ W0 | ⬜ pending |
| 9-06-01 | 06 | 1 | API-05 | unit | `npm test -- src/lib/api-history.test.ts` | ❌ W0 | ⬜ pending |
| 9-07-01 | 07 | 1 | API-06 | unit | `npm test -- src/lib/api-insights.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/db.ts` — Next.js-safe DB singleton (throws on missing DATABASE_URL, no process.exit)
- [ ] `src/lib/api-utils.ts` — `buildMeta()`, `buildError()` shared helpers
- [ ] Update `src/lib/odds.ts` import from `../../scripts/lib/db.js` → `./db.js`
- [ ] `src/lib/api-live.test.ts` — stubs for API-01, API-07
- [ ] `src/lib/api-home.test.ts` — stubs for API-02, API-07
- [ ] `src/lib/api-players.test.ts` — stubs for API-03, API-07
- [ ] `src/lib/api-schedule.test.ts` — stubs for API-04, API-07
- [ ] `src/lib/api-history.test.ts` — stubs for API-05, API-07
- [ ] `src/lib/api-insights.test.ts` — stubs for API-06, API-07

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| /api/live returns DATA_DELAYED when poll daemon is down | API-01 | Requires controlling daemon state and clock | Stop poll daemon, wait for stale threshold, curl /api/live, verify stale:true and state:"DATA_DELAYED" |
| /api/live returns NO_ACTIVE_GAME when no Clippers game | API-01 | Requires game schedule state | During off-period or before game, curl /api/live, verify state:"NO_ACTIVE_GAME" and game:null |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
