---
phase: 8
slug: odds-integration
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` (includes `src/lib/**/*.test.ts` and `scripts/lib/**/*.test.ts`) |
| **Quick run command** | `npx vitest run src/lib/odds.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run src/lib/odds.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 1 | ODDS-04 | type check | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 8-01-02 | 01 | 1 | ODDS-04 | type check | `npx tsc --noEmit` | ✅ | ⬜ pending |
| 8-02-01 | 02 | 1 | ODDS-02, ODDS-03 | unit | `npx vitest run src/lib/odds.test.ts` | ❌ W0 | ⬜ pending |
| 8-02-02 | 02 | 1 | ODDS-02, ODDS-03 | unit | `npx vitest run src/lib/odds.test.ts` | ❌ W0 | ⬜ pending |
| 8-03-01 | 03 | 2 | ODDS-01 | manual | `npm run sync-odds` against real DB | ❌ W0 | ⬜ pending |
| 8-04-01 | 04 | 2 | ODDS-01 | manual | GitHub Actions workflow_dispatch trigger | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/odds.test.ts` — unit tests for `getLatestOdds()` covering ODDS-02 (returns typed snapshot) and ODDS-03 (returns null when missing or stale)
- [ ] No framework changes needed — `vitest.config.ts` already includes `src/lib/**/*.test.ts`

*Existing infrastructure covers all automated verification needs.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| INSERT into odds_snapshots writes correct values | ODDS-01 | Requires live DB + real ODDS_API_KEY; no mock can verify actual ingestion | Run `npm run sync-odds` after API key configured; query `SELECT * FROM odds_snapshots ORDER BY captured_at DESC LIMIT 5` to verify rows appear |
| GitHub Actions cron triggers correctly | ODDS-01 | Requires deployed workflow | Use `workflow_dispatch` manual trigger in GitHub Actions UI; verify run succeeds and rows appear in DB |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
