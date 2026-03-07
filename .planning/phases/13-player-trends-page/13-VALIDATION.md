---
phase: 13
slug: player-trends-page
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-07
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run --reporter=verbose` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --reporter=verbose`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-01 | 01 | 1 | PLAYER-02, PLAYER-03 | unit | `npx vitest run src/__tests__/players/derivation.test.ts` | ❌ W0 | ⬜ pending |
| 13-01-02 | 01 | 1 | PLAYER-04 | unit | `npx vitest run src/__tests__/players/rolling.test.ts` | ❌ W0 | ⬜ pending |
| 13-02-01 | 02 | 2 | PLAYER-01 | manual | Visit `/players` — verify list/cards/grid toggle works | N/A | ⬜ pending |
| 13-02-02 | 02 | 2 | PLAYER-01 | manual | Verify traded players appear with badge | N/A | ⬜ pending |
| 13-03-01 | 03 | 2 | PLAYER-02, PLAYER-03 | manual | Verify L5/L10/Season table renders with color coding | N/A | ⬜ pending |
| 13-03-02 | 03 | 2 | PLAYER-04 | manual | Verify trend chart renders with metric selector | N/A | ⬜ pending |
| 13-03-03 | 03 | 2 | PLAYER-05 | manual | Verify game log table shows all columns, scrolls | N/A | ⬜ pending |
| 13-03-04 | 03 | 2 | PLAYER-06 | manual | Verify splits show home/away, wins/losses | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/players/derivation.test.ts` — unit tests for L5/Season average derivation from game_log rows
- [ ] `src/__tests__/players/rolling.test.ts` — unit tests for client-side rolling window computation (REB, AST)

*These stubs must exist before Wave 1 API work begins so derivation logic can be TDD'd.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Roster view toggle (list/cards/grid) | PLAYER-01 | UI interaction state | Load `/players`, click each toggle, verify layout changes |
| Traded player badge appears | PLAYER-01 | Requires live API with current-season traded player | Check badge renders inline in roster list |
| Rolling averages color coding | PLAYER-02 | CSS token visual check | Verify L5 column is green/red relative to L10 |
| Trend chart metric selector | PLAYER-04 | Client-side state interaction | Click REB/AST/TS%, verify chart lines update |
| Game log table scroll | PLAYER-05 | Visual overflow behavior | Verify max-height ~400px, vertical scroll works |
| Splits display | PLAYER-06 | Data correctness visual | Check home/away, win/loss values match expectations |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
