---
phase: 16
slug: mvp-launch
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest + manual smoke tests |
| **Config file** | vitest.config.ts (if exists) or inline |
| **Quick run command** | `npx tsc --noEmit` |
| **Full suite command** | `npx tsc --noEmit && npx next build` |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx tsc --noEmit`
- **After every plan wave:** Run `npx tsc --noEmit && npx next build`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | Deploy | build | `npx next build` | ❌ W0 | ⬜ pending |
| 16-01-02 | 01 | 1 | Env vars | manual | check Vercel dashboard | N/A | ⬜ pending |
| 16-02-01 | 02 | 2 | Cron route | build | `npx tsc --noEmit` | ❌ W0 | ⬜ pending |
| 16-02-02 | 02 | 2 | Cron auth | manual | invoke endpoint with/without secret | N/A | ⬜ pending |
| 16-03-01 | 03 | 3 | E2E smoke | manual | visit deployed URL, check dashboard | N/A | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- Existing TypeScript and Next.js infrastructure covers phase — no new test framework needed.

*If none: "Existing infrastructure covers all phase requirements."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Vercel deployment success | Deploy SC-1 | Requires cloud infrastructure | Visit deployed URL, verify 200 response |
| Cron jobs fire on schedule | Deploy SC-2 | Requires Vercel scheduler | Check Vercel cron logs after scheduled time |
| Live game → dashboard updates | Deploy SC-3 | Requires real NBA game | Observe dashboard during live game |
| No fabricated data in production | Deploy SC-4 | Requires visual inspection | Check all API responses for placeholder/mock data |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
