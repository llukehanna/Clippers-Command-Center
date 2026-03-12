---
phase: 15-reliability-and-validation
verified: 2026-03-11T20:10:00Z
status: human_needed
score: 18/18 must-haves verified
human_verification:
  - test: "DATA_DELAYED scenario — insert stale snapshot and visit /live"
    expected: "Amber banner appears with text 'Data delayed — last updated X min ago' (relative to snapshot capture time). Scoreboard and last known score remain visible. No blank screen, skeleton, or error page. Banner is below scoreboard hero, above KeyMetricsRow."
    why_human: "Visual and UX correctness of DATA_DELAYED UI path cannot be verified programmatically. Plan 03 was marked human-verified by the executor but this cannot be independently confirmed without a code commit timestamp or screenshot."
---

# Phase 15: Reliability and Validation — Verification Report

**Phase Goal:** Establish test coverage and reliability guarantees for the live data pipeline — validate all three game states, SLA timing, polling daemon failure logic, and the DATA_DELAYED UI path with accurate staleness timing.
**Verified:** 2026-03-11T20:10:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | GET /api/live returns state:NO_ACTIVE_GAME with game:null when no snapshot exists | VERIFIED | `src/lib/api-live.test.ts` line 195–207: test passes, asserts state='NO_ACTIVE_GAME', game=null, key_metrics=[], box_score=null |
| 2 | GET /api/live returns state:DATA_DELAYED with meta.stale:true when snapshot is_stale=true | VERIFIED | Lines 209–223: asserts state='DATA_DELAYED', meta.stale=true, meta.stale_reason='poll daemon offline', game not null |
| 3 | GET /api/live returns state:DATA_DELAYED via age (captured_at 90s ago) | VERIFIED | Lines 225–237: separate test for time-based stale path |
| 4 | GET /api/live returns state:LIVE with 4 key_metrics when a fresh snapshot exists | VERIFIED | Lines 239–264: tests both state='LIVE' and key_metrics=['efg_pct','tov_margin','reb_margin','pace'] in order |
| 5 | GET /api/live handler completes in under 200ms (wall-clock, mocked DB) | VERIFIED | Lines 337–345: timing test with Date.now() before/after, asserts elapsed < 200 |
| 6 | calculateBackoff returns 12000 at failureCount=0, caps at 60000 for failureCount>=3 | VERIFIED | `scripts/lib/poll-live-logic.test.ts` lines 53–73: 5 tests covering failure counts 0,1,2,3,10 |
| 7 | When fetchScoreboard() throws, polling loop calls calculateBackoff with incrementing failureCount | VERIFIED | Lines 144–163: test asserts runPollCycle(0)=1, runPollCycle(1)=2, and backoff2 > backoff1 |
| 8 | After a successful poll following failures, failureCount resets to 0 | VERIFIED | Lines 166–185: test asserts after failure count=1, success resets to 0; confirms next failure uses count=1 not 2 |
| 9 | GET /api/home handler completes in under 300ms (wall-clock, mocked DB) | VERIFIED | `src/lib/api-home.test.ts` lines 161–169: timing test, asserts status=200 and elapsed < 300 |
| 10 | GET /api/history/games handler completes in under 400ms (wall-clock, mocked DB) | VERIFIED | `src/lib/api-history.test.ts` lines 53–60: timing test, asserts status=200 and elapsed < 400 |
| 11 | Stale src/app/api/live/route.ts duplicate is deleted | VERIFIED | `ls /Users/luke/CCC/src/app/api/live/route.ts` returns absent; directory is empty |
| 12 | DATA_DELAYED response includes snapshot_captured_at field | VERIFIED | `app/api/live/route.ts` line 312: `snapshot_captured_at: snap.captured_at` in DATA_DELAYED branch only |
| 13 | StaleBanner shows time relative to capturedAt (snapshot time), not generatedAt (response time) | VERIFIED | `components/stale-banner/StaleBanner.tsx` line 15: `const timeRef = capturedAt ?? generatedAt`; capturedAt prop defined |
| 14 | hooks/useLiveData.ts LiveDashboardPayload type includes snapshot_captured_at? | VERIFIED | `hooks/useLiveData.ts` line 10: `snapshot_captured_at?: string` in LiveDashboardPayload |
| 15 | app/live/page.tsx passes capturedAt={data?.snapshot_captured_at} to StaleBanner | VERIFIED | `app/live/page.tsx` line 124: `capturedAt={data?.snapshot_captured_at}` |
| 16 | StaleBanner is placed below scoreboard hero, above KeyMetricsRow | VERIFIED | `app/live/page.tsx` lines 115–135: StaleBanner renders after LiveScoreboard section, before KeyMetricsRow section |
| 17 | During DATA_DELAYED, game (last known score) is still present in response — no blank screen | VERIFIED | `app/api/live/route.ts` line 313: `game: gameData` present in DATA_DELAYED response; page.tsx renders `data?.game` when truthy |
| 18 | Full test suite passes (npm test exits 0) | VERIFIED | 17 test files, 159 passing tests, 34 todo items, 0 failures |

**Score:** 18/18 truths verified (automated)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/api-live.test.ts` | Integration tests for /api/live — all 3 states + timing SLA | VERIFIED | 346 lines; 16 tests; 0 .todo stubs remaining; imports GET from `../../app/api/live/route` |
| `scripts/lib/poll-live-logic.test.ts` | Unit tests for calculateBackoff + failure-counter increment and reset | VERIFIED | 187 lines; 18 tests; new 'polling daemon failure counter' describe block with 2 behavioral tests |
| `src/lib/api-home.test.ts` | Timing SLA test for /api/home < 300ms | VERIFIED | 179 lines; PERF-02 test at line 161; asserts status=200 and elapsed < 300 |
| `src/lib/api-history.test.ts` | Timing SLA test for /api/history/games < 400ms | VERIFIED | 91 lines; PERF-03 test at line 53; asserts status=200 and elapsed < 400 |
| `components/stale-banner/StaleBanner.tsx` | Updated banner consuming capturedAt prop | VERIFIED | Contains `capturedAt` prop; `timeRef = capturedAt ?? generatedAt` logic |
| `app/api/live/route.ts` | DATA_DELAYED response includes snapshot.captured_at | VERIFIED | Line 312: `snapshot_captured_at: snap.captured_at` in DATA_DELAYED branch |
| `hooks/useLiveData.ts` | LiveDashboardPayload type extended with snapshot_captured_at field | VERIFIED | Line 10: `snapshot_captured_at?: string` |
| `src/app/api/live/route.ts` | Must NOT exist (stale duplicate deleted) | VERIFIED | File absent; directory empty |
| `scripts/lib/poll-live-logic.ts` | runPollCycle() exported for testability | VERIFIED | Lines 61–71: `export async function runPollCycle(previousFailureCount, deps)` returns updated counter |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/lib/api-live.test.ts` | `app/api/live/route.ts` | `import { GET } from '../../app/api/live/route'` | WIRED | Line 26: exact import present |
| `src/lib/api-live.test.ts` | `src/lib/db.ts` | `vi.mock('@/src/lib/db', ...)` | WIRED | Lines 11–16: mock with sqlMock and LAC_NBA_TEAM_ID |
| `scripts/lib/poll-live-logic.test.ts` | `scripts/lib/poll-live-logic.ts` | `import { calculateBackoff, runPollCycle }` | WIRED | Lines 3–8: all required exports imported and tested |
| `src/lib/api-home.test.ts` | `app/api/home/route.ts` | `import { GET } from '../../src/app/api/home/route.js'` | WIRED | Line 61: dynamic import in test body |
| `src/lib/api-history.test.ts` | `app/api/history/games/route.ts` | `import { GET } from '../../app/api/history/games/route.js'` | WIRED | Line 54: dynamic import in test body |
| `app/live/page.tsx` | `components/stale-banner/StaleBanner.tsx` | `capturedAt={data?.snapshot_captured_at}` | WIRED | Line 124: capturedAt prop passed from typed data |
| `app/api/live/route.ts` | StaleBanner (via response body) | `snapshot_captured_at: snap.captured_at` in DATA_DELAYED response | WIRED | Line 312: field present in DATA_DELAYED branch only |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| PERF-01 | 15-01 | /api/live response time < 200ms | SATISFIED | `api-live.test.ts` line 337–345: timing assertion < 200ms passes in test suite |
| PERF-02 | 15-02 | /api/home response time < 300ms | SATISFIED | `api-home.test.ts` line 161–169: timing assertion < 300ms passes |
| PERF-03 | 15-02 | /api/history/* response time < 400ms | SATISFIED | `api-history.test.ts` line 53–60: timing assertion < 400ms passes |
| RELY-01 | 15-01 | System continues serving cached data during upstream API outages | SATISFIED | DATA_DELAYED test asserts game is not null (last snapshot served); api-live route confirmed returns gameData in DATA_DELAYED branch |
| RELY-02 | 15-01 | Exponential backoff on live polling failures | SATISFIED | calculateBackoff math tests (5 cases) + failure-counter increment/reset behavioral tests both passing |
| RELY-03 | 15-03 | UI remains functional and meaningful during all upstream outage scenarios | PARTIALLY SATISFIED (AUTOMATED) / NEEDS HUMAN | Code changes verified: snapshot_captured_at in API, capturedAt in StaleBanner, type in hook, wiring in page.tsx. Visual/UX correctness needs human confirmation. |

All 6 requirement IDs declared in plan frontmatter are accounted for. No orphaned requirements found for phase 15.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/lib/api-history.test.ts` | 72–90 | Multiple `it.todo` blocks in test file | Info | These are pre-existing spec-only stubs from an earlier phase (API-05 behavioral tests). Phase 15 only added PERF-03 timing tests to this file; the todos are out of scope for this phase and do not affect PERF-03 coverage. |
| `src/lib/api-live.test.ts` | Various | TypeScript type errors from `mockResolvedValueOnce` — plain arrays not assignable to `ResultQueryMeta<number, never>` | Warning | 10 TS type errors in tsc output. Tests pass at runtime because vitest ignores the type mismatch. The mock is functionally correct; type precision is cosmetic. Does not block goal achievement. |

No blockers found.

---

### Human Verification Required

#### 1. DATA_DELAYED UI Scenario

**Test:** Simulate a stale snapshot by inserting a row into `live_snapshots` with `is_stale=true` and `captured_at = NOW() - INTERVAL '5 minutes'`, then visit `http://localhost:3000/live`.

SQL to insert test row:
```sql
INSERT INTO live_snapshots (game_id, period, clock, home_score, away_score, captured_at, payload)
VALUES (
  (SELECT game_id FROM games LIMIT 1),
  3, '5:00', 88, 82,
  NOW() - INTERVAL '5 minutes',
  '{"is_stale": true, "stale_reason": "poll daemon offline", "home_box": null, "away_box": null, "recent_scoring": []}'::jsonb
);
```

**Expected:**
- Amber banner appears below the scoreboard hero with text including "Data delayed — last updated 5 min ago" (approximate, relative to captured_at not generated_at)
- Scoreboard hero and last known score (88–82) remain visible — no blank screen
- No skeleton loaders, no error page
- Banner is positioned below the scoreboard, above the metrics row
- Banner uses amber styling (amber-400 text, amber-950/40 background) — not red

**Why human:** Visual layout, text content, and absence of blank screen cannot be verified from static code analysis alone. Plan 03 records human verification as "approved" but no screenshot or independent evidence exists.

---

### Gaps Summary

No gaps found. All 18 automated truths verified. All 6 requirements satisfied at the code level. The single human verification item (DATA_DELAYED visual scenario) is the final gate for RELY-03 closure — the code is correct; confirmation is a visual check.

---

### Notes

1. The `src/lib/api-live.test.ts` file has 10 TypeScript type errors from `mockResolvedValueOnce` calls (plain arrays not matching the `ResultQueryMeta` type). These are type-only issues — all 16 tests pass at runtime. A future cleanup could cast mocks with `as unknown as ResultQueryMeta<...>` but this does not affect goal achievement.

2. The `vitest.config.ts` was updated in Plan 01 to add `@/*` path alias resolution. This is a required infrastructure change and is correctly in place.

3. `runPollCycle` in `scripts/lib/poll-live-logic.ts` is a minimal extraction (11 lines) that enables behavioral testing without running the full `while(true)` loop in `poll-live.ts`. The daemon is untouched.

---

_Verified: 2026-03-11T20:10:00Z_
_Verifier: Claude (gsd-verifier)_
