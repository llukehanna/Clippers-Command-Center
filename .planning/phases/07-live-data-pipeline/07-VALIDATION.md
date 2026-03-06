---
phase: 7
slug: live-data-pipeline
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest ^4.0.18 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 7-??-01 | TBD | 0 | LIVE-01, LIVE-12 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 7-??-02 | TBD | 0 | LIVE-08, LIVE-09 | unit | `npx vitest run --reporter=verbose` | ✅ | ⬜ pending |
| 7-??-03 | TBD | 1 | LIVE-07 | manual | Query `SELECT count(*) FROM live_snapshots` before/after poll | N/A | ⬜ pending |
| 7-??-04 | TBD | 1 | LIVE-06 | manual | Run `npm run poll-live` and observe log timestamps | N/A | ⬜ pending |
| 7-??-05 | TBD | 1 | LIVE-12 | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `scripts/lib/nba-live-client.test.ts` — unit tests for `parseNBAClock()` and `clockToSecondsRemaining()` (covers LIVE-01 partial, pure functions)
- [ ] `scripts/poll-live.test.ts` — unit tests for game detection logic and backoff calculation (covers LIVE-01 and LIVE-12)

*Existing infrastructure: `src/lib/insights/live.test.ts` covers LIVE-08 and LIVE-09 fully — already green.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 12s poll cadence | LIVE-06 | Timing is runtime behavior; cannot be meaningfully unit tested | Run `npm run poll-live`, observe timestamps in log lines — should be ~12s apart |
| Snapshot stored on every poll | LIVE-07 | Requires live DB with real game data | `SELECT count(*) FROM live_snapshots` before and after a poll cycle; count should increment by 1 each poll |
| Data delayed fallback | LIVE-12 | Full integration requires simulating live source failure | Kill network or mock NBA CDN failure; confirm last snapshot still served and "data delayed" flag set in response |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
