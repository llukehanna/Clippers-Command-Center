# Technology Stack

**Analysis Date:** 2026-03-05

## Languages

**Primary:**
- TypeScript - All frontend and backend application code (Next.js App Router)
- SQL (PostgreSQL dialect) - Database schema and proof queries in insight system

**Secondary:**
- CSS - Tailwind utility classes + design system CSS variables

## Runtime

**Environment:**
- Node.js - Next.js server and API routes

**Package Manager:**
- Not yet determined (project is pre-implementation; no lockfile or package.json detected in source tree)
- Expected: npm or pnpm (standard for Next.js projects)

## Frameworks

**Core:**
- Next.js (App Router) - Full-stack framework; serves UI pages and all `/api/*` routes
- React - Component model for all dashboard UI

**UI Components:**
- shadcn/ui - Component library built on Radix primitives
- Tailwind CSS - Utility-first styling; design system tokens defined as CSS variables

**Charts:**
- Recharts - Data visualization for trend charts, rolling averages, player performance

**Icons:**
- Heroicons or Lucide (SVG only; emojis explicitly forbidden per design system)

**Testing:**
- Not yet specified; no test framework configuration detected

**Build/Dev:**
- Not yet specified; standard Next.js toolchain expected (next dev / next build)

## Key Dependencies

**Critical:**
- `next` - Application framework (App Router, API routes, server-side caching)
- `react` + `react-dom` - UI rendering
- `shadcn/ui` - Component primitives (built on Radix UI)
- `tailwindcss` - Styling
- `recharts` - Dashboard charts

**Infrastructure:**
- PostgreSQL client (e.g., `pg`, `postgres`, or `@neondatabase/serverless`) - Required for DB access; specific package TBD at implementation

## Configuration

**Environment:**
- Configuration via `.env` file (never committed); `.env.example` to be committed
- Required env vars include database connection string and external API keys (see INTEGRATIONS.md)
- Secrets must never be stored in the database

**Build:**
- `next.config.*` - Standard Next.js config (to be created)
- No tsconfig detected yet; standard `tsconfig.json` required for TypeScript

## Platform Requirements

**Development:**
- Node.js runtime
- PostgreSQL database accessible locally or via cloud provider

**Production:**
- **Hosting:** Vercel (recommended primary option for web + API routes)
- **Database:** Neon or Supabase Postgres (serverless PostgreSQL, free tier)
- **Scheduled Jobs:** GitHub Actions scheduled workflows (for all jobs except live polling)
- **Live Polling Worker:** Application-side scheduler or lightweight worker process (12-second cadence is too fast for GitHub Actions cron)

**Alternative Hosting:**
- Fly.io or Render (unified web + API + cron option; managed Postgres)

## PostgreSQL Extensions

- `pgcrypto` - Required; used for `gen_random_uuid()` in the `insights` table primary key

---

*Stack analysis: 2026-03-05*
