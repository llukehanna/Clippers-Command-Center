# Phase 15: Reliability and Validation - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Validate that the system behaves correctly under real-world failure conditions — upstream API outages, rate limits, stale data — and that all performance SLAs are met. This phase proves the system works; it does not add new features.

Out of scope: New API endpoints, new UI features, schema changes, deployment infrastructure (Phase 16).

</domain>

<decisions>
## Implementation Decisions

### Test types and tooling
- **Vitest unit + integration tests** — no browser testing (Playwright/Cypress out of scope)
- Vitest is already configured; `src/lib/api-live.test.ts` has `.todo` scaffolding — fill these in
- DB mocked via `vi.mock()` stubbing the `sql` template tag — tests run offline, fast, deterministic. No Neon dependency in CI.
- Polling daemon behavior tested via mocking `fetchScoreboard()` / `fetchBoxscore()` at the HTTP client level

### Test coverage targets
- **`/api/live`** — primary target: NO_ACTIVE_GAME, DATA_DELAYED, LIVE states + staleness detection + timing SLA
- **Polling daemon** (`scripts/poll-live.ts` / `poll-live-logic.ts`) — backoff math, failure counter increments, success resets counter
- `/api/home` and `/api/history/*` — NOT in scope for this phase (low reliability risk; 300/400ms SLA validated via spot-check if needed)

### Polling daemon test specifics
- `calculateBackoff()` — verify correct ms values, ceiling at 60s (pure unit test)
- Failure counter increments — when `fetchScoreboard()` throws, next interval uses longer delay
- Success resets counter — after successful poll following failures, counter returns to 0

### Performance measurement methodology
- **Timing assertions in Vitest integration tests** — wrap route handler calls in `Date.now()` before/after, assert elapsed < threshold
- **What "response time" means**: route handler wall time (start of handler → Response built). Excludes network and Next.js routing overhead.
- Thresholds: `/api/live` < 200ms, `/api/home` < 300ms, `/api/history/*` < 400ms
- Tests use mocked DB (vi.mock) so timing reflects processing logic, not DB latency — acceptable for SLA validation at this stage

### Upstream outage simulation
- **"Upstream outage" = polling daemon can't reach NBA CDN** — mock `fetchScoreboard()` to throw network errors
- Verify the daemon: applies backoff, increments failure counter, recovers when CDN comes back
- The DB still holds the last valid snapshot — the API serves it as DATA_DELAYED, not an error

### Staleness threshold
- A snapshot is flagged stale when it is **3+ minutes old** — ~15 missed polls at 12s cadence, clearly an outage
- The poll daemon already writes `is_stale: true` into the snapshot payload when it detects issues — trust that flag first; fall back to age check if the payload flag is absent

### DATA_DELAYED API behavior
- Return `state: 'DATA_DELAYED'`, `meta.stale: true`, `meta.stale_reason: 'poll daemon offline'`
- Last known snapshot data STILL included in the response — not stripped, not replaced with null
- This is already how `buildMeta()` works; tests should validate the contract explicitly

### UI fallback behavior during DATA_DELAYED
- **Last data + stale banner** — keep the last known scoreboard/box score visible
- **Banner placement:** Small muted banner below the scoreboard hero, above the box score
- **Banner text:** "Live data delayed — last updated X minutes ago." (relative time from `meta.generated_at` vs `captured_at`)
- Do NOT show skeleton/loading state or error page — the last real data is more valuable than a blank screen

### Claude's Discretion
- Exact banner styling (muted yellow vs amber vs `text-muted-foreground` — keep it understated)
- Whether timing assertion tests use `expect(elapsed).toBeLessThan(threshold)` or a custom matcher
- Test file organization (co-locate with routes vs separate `__tests__/` folder)
- Whether `api-home.test.ts` and `api-history.test.ts` are created as stubs or skipped entirely

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/api-utils.ts`: `buildMeta()` and `buildError()` — already handle stale/stale_reason/ttl_seconds. Tests should validate these contracts.
- `scripts/lib/poll-live-logic.ts`: `calculateBackoff()`, `findClippersGame()`, `isClippersGame()` — pure functions, fully unit-testable with no mocks.
- `src/lib/api-live.test.ts`: Existing `.todo` scaffolding for `/api/live` — fill in these tests rather than creating a new file.
- `src/app/api/live/route.ts` (and `app/api/live/route.ts`): Two copies exist — confirm which is active before writing integration tests.

### Established Patterns
- Vitest already configured — `describe` / `it` / `expect` / `vi.mock` available
- `buildMeta()` signature: `(source, ttl, stale?, stale_reason?)` — produces `generated_at`, `source`, `stale`, `stale_reason`, `ttl_seconds`
- `buildError()` signature: `(code, message, details?)` — produces `{ error: { code, message, details } }`
- API responses always include a `meta` envelope — every test should assert meta fields present
- Staleness metadata flow: poll daemon sets `is_stale` in snapshot payload → `/api/live` reads snapshot → propagates to `meta.stale` in response

### Integration Points
- `app/live/page.tsx` — needs DATA_DELAYED banner UI added (below scoreboard hero, above box score)
- `scripts/poll-live.ts` — imports `poll-live-logic.ts`; tests for the daemon should mock at the `nba-live-client.ts` level
- Two `app/api/live/route.ts` paths — one under `app/`, one under `src/app/api/` — resolve which is active before testing

</code_context>

<specifics>
## Specific Ideas

- Backoff test should cover: failureCount=0 (baseMs unchanged), failureCount=3 (8x base), failureCount=10 (capped at 60s)
- DATA_DELAYED banner: small, muted, not alarming. "Live data delayed — last updated 4 minutes ago." Relative time, not absolute. Don't use red color — red is for Clippers accent only.
- The test for "success resets counter" is important: without it, a brief CDN blip could leave the daemon permanently backing off even after recovery.
- Keep test files close to the code they test — `src/lib/api-live.test.ts` pattern is already established.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 15-reliability-and-validation*
*Context gathered: 2026-03-11*
