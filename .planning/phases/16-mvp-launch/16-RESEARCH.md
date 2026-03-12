# Phase 16: MVP Launch - Research

**Researched:** 2026-03-12
**Domain:** Vercel deployment, Vercel Cron Jobs, GitHub Actions, Next.js App Router
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Live polling infrastructure**
- Vercel Cron + stateless — convert `poll-live.ts` to a stateless Vercel Cron Job (60s cadence)
- 60s polling is acceptable — NBA box scores update every ~30s, 60-90s data lag is fine for a fan dashboard
- Drop the backoff state — each cron run is independent; if NBA CDN is down, the run fails silently and the DB retains the last snapshot (DATA_DELAYED path handles it)
- 24/7 always-on — cron fires unconditionally every 60s; if no game is live, it writes NO_ACTIVE_GAME and exits fast

**Scheduled jobs coverage**
- `sync-odds` — already has a workflow (every 6h); no changes needed
- `sync-schedule` — new workflow, runs daily at 6am PT
- `finalize-games` → `compute-stats` → `generate-insights` — one chained workflow, runs nightly at 2am PT; if any step fails, later steps don't run
- `backfill` — NOT a recurring workflow; one-time pre-launch step

**Pre-launch data readiness**
- Backfill 2024-25 and 2025-26 seasons before launch — trends, stats, and insights will be meaningful from day one
- Run as a manual pre-launch checklist step: backfill → compute-stats → generate-insights in sequence
- Environment variables for production: DATABASE_URL, BALLDONTLIE_API_KEY, ODDS_API_KEY — configure in both Vercel (for app + cron) and GitHub Secrets (for Actions workflows)

**Smoke testing**
- Immediate post-deploy checks (before any live game):
  - All 5 routes return 200: `/`, `/live`, `/schedule`, `/history`, player pages
  - API spot-check: `/api/home`, `/api/schedule`, `/api/players`, `/api/live` (expects `NO_ACTIVE_GAME`)
  - Verify no fabricated/mock data surfaces — everything shown traces to DB
- Live pipeline verification: manual test on the next Clippers game night
- No DEPLOYMENT.md — deployment steps are tasks in the plan file

### Claude's Discretion
- Exact Vercel Cron configuration syntax (`vercel.json` vs `vercel.json` + route handler approach)
- Whether the stateless cron is a dedicated API route (`/api/cron/poll-live`) or reuses existing `/api/live` logic
- How to handle the `DELAY_MS` env var in production (may not be needed for cron approach)
- Specific GitHub Actions workflow file names and job names

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.
</user_constraints>

---

## Summary

Phase 16 deploys the completed CCC application to Vercel with Neon PostgreSQL as the production database, wires up all scheduled automation, runs the pre-launch data backfill, and verifies the end-to-end workflow. There is no new feature work — every deliverable is infrastructure, configuration, or verification.

The two distinct infrastructure tracks are: (1) Vercel Cron — a new stateless `/api/cron/poll-live` route handler invoked every 60s to replace the long-running `poll-live.ts` loop, and (2) GitHub Actions — two new workflow files (`sync-schedule.yml` and `post-game.yml`) modeled on the existing `sync-odds.yml` template.

The critical constraint is Vercel plan tier: 60-second cron cadence requires a Pro plan. On Hobby, the minimum cron interval is once per day. All other scheduled jobs (every 6h, daily, nightly) are compatible with both plans.

**Primary recommendation:** Use a dedicated `/api/cron/poll-live/route.ts` App Router handler secured with `CRON_SECRET`. Extract the single-run fetch-and-write logic from `poll-live.ts` into a reusable module so both the cron handler and the existing CLI script can share it.

---

## Standard Stack

### Core

| Library / Service | Version / Plan | Purpose | Why Standard |
|-------------------|----------------|---------|--------------|
| Vercel | Pro (required for 60s cron) | Hosting + Cron Jobs | Native Next.js platform |
| Neon PostgreSQL | Existing | Production DB | Already in use; no migration needed |
| GitHub Actions | Built-in | Scheduled data pipeline jobs | Already used for `sync-odds.yml` |
| Next.js App Router | 16.1.6 (already installed) | Cron route handler | All API routes are already App Router |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `CRON_SECRET` env var | Vercel-native | Cron authentication | Required to secure the cron endpoint from public invocation |
| `export const dynamic = 'force-dynamic'` | Next.js RSC config | Prevent static caching of cron route | Required for cron route handlers in App Router |
| `export const maxDuration` | Next.js route config | Bound cron execution time | Set to 30s — single NBA CDN fetch + DB write is well under limit |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Dedicated `/api/cron/poll-live` route | Reuse `/api/live` route | `/api/live` serves the UI payload; cron logic (snapshot write) is different — keep them separate to avoid coupling |
| GitHub Actions for daily/nightly jobs | Vercel Cron for those too | GitHub Actions already has the pattern, runs scripts directly via npm, and has no duration limits — better fit for multi-step chained jobs |

**Installation:** No new npm packages required for this phase.

---

## Architecture Patterns

### Recommended Project Structure (new files only)

```
app/
└── api/
    └── cron/
        └── poll-live/
            └── route.ts          # Stateless cron handler (NEW)

scripts/lib/
└── run-poll-once.ts              # Extracted single-run logic (NEW, reused by cron handler)

.github/workflows/
├── sync-odds.yml                 # Existing — no changes
├── sync-schedule.yml             # NEW — daily 6am PT
└── post-game.yml                 # NEW — nightly 2am PT, chained steps

vercel.json                       # NEW — add "crons" block
```

### Pattern 1: Vercel Cron Route Handler (App Router)

**What:** An App Router GET handler at `/api/cron/poll-live` that Vercel invokes every 60s via the `crons` block in `vercel.json`. Secured with `CRON_SECRET`. Stateless — no while-loop, no backoff state.

**When to use:** Any scheduled task that must run on sub-hourly cadence in a Vercel-hosted Next.js app.

**vercel.json crons block:**
```json
// Source: https://vercel.com/docs/cron-jobs
{
  "crons": [
    {
      "path": "/api/cron/poll-live",
      "schedule": "* * * * *"
    }
  ]
}
```

**Route handler:**
```typescript
// Source: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
// app/api/cron/poll-live/route.ts
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Import and call the extracted single-run poll logic
  const { runPollOnce } = await import('@/scripts/lib/run-poll-once');
  await runPollOnce();

  return Response.json({ ok: true });
}
```

**Key details from official docs (HIGH confidence):**
- Vercel sends `Authorization: Bearer <CRON_SECRET>` automatically on every invocation
- `CRON_SECRET` must be set as a Vercel environment variable
- `export const dynamic = 'force-dynamic'` is required to prevent Next.js from statically caching the route
- `export const maxDuration = 30` bounds the function within Vercel limits
- Vercel does NOT retry failed cron invocations
- On Hobby: minimum cadence = once per day. On Pro: minimum = once per minute

### Pattern 2: Chained GitHub Actions Workflow

**What:** A single workflow file (`post-game.yml`) with sequential steps: `finalize-games` → `compute-stats` → `generate-insights`. Using `&&` chaining or sequential `run:` steps that exit non-zero on failure ensures later steps are skipped if an earlier one fails.

**When to use:** Multi-step nightly pipeline where downstream steps depend on upstream results.

```yaml
# Source: modeled on .github/workflows/sync-odds.yml
name: Post-Game Pipeline

on:
  schedule:
    - cron: '0 10 * * *'   # 2am PT = 10:00 UTC
  workflow_dispatch:

jobs:
  post-game:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci

      - name: Finalize games
        run: npm run finalize-games
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BALLDONTLIE_API_KEY: ${{ secrets.BALLDONTLIE_API_KEY }}

      - name: Compute stats
        run: npm run compute-stats
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}

      - name: Generate insights
        run: npm run generate-insights
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

Note: Each step fails the job independently — GitHub Actions stops on the first non-zero exit unless `continue-on-error: true` is set. Default behavior is correct: if `finalize-games` fails, `compute-stats` and `generate-insights` do not run.

### Pattern 3: Single-Run Poll Logic Extraction

**What:** Extract the core logic from `poll-live.ts`'s `pollLoop` into a standalone `runPollOnce()` function that performs one fetch-and-write cycle with no loop and no backoff state.

**Key reusable pieces from existing code:**
- `findClippersGame()` — already pure, in `poll-live-logic.ts`
- `insertSnapshot()` / `updateGamesRow()` — the DB write functions from `poll-live.ts`
- `fetchScoreboard()` / `fetchBoxscore()` / `fetchPlayByPlay()` — from `nba-live-client.ts`
- `findActiveClippersGameInDB()` — the DB query that finds today's active game

The stateless version: connect → find game in DB → fetch scoreboard → if game found write snapshot → disconnect. If no game found, return `NO_ACTIVE_GAME` and exit. Total runtime under 5s in the happy path.

### Anti-Patterns to Avoid

- **Importing `scripts/lib/db.ts` directly from App Router routes:** The scripts DB module uses `process.exit()` in some error paths. `src/lib/db.ts` (the App Router version) throws `Error` instead — use that one in the cron route handler.
- **Keeping the while-loop in the cron context:** Cron runs are stateless functions. A while-loop inside a Vercel Function will hit `maxDuration` and be terminated. The cron infrastructure IS the loop.
- **Hardcoding 2am PT as `2 * * * *`:** PT is UTC-7 (PDT) or UTC-8 (PST). 2am PT = 10:00 UTC (PDT) or 09:00 UTC (PST). Use 10:00 UTC (`0 10 * * *`) which covers PDT; games ending past 1am PDT are rare.
- **Using Hobby plan for 60s cron:** Hobby restricts cron to once per day. Deployment will fail if a `* * * * *` expression is pushed with a Hobby account.
- **Missing `force-dynamic` on cron route:** Next.js can statically optimize GET routes. Without `export const dynamic = 'force-dynamic'`, the route may be served from cache rather than executing fresh on each cron invocation.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cron authentication | Custom token validation | `CRON_SECRET` env var + Vercel's automatic header injection | Vercel handles secret rotation and header injection; custom logic is error-prone |
| Cron scheduling | A separate timer process or always-on server | Vercel Cron (`vercel.json` crons block) | Platform-native, zero infra to maintain, included in all plans |
| Post-job chaining | Webhook triggers between jobs | Sequential `run:` steps in one GitHub Actions job | Simpler, shares workspace, fails correctly on first error |
| Env var management | `.env` files in repo | Vercel environment variables + GitHub Secrets | Secrets never in git; Vercel injects them at function runtime |

---

## Common Pitfalls

### Pitfall 1: Hobby Plan Blocks 60s Cron
**What goes wrong:** Pushing `vercel.json` with `"* * * * *"` on a Hobby Vercel account fails during deployment with: "Hobby accounts are limited to daily cron jobs."
**Why it happens:** Vercel enforces plan limits at deploy time, not at runtime.
**How to avoid:** Confirm the Vercel project is on a Pro plan before deploying cron config. Check: Vercel dashboard → Settings → Usage plan.
**Warning signs:** Deployment error message mentioning "cron expression would run more than once per day."

### Pitfall 2: Cron Route Served from Cache
**What goes wrong:** The cron fires, Vercel calls the route, but Next.js serves a cached response — no DB write occurs.
**Why it happens:** App Router GET handlers can be statically optimized. Without opt-out, Next.js may cache the response.
**How to avoid:** Add `export const dynamic = 'force-dynamic'` at the top of the cron route file.
**Warning signs:** Cron shows 200 in Vercel logs but `live_snapshots` table receives no new rows.

### Pitfall 3: DB Module Mismatch in Cron Handler
**What goes wrong:** Cron handler imports `scripts/lib/db.ts` instead of `src/lib/db.ts` — the scripts version calls `sql.end()` and has different error handling.
**Why it happens:** There are two DB modules: one for scripts (CLI context) and one for the app (Next.js context). The app version uses `globalThis._sql` to survive hot reload and doesn't call `process.exit()`.
**How to avoid:** The cron route handler lives under `app/api/` — always import from `@/src/lib/db` (the app-layer module).
**Warning signs:** Connection pool exhaustion, "cannot use a closed connection" errors, or Next.js overlay errors.

### Pitfall 4: Missing ODDS_API_KEY in .env.example
**What goes wrong:** A new developer (or the pre-launch checklist) runs the app and `sync-odds` fails silently because `ODDS_API_KEY` is not documented.
**Why it happens:** `.env.example` currently only documents `DATABASE_URL`, `BALLDONTLIE_API_KEY`, and `DELAY_MS`. `ODDS_API_KEY` was added in Phase 8 but `.env.example` was not updated.
**How to avoid:** Update `.env.example` to include `ODDS_API_KEY=your_key_here` as part of this phase's pre-launch checklist step.
**Warning signs:** Odds columns empty in production despite odds data being expected.

### Pitfall 5: Cron Concurrency on 60s Interval
**What goes wrong:** The NBA CDN fetch takes longer than 60s (e.g., slow CDN), the first cron run is still in flight when the second fires, and two snapshot rows are written for the same poll window.
**Why it happens:** Vercel Cron can fire a second invocation while the first is still running.
**How to avoid:** The stateless poll writes an INSERT (append-only — already designed this way). Duplicate snapshots within the same minute are benign — `live_snapshots` is append-only and `/api/live` reads the latest row. No lock needed.
**Warning signs:** Not a problem given the current schema design, but worth noting.

### Pitfall 6: Backfill Must Precede compute-stats and generate-insights
**What goes wrong:** Running `compute-stats` against an empty `game_player_box_scores` table produces 0 rows in `player_stats_advanced`, and `generate-insights` finds nothing to work with.
**Why it happens:** The pre-launch sequence must be strictly ordered: backfill → compute-stats → generate-insights.
**How to avoid:** The pre-launch checklist tasks in the plan must be sequential with explicit dependency: do not run step N+1 until step N exits 0.
**Warning signs:** `rolling_team_stats` and `rolling_player_stats` tables are empty after compute-stats run.

### Pitfall 7: UTC vs PT in GitHub Actions Cron Schedules
**What goes wrong:** The post-game workflow fires too early (before games end) or too late.
**Why it happens:** GitHub Actions cron schedules are UTC. 2am PT (PDT) = 10:00 UTC. 2am PT (PST) = 10:00 UTC happens to be the same — PDT is UTC-7, PST is UTC-8.
**How to avoid:** Use `0 10 * * *` for the 2am PT target. This is 2am PDT (summer/fall) and 1am PST (winter/spring), but NBA games rarely run past midnight PT regardless.
**Warning signs:** Post-game workflow running while games are still in progress.

---

## Code Examples

### vercel.json — Full Configuration

```json
// Source: https://vercel.com/docs/cron-jobs (HIGH confidence)
{
  "crons": [
    {
      "path": "/api/cron/poll-live",
      "schedule": "* * * * *"
    }
  ]
}
```

### Cron Route Handler — Secured App Router Pattern

```typescript
// Source: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
// app/api/cron/poll-live/route.ts
import type { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const { runPollOnce } = await import('../../../lib/run-poll-once');
    const result = await runPollOnce();
    return Response.json({ ok: true, result });
  } catch (err) {
    // Fail silently — Vercel does not retry cron failures
    // Last good snapshot remains in DB; DATA_DELAYED path handles it
    console.error('[cron/poll-live] Error:', err);
    return Response.json({ ok: false, error: String(err) }, { status: 500 });
  }
}
```

### sync-schedule.yml — GitHub Actions Pattern

```yaml
# Source: modeled on .github/workflows/sync-odds.yml (existing, HIGH confidence)
name: Sync Schedule

on:
  schedule:
    - cron: '0 14 * * *'  # 6am PT (PDT = UTC-8, so 14:00 UTC)
  workflow_dispatch:

jobs:
  sync-schedule:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
      - run: npm ci
      - run: npm run sync-schedule
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          BALLDONTLIE_API_KEY: ${{ secrets.BALLDONTLIE_API_KEY }}
```

Note on 6am PT UTC offset: PDT = UTC-7, PST = UTC-8. 6am PT = 13:00 UTC (PDT) or 14:00 UTC (PST). Use `0 14 * * *` to be safe (runs at 6am PST / 7am PDT — acceptable tolerance).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Long-running Node.js process for live polling | Stateless serverless function invoked by platform cron | Vercel Cron GA (2023) | Eliminates always-on server cost; scales to zero between invocations |
| `vercel.json` with `routes` property | `vercel.json` with `crons` array | Vercel Cron v1 | Clean separation of routing config from scheduling config |
| Pages Router `pages/api/cron.ts` | App Router `app/api/cron/route.ts` | Next.js 13+ | Both work; App Router is current standard for new code |

**Deprecated/outdated:**
- `next-cron` (npm package): Not needed — Vercel Cron is platform-native and does not require any npm package.
- Long-running Vercel Functions: Fluid compute extends maxDuration to 300s on Hobby (5 min), but the 60s cron still needs Pro for per-minute cadence.

---

## Open Questions

1. **Import path from App Router to scripts/lib**
   - What we know: `app/api/cron/poll-live/route.ts` is under `app/`; the poll logic lives in `scripts/lib/`
   - What's unclear: Whether `import('@/scripts/lib/run-poll-once')` resolves correctly in the Next.js build, or whether `run-poll-once.ts` must be placed in `src/lib/` instead
   - Recommendation: Place `run-poll-once.ts` in `src/lib/` alongside other app-layer utilities. Scripts can import it from there (as `poll-live.ts` already imports from `src/lib/`).

2. **Vercel Plan Tier**
   - What we know: Pro plan is required for `* * * * *` (every minute) cron
   - What's unclear: Whether the project is currently on Hobby or Pro
   - Recommendation: Verify in Vercel dashboard before deploying `vercel.json`. If on Hobby, upgrading to Pro is required before this phase's cron work can be tested in production.

3. **BALLDONTLIE_API_KEY need in post-game workflow**
   - What we know: `finalize-games.ts` uses `scripts/lib/nba-live-client.ts` (NBA CDN, no BDL API key), and `compute-stats.ts` / `generate-insights.ts` are pure DB operations
   - What's unclear: Whether `finalize-games.ts` also calls BDL at all (it uses `finalizeGame` from `scripts/lib/finalize.ts`)
   - Recommendation: Inspect `finalize.ts` before writing the workflow to confirm which env vars are required for each step. Safe default: include `BALLDONTLIE_API_KEY` only for the finalize step.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (root) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

This phase is a deployment phase — no discrete v1 requirement IDs. Validation is smoke testing and live verification, not unit tests.

| Behavior | Test Type | Verification Method |
|----------|-----------|---------------------|
| Cron route returns 401 without auth header | Unit | Vitest: mock request without `Authorization` header, assert 401 |
| Cron route returns 200 with valid CRON_SECRET | Unit | Vitest: mock request with correct header, assert 200 |
| All 5 page routes return 200 in production | Smoke | Manual curl or browser check post-deploy |
| `/api/live` returns `NO_ACTIVE_GAME` when no game | Smoke | Manual API spot-check post-deploy |
| No fabricated data in any response | Smoke | Manual inspection: every value traces to DB |
| Vercel Cron fires and writes snapshot row | E2E/manual | Check `live_snapshots` table on next game night |
| GitHub Actions workflows run on schedule | E2E/manual | `workflow_dispatch` manual trigger + verify DB changes |

### Sampling Rate

- **Per task commit:** `npm test` (existing unit tests, fast)
- **Per wave merge:** `npm test`
- **Phase gate:** All smoke checks pass before marking phase complete

### Wave 0 Gaps

- [ ] `scripts/lib/__tests__/run-poll-once.test.ts` — unit test for the extracted single-run logic (cron route is hard to test in isolation without this)
- [ ] `app/api/cron/poll-live/__tests__/route.test.ts` — auth guard unit test for cron handler

---

## Sources

### Primary (HIGH confidence)
- [Vercel Cron Jobs official docs](https://vercel.com/docs/cron-jobs) — scheduling syntax, how crons work, cron expressions
- [Vercel Managing Cron Jobs](https://vercel.com/docs/cron-jobs/manage-cron-jobs) — `CRON_SECRET` pattern, securing cron routes, duration limits, no-retry behavior
- [Vercel Cron Usage and Pricing](https://vercel.com/docs/cron-jobs/usage-and-pricing) — Hobby (once/day) vs Pro (once/minute) plan limits
- [Vercel Function Max Duration](https://vercel.com/docs/functions/configuring-functions/duration) — `export const maxDuration`, Hobby default 300s (fluid compute enabled), `export const dynamic`
- `.github/workflows/sync-odds.yml` — existing workflow template in this repo (HIGH confidence, canonical pattern)
- `scripts/poll-live.ts` — existing poll logic to be extracted (HIGH confidence, direct code inspection)
- `package.json` scripts block — all npm run commands already defined (HIGH confidence, direct code inspection)
- `.env.example` — current documented env vars; `ODDS_API_KEY` is missing (HIGH confidence, direct code inspection)

### Secondary (MEDIUM confidence)
- [Next.js App Router Route Handlers with `force-dynamic`](https://nextjs.org/docs/app/building-your-application/routing/route-handlers) — required to prevent caching of cron routes

### Tertiary (LOW confidence)
None — all critical findings have official source backing.

---

## Metadata

**Confidence breakdown:**
- Vercel Cron configuration: HIGH — verified against official Vercel docs
- Plan tier requirement (Pro for 60s): HIGH — explicit table in usage-and-pricing docs
- GitHub Actions patterns: HIGH — existing `sync-odds.yml` is the authoritative template
- Extraction of `runPollOnce` from existing code: HIGH — code inspected directly
- Import path for cron handler: MEDIUM — standard Next.js `@/` alias but cross-directory import needs build verification

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (Vercel docs are stable; cron API has not changed since 2023)
