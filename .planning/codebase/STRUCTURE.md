# Codebase Structure

**Analysis Date:** 2026-03-05

## Current State

The project is in the **planning and design phase**. Application source code has not been scaffolded yet. All current files are planning artifacts, documentation, design system specs, and the GSD tooling framework that manages the project. The structure below reflects both (a) what exists now and (b) the prescribed target structure derived from the architecture and API spec.

## Existing Directory Layout

```
CCC/                                  # Project root
├── Docs/                             # Architecture and planning documents
│   ├── ARCHITECTURE.md               # System architecture spec
│   ├── API_SPEC.md                   # API endpoint contracts (all routes)
│   ├── DB_SCHEMA.sql                 # PostgreSQL schema (authoritative)
│   ├── DATA_DICTIONARY.md            # Field definitions
│   ├── INGESTION_PLAN.md             # Job specs and scheduling
│   ├── MVP_CHECKLIST.md              # Ship-ready checklist
│   ├── PROJECT.md                    # Product definition and principles
│   ├── REQUIREMENTS.md               # Functional requirements
│   ├── ROADMAP.md                    # 16-phase build sequence
│   └── WIREFRAMES.md                 # Screen layout specs
├── design-system/
│   └── clippers-command-center/
│       ├── MASTER.md                 # Global design tokens and component specs
│       └── pages/
│           └── live.md               # Live game page design overrides
├── .planning/
│   └── codebase/                     # GSD codebase map documents (this dir)
└── .claude/                          # GSD tooling (do not modify manually)
    ├── agents/                       # Sub-agent prompt files
    ├── commands/gsd/                 # GSD slash command definitions
    ├── get-shit-done/
    │   ├── bin/                      # gsd-tools.cjs + lib/*.cjs (runtime)
    │   ├── references/               # GSD reference docs (patterns, config)
    │   ├── templates/                # Planning document templates
    │   └── workflows/                # Workflow definition files
    ├── skills/                       # Skill modules (ui-ux-pro-max)
    ├── gsd-file-manifest.json        # GSD file registry
    ├── settings.json                 # GSD settings
    └── package.json
```

## Target Application Layout (to be scaffolded)

Based on `Docs/API_SPEC.md` (target: `src/app/api/.../route.ts`) and Next.js App Router conventions:

```
CCC/
├── src/
│   ├── app/
│   │   ├── page.tsx                  # Root route (redirects based on game state)
│   │   ├── layout.tsx                # Root layout (fonts, global CSS)
│   │   ├── live/
│   │   │   └── page.tsx              # Live Game Dashboard
│   │   ├── home/
│   │   │   └── page.tsx              # Between-Games Dashboard
│   │   ├── players/
│   │   │   ├── page.tsx              # Player list / roster
│   │   │   └── [player_id]/
│   │   │       └── page.tsx          # Player Trends page
│   │   ├── schedule/
│   │   │   └── page.tsx              # Schedule page
│   │   ├── history/
│   │   │   ├── page.tsx              # Historical Explorer (season list)
│   │   │   └── [game_id]/
│   │   │       └── page.tsx          # Historical Game Detail
│   │   └── api/
│   │       ├── live/
│   │       │   └── route.ts          # GET /api/live
│   │       ├── home/
│   │       │   └── route.ts          # GET /api/home
│   │       ├── players/
│   │       │   ├── route.ts          # GET /api/players
│   │       │   └── [player_id]/
│   │       │       └── route.ts      # GET /api/players/{player_id}
│   │       ├── schedule/
│   │       │   └── route.ts          # GET /api/schedule
│   │       ├── history/
│   │       │   ├── seasons/
│   │       │   │   └── route.ts      # GET /api/history/seasons
│   │       │   └── games/
│   │       │       ├── route.ts      # GET /api/history/games
│   │       │       └── [game_id]/
│   │       │           └── route.ts  # GET /api/history/games/{game_id}
│   │       ├── insights/
│   │       │   └── route.ts          # GET /api/insights
│   │       └── odds/
│   │           └── route.ts          # GET /api/odds
│   ├── components/                   # Reusable UI components
│   │   ├── dashboard/                # Dashboard-specific composites
│   │   ├── ui/                       # shadcn/ui primitives (auto-generated)
│   │   └── charts/                   # Recharts wrappers
│   ├── lib/
│   │   ├── db/                       # PostgreSQL client + query helpers
│   │   ├── insights/                 # Insight generation logic (batch + live)
│   │   ├── ingestion/                # Ingestion job implementations
│   │   │   ├── sync-reference.ts
│   │   │   ├── sync-schedule.ts
│   │   │   ├── poll-live.ts
│   │   │   ├── finalize-games.ts
│   │   │   ├── sync-odds.ts
│   │   │   ├── compute-advanced.ts
│   │   │   ├── compute-rolling.ts
│   │   │   ├── generate-insights.ts
│   │   │   └── backfill.ts
│   │   └── types/                    # Shared TypeScript types
│   └── styles/
│       └── globals.css               # Tailwind + CSS variables (design tokens)
├── .github/
│   └── workflows/                    # GitHub Actions scheduled jobs
├── Docs/                             # (existing — planning artifacts)
├── design-system/                    # (existing — design specs)
└── .planning/                        # (existing — GSD planning docs)
```

## Directory Purposes

**`Docs/`:**
- Purpose: Authoritative planning and specification documents; source of truth for architecture, schema, API contracts, and build sequence
- Key files: `DB_SCHEMA.sql` (run this to create schema), `API_SPEC.md` (API contracts), `ARCHITECTURE.md` (system design), `INGESTION_PLAN.md` (job specs)
- Generated: No — hand-authored
- Committed: Yes

**`design-system/clippers-command-center/`:**
- Purpose: Design token spec and per-page component rules; consulted before building any UI
- Key files: `MASTER.md` (global tokens, colors, typography), `pages/live.md` (live page overrides)
- Pattern: Page-level files override `MASTER.md`; always check `pages/[page].md` first

**`src/app/api/`:**
- Purpose: Next.js App Router API route handlers; all MVP endpoints are read-only GET routes
- Pattern: One `route.ts` per endpoint; each file exports a `GET` handler
- Naming: `src/app/api/{resource}/route.ts` or `src/app/api/{resource}/[param]/route.ts`

**`src/lib/db/`:**
- Purpose: Database connection pool and typed query helpers; all DB access goes through this layer
- Pattern: Never write raw SQL in API routes; use helpers from `src/lib/db/`

**`src/lib/ingestion/`:**
- Purpose: One file per ingestion job; jobs are invoked by GitHub Actions workflows or in-app scheduler
- Naming: kebab-case matching job name from `Docs/INGESTION_PLAN.md`

**`src/lib/insights/`:**
- Purpose: Insight generation logic shared between batch job and live on-demand generation in `/api/live`
- Constraint: Every function that generates an insight must also produce a `proof_sql` + `proof_result`

**`.github/workflows/`:**
- Purpose: Scheduled GitHub Actions for slow-cadence jobs (reference sync, schedule sync, odds sync, finalize games, advanced stats, rolling windows, batch insights)
- Note: `poll_live_clippers_game` (12-second cadence) may need app-side runner instead

**`.planning/codebase/`:**
- Purpose: GSD codebase analysis documents consumed by planning and execution agents
- Generated: Yes (by GSD map-codebase command)
- Committed: Yes

## Key File Locations

**Schema (authoritative):**
- `Docs/DB_SCHEMA.sql` — run to create all tables; update this file when schema changes

**API Contracts:**
- `Docs/API_SPEC.md` — JSON shapes and rules for all 10 endpoints

**Design Tokens:**
- `design-system/clippers-command-center/MASTER.md` — colors, typography, spacing, shadows
- `design-system/clippers-command-center/pages/live.md` — live page layout overrides

**Ingestion Job Specs:**
- `Docs/INGESTION_PLAN.md` — full specification for all 10 jobs including failure handling

## Naming Conventions

**Files:**
- API route handlers: `route.ts` (Next.js convention)
- Ingestion jobs: `kebab-case-job-name.ts` matching job name in `Docs/INGESTION_PLAN.md`
- Page components: `page.tsx` (Next.js App Router convention)
- UI components: `PascalCase.tsx`

**Directories:**
- API segments: lowercase, matching URL path segment (e.g., `live/`, `history/`, `players/`)
- Dynamic segments: `[param_name]` matching the API spec parameter name (e.g., `[player_id]`, `[game_id]`)
- Library modules: lowercase kebab-case (e.g., `sync-reference.ts`)

**Database:**
- Table names: `snake_case` plural (e.g., `game_player_box_scores`, `rolling_team_stats`)
- Primary keys: `{table_singular}_id` pattern (e.g., `game_id`, `player_id`, `snapshot_id`)
- Provider IDs: `nba_{entity}_id` prefix (e.g., `nba_game_id`, `nba_player_id`, `nba_team_id`)

**API fields:**
- All JSON keys: `snake_case`
- All timestamps: ISO 8601 UTC strings
- Team abbreviation: `LAC` (Clippers default across all endpoints)

## Where to Add New Code

**New API endpoint:**
- Create `src/app/api/{resource}/route.ts`
- Export `GET` handler
- Include `meta` object in response (`generated_at`, `source`, `stale`, `stale_reason`, `ttl_seconds`)
- Use precomputed tables from DB; do not compute aggregates inline

**New ingestion job:**
- Add job implementation to `src/lib/ingestion/{job-name}.ts`
- Add GitHub Actions workflow in `.github/workflows/`
- Add `last_success_at` key to `app_kv` on completion
- Ensure idempotency (upsert, not insert)

**New UI page:**
- Check `design-system/clippers-command-center/pages/` for a page-specific spec file first
- Fall back to `design-system/clippers-command-center/MASTER.md` for tokens
- Create page at `src/app/{route}/page.tsx`
- Fetch from the dedicated page-shaped API endpoint for that view

**New insight category:**
- Add rule logic to `src/lib/insights/`
- Every new insight type must produce `proof_sql`, `proof_params`, `proof_result`
- Register category string in DB `insights.category` column (currently open TEXT)

**New DB table or column:**
- Update `Docs/DB_SCHEMA.sql` first
- Add migration script
- Update `Docs/DATA_DICTIONARY.md`

## Special Directories

**`.claude/`:**
- Purpose: GSD framework tooling — agent prompts, command definitions, workflows, templates
- Generated: Yes (installed by GSD)
- Committed: Yes
- Do not manually edit files here unless modifying GSD configuration intentionally

**`.planning/`:**
- Purpose: GSD planning state — roadmap, milestones, phases, codebase analysis
- Generated: Yes (managed by GSD commands)
- Committed: Yes

---

*Structure analysis: 2026-03-05*
