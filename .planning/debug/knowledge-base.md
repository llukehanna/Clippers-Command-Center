# GSD Debug Knowledge Base

Resolved debug sessions. Used by `gsd-debugger` to surface known-pattern hypotheses at the start of new investigations.

---

## github-actions-exit-code-9 — GitHub Actions workflows exit code 9 due to missing --env-file target
- **Date:** 2026-03-23
- **Error patterns:** exit code 9, Process completed with exit code 9, --env-file, .env.local, github actions, CI
- **Root cause:** npm scripts used `node --env-file=.env.local ...`. Node exits with code 9 (Invalid Argument) in ~16ms when the file specified in `--env-file` does not exist. .env.local is gitignored and absent in GitHub Actions runners. Total job time (26s) was npm ci install time plus the instant failure — not 26s of script execution.
- **Fix:** Replace `--env-file=.env.local` with `--env-file-if-exists=.env.local` in package.json scripts. Requires Node 20.6+ (20.19.0 for LTS backport). Env vars in CI are provided via workflow `env:` blocks and inherited by child processes automatically.
- **Files changed:** package.json
---

