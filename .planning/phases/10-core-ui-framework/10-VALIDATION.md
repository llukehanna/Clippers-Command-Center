---
phase: 10
slug: core-ui-framework
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-06
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

> **Note:** Phase 10 builds presentational UI components (layout, navigation, stat cards, tables, charts).
> Per RESEARCH.md Validation Architecture: "No unit tests are required for Phase 10 UI components — these are presentational and verified visually. Existing test suite must continue to pass."
> All tasks use structural grep/ls verification + manual visual checks. No Wave 0 test stubs required.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | structural verification (grep/ls) + visual inspection |
| **Config file** | none — Wave 0 not required per RESEARCH.md |
| **Quick run command** | `npm run build` (no build errors) |
| **Full suite command** | `npm run build && npm run dev` (renders correctly) |
| **Estimated runtime** | ~15 seconds (build) |

---

## Sampling Rate

- **After every task commit:** Run task `<automated>` verify command (grep/ls)
- **After every plan wave:** Run `npm run build` — must succeed with no errors
- **Before `/gsd:verify-work`:** Full build green + manual visual checks complete
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | foundation | structural | grep/node require | ✅ inline | ⬜ pending |
| 10-01-02 | 01 | 1 | layout | structural | grep layout.tsx | ✅ inline | ⬜ pending |
| 10-01-03 | 01 | 1 | shadcn primitives | structural | ls components/ui | ✅ inline | ⬜ pending |
| 10-02-01 | 02 | 2 | navigation | structural | ls + grep TopNav | ✅ inline | ⬜ pending |
| 10-02-02 | 02 | 2 | live hook | structural | ls + grep useLiveData | ✅ inline | ⬜ pending |
| 10-03-01 | 03 | 2 | stat-cards | structural | ls + grep StatCard | ✅ inline | ⬜ pending |
| 10-03-02 | 03 | 2 | tables | structural | ls + grep BoxScoreTable | ✅ inline | ⬜ pending |
| 10-03-03 | 03 | 2 | charts | structural | ls + grep charts | ✅ inline | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test stubs required — Phase 10 UI components are verified structurally (file existence + grep) and visually per RESEARCH.md.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Layout grid at exactly 1024px breakpoint | min-width constraint | Visual browser resize | Open in browser, resize to 1024px, verify no horizontal scroll |
| Dark theme token rendering | design system | Visual inspection | Check colors match Clippers brand (#C8102E, #0F172A) |
| TopNav active state highlighting | navigation | Visual inspection | Click each page link, verify active indicator underline appears |
| LiveDot pulsing animation | live indicator | Visual inspection | Navigate to Live page, verify amber/red dot animates |
| Chart hover tooltips | chart wrappers | Visual inspection | Hover over chart data points, verify dark-styled tooltip appears |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none — structural verification used throughout)
- [x] No watch-mode flags
- [x] Feedback latency < 15s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-06
