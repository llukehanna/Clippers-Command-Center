---
phase: 10
slug: core-ui-framework
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest / playwright |
| **Config file** | vitest.config.ts / playwright.config.ts |
| **Quick run command** | `npx vitest run` |
| **Full suite command** | `npx vitest run && npx playwright test` |
| **Estimated runtime** | ~30 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run`
- **After every plan wave:** Run `npx vitest run && npx playwright test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | foundation | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 10-01-02 | 01 | 1 | layout | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 10-01-03 | 01 | 1 | navigation | e2e | `npx playwright test` | ❌ W0 | ⬜ pending |
| 10-02-01 | 02 | 2 | stat-cards | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 10-02-02 | 02 | 2 | tables | unit | `npx vitest run` | ❌ W0 | ⬜ pending |
| 10-02-03 | 02 | 2 | charts | unit | `npx vitest run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/layout.test.tsx` — stubs for layout grid and min-width constraint
- [ ] `src/__tests__/navigation.test.tsx` — stubs for TopNav routing
- [ ] `src/__tests__/components/stat-card.test.tsx` — stubs for StatCard component
- [ ] `src/__tests__/components/data-table.test.tsx` — stubs for DataTable component
- [ ] `src/__tests__/components/chart.test.tsx` — stubs for chart wrapper component
- [ ] `e2e/navigation.spec.ts` — Playwright stubs for page routing
- [ ] `vitest.config.ts` — if not already present
- [ ] `playwright.config.ts` — if not already present

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Layout grid at exactly 1024px breakpoint | min-width constraint | Visual browser resize | Open in browser, resize to 1024px, verify no horizontal scroll |
| Dark theme token rendering | design system | Visual inspection | Check colors match Clippers brand (#C8102E, #0F172A) |
| TopNav active state highlighting | navigation | Visual inspection | Click each page link, verify active indicator |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
