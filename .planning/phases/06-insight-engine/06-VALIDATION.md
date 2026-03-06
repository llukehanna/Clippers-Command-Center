---
phase: 6
slug: insight-engine
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-06
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (none installed — Wave 0 installs) |
| **Config file** | `vitest.config.ts` — Wave 0 creates |
| **Quick run command** | `npx vitest run scripts/lib/insights/live.test.ts` |
| **Full suite command** | `npx vitest run` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run scripts/lib/insights/live.test.ts`
- **After every plan wave:** Run `npx vitest run`
- **Before `/gsd:verify-work`:** Full suite must be green + manual `npm run generate-insights` smoke run against seed DB
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 6-W0-01 | W0 | 0 | INSIGHT-03, INSIGHT-04 | unit | `npx vitest run scripts/lib/insights/__tests__/proof.test.ts` | ❌ W0 | ⬜ pending |
| 6-W0-02 | W0 | 0 | INSIGHT-05 | unit | `npx vitest run scripts/lib/insights/live.test.ts` | ❌ W0 | ⬜ pending |
| 6-01-01 | batch | 1+ | INSIGHT-01, INSIGHT-02 | integration | `npm run generate-insights` (manual smoke) | ✅ | ⬜ pending |
| 6-02-01 | live | 1+ | INSIGHT-05 | unit | `npx vitest run scripts/lib/insights/live.test.ts` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `package.json` — add `"test": "vitest run"` script and install `vitest` as devDependency: `npm install -D vitest`
- [ ] `vitest.config.ts` — minimal config pointing at TypeScript source
- [ ] `scripts/lib/insights/live.test.ts` — unit tests for `generateLiveInsights`, `detectScoringRun`, `isClutchSituation` using constructed snapshots
- [ ] `scripts/lib/insights/__tests__/proof.test.ts` — unit tests for `makeProofHash` determinism and the "reject if proof_result empty" guard
- [ ] `Docs/DB_SCHEMA.sql` — add `CREATE UNIQUE INDEX IF NOT EXISTS uq_insights_proof_hash ON insights (proof_hash) WHERE proof_hash IS NOT NULL;`
- [ ] `npm run db:schema` — re-apply schema to add the unique index

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Script generates rows into `insights` table | INSIGHT-01 | Requires live DB connection with seed data | Run `npm run generate-insights`, check `SELECT COUNT(*) FROM insights` increases |
| All 7 categories produce output rows | INSIGHT-02 | Requires DB with seed data for all category types | Run `npm run generate-insights`, then `SELECT category, COUNT(*) FROM insights GROUP BY category` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
