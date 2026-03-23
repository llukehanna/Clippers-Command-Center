---
status: resolved
trigger: "Three GitHub Actions workflows (post-game, sync-odds, sync-schedule) always fail with exit code 9. A fourth workflow (poll-live-games) works fine."
created: 2026-03-23T00:00:00Z
updated: 2026-03-23T02:00:00Z
---

## Current Focus

hypothesis: CONFIRMED AND RESOLVED — Root cause was --env-file=.env.local. The "26 seconds" observation was total job duration (npm ci ~25s + instant node exit), not script runtime. There is no second root cause.
test: Exhaustively searched codebase for process.exit(9), tsx internals for exit-9 paths, and Node/tsx behavior under various failure modes.
expecting: Fix already applied and committed (38f6a02). Next CI run should succeed.
next_action: Archive and mark resolved.

## Symptoms

expected: All workflows run successfully on schedule
actual: post-game, sync-odds, sync-schedule all fail with "Process completed with exit code 9"
errors: "Process completed with exit code 9" on all three failing workflows. Each shows "1 error and 1 warning" in annotations.
reproduction: Triggered on schedule (or manually) — fails every time since creation
started: Has always failed since creation. poll-live-games workflow works correctly.

## Eliminated

- hypothesis: There is a second independent root cause inside the script causing exit code 9 after 26s of runtime
  evidence: No process.exit(9) exists anywhere in the codebase. All scripts exit with 1 on error. tsx watch-mode relay (the only tsx path that calls process.exit(os.constants.signals.SIGKILL) = process.exit(9)) is never invoked without --watch. The 26-second run measured total job time (npm ci ~25s + instant script exit), not script runtime. Confirmed locally: node --env-file=.env.nonexistent exits in 16ms with code 9; with npm ci overhead the total job duration would be ~25-26 seconds.

## Evidence

- timestamp: 2026-03-23T00:00:00Z
  checked: .github/workflows/poll-live.yml vs the three failing workflow files
  found: poll-live.yml only runs curl — no checkout, no npm ci, no npm scripts. The three failing workflows check out code, run npm ci, then invoke npm scripts (finalize-games, compute-stats, generate-insights, sync-odds, sync-schedule).
  implication: The failure must be in npm ci or in the scripts themselves.

- timestamp: 2026-03-23T00:00:00Z
  checked: package.json scripts for all five failing commands
  found: Every script was defined as node --env-file=.env.local node_modules/.bin/tsx scripts/<name>.ts
  implication: --env-file=.env.local causes Node to crash with exit code 9 when .env.local doesn't exist (as in CI).

- timestamp: 2026-03-23T00:00:00Z
  checked: Reproduced locally with node --env-file=.env.nonexistent -e "..."
  found: Node outputs "node: .env.nonexistent: not found" and exits with code 9 in 16ms
  implication: ROOT CAUSE CONFIRMED. This is exactly exit code 9.

- timestamp: 2026-03-23T02:00:00Z
  checked: "26 seconds" observation from checkpoint response
  found: node --env-file=.env.missing exits in 16ms. The 26-second total is npm ci (~25s on a cold runner with no npm cache) plus the instant exit. GitHub Actions UI shows total job duration, not per-step duration.
  implication: There is no second root cause. The 26-second total job time is explained by npm ci installation time.

- timestamp: 2026-03-23T02:00:00Z
  checked: Entire codebase for process.exit(9) - scripts/, src/, all .ts files
  found: No process.exit(9) calls exist anywhere. All error paths use process.exit(1). sync-odds uses process.exit(0) for non-fatal failures.
  implication: Exit code 9 can only come from Node's --env-file flag behavior, not application code.

- timestamp: 2026-03-23T02:00:00Z
  checked: tsx internals (cli.cjs) for all process.exit paths
  found: tsx has one path that calls process.exit(os.constants.signals.SIGKILL) = process.exit(9): the watch-mode signal relay (relaySignal handler on SIGINT/SIGTERM). This code path is only active when tsx is invoked with --watch. No workflow uses --watch.
  implication: tsx is not the source of exit code 9 in production.

- timestamp: 2026-03-23T02:00:00Z
  checked: --env-file-if-exists availability in Node 20.x
  found: --env-file-if-exists was added in Node 20.19.0 (released March 13, 2025). GitHub Actions node-version: '20' resolves to Node 20.20.1 as of March 2026 (well above 20.19.0).
  implication: The fix is compatible with the CI environment. --env-file-if-exists silently skips missing files and exits 0.

- timestamp: 2026-03-23T02:00:00Z
  checked: tsx child process spawning and env var propagation
  found: tsx spawns a child Node process using {env: {...process.env}} — all env vars from the parent are inherited. The --env-file-if-exists flag is consumed by the parent before tsx runs; env vars are loaded into process.env and automatically inherited by the tsx child. No flags are double-applied.
  implication: The fix works end-to-end: env vars set by GitHub Actions workflow env: blocks are properly available to the TypeScript scripts.

## Resolution

root_cause: All npm scripts in package.json used node --env-file=.env.local as a prefix. Node exits with code 9 (Invalid Argument / missing env file) in 16ms when the file specified in --env-file does not exist. In GitHub Actions, .env.local is gitignored and absent. The total job runtime of 26 seconds was npm ci (~25s) + instant 16ms node exit — not 26s of script execution. There is one root cause, not two.
fix: Replaced --env-file=.env.local with --env-file-if-exists=.env.local in all package.json scripts (commit 38f6a02). Node 20.6+ silently skips the env file load when the file is absent. In CI, env vars are provided via workflow env: blocks. In local dev, .env.local still loads when present.
verification: Confirmed locally that node --env-file-if-exists=.env.missing exits 0 and continues. Confirmed tsx child process inherits all parent env vars correctly. Confirmed Node 20.20.x (current CI version) supports --env-file-if-exists.
files_changed:
  - package.json
