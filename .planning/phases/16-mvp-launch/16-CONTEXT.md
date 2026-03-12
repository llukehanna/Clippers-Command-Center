# Phase 16: MVP Launch - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Deploy the application to Vercel with Neon PostgreSQL, configure all scheduled automation (GitHub Actions + Vercel Cron), run the pre-launch data backfill, and verify the end-to-end workflow on real infrastructure.

Out of scope: New features, new UI, schema changes, reliability fixes (Phase 15).

</domain>

<decisions>
## Implementation Decisions

### Live polling infrastructure
- **Vercel Cron + stateless** — convert `poll-live.ts` to a stateless Vercel Cron Job (60s cadence)
- 60s polling is acceptable — NBA box scores update every ~30s, 60-90s data lag is fine for a fan dashboard
- **Drop the backoff state** — each cron run is independent; if NBA CDN is down, the run fails silently and the DB retains the last snapshot (DATA_DELAYED path handles it)
- **24/7 always-on** — cron fires unconditionally every 60s; if no game is live, it writes NO_ACTIVE_GAME and exits fast

### Scheduled jobs coverage
- `sync-odds` — already has a workflow (every 6h); no changes needed
- `sync-schedule` — new workflow, runs daily at 6am PT
- `finalize-games` → `compute-stats` → `generate-insights` — **one chained workflow**, runs nightly at 2am PT; if any step fails, later steps don't run
- `backfill` — NOT a recurring workflow; one-time pre-launch step

### Pre-launch data readiness
- **Backfill 2024-25 and 2025-26 seasons** before launch — trends, stats, and insights will be meaningful from day one
- Run as a **manual pre-launch checklist step**: backfill → compute-stats → generate-insights in sequence
- **Environment variables for production**: DATABASE_URL, BALLDONTLIE_API_KEY, ODDS_API_KEY — these three cover everything; configure in both Vercel (for app + cron) and GitHub Secrets (for Actions workflows)

### Smoke testing
- **Immediate post-deploy checks** (before any live game):
  - All 5 routes return 200: `/`, `/live`, `/schedule`, `/history`, player pages
  - API spot-check: `/api/home`, `/api/schedule`, `/api/players`, `/api/live` (expects `NO_ACTIVE_GAME`)
  - Verify no fabricated/mock data surfaces — everything shown traces to DB
- **Live pipeline verification**: manual test on the next Clippers game night — verify Vercel Cron fires, snapshot is written, dashboard updates, insights appear
- No DEPLOYMENT.md — deployment steps are tasks in the plan file

### Claude's Discretion
- Exact Vercel Cron configuration syntax (`vercel.json` vs `vercel.json` + route handler approach)
- Whether the stateless cron is a dedicated API route (`/api/cron/poll-live`) or reuses existing `/api/live` logic
- How to handle the `DELAY_MS` env var in production (may not be needed for cron approach)
- Specific GitHub Actions workflow file names and job names

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/poll-live.ts` + `scripts/lib/poll-live-logic.ts`: Core polling logic. The stateless cron conversion will extract the single-run fetch-and-write logic, discarding the while-loop and backoff state.
- `.github/workflows/sync-odds.yml`: Existing workflow — use as template for `sync-schedule.yml` and `post-game.yml`.
- All scripts (`finalize-games`, `compute-stats`, `generate-insights`, `sync-schedule`) already have npm script entries — workflows just call `npm run <script>`.

### Established Patterns
- GitHub Actions workflows use `DATABASE_URL` and `ODDS_API_KEY` from secrets (sync-odds.yml pattern)
- All scripts use `--env-file=.env.local` locally; in CI they use `env:` block in the workflow step
- `.env.example` documents the three required vars — update it to include `ODDS_API_KEY` if missing

### Integration Points
- `vercel.json` — needs a `crons` block added for the live polling cron job
- New API route needed: `app/api/cron/poll-live/route.ts` — the stateless cron handler
- `.github/workflows/` — two new workflow files: `sync-schedule.yml` and `post-game.yml`

</code_context>

<specifics>
## Specific Ideas

- The next Clippers games are scheduled from Mar 2026 onward — live pipeline verification can happen on the first game after deployment.
- The chained post-game workflow should run at 2am PT (10:00 UTC) — covers games ending by 1am PT.
- Vercel Cron requires the handler to respond within 60s; the stateless poll is a single NBA CDN fetch + DB write, well within limits.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 16-mvp-launch*
*Context gathered: 2026-03-11*
