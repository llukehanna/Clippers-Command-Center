// src/lib/db.ts
// Postgres access for the Next.js app, on two runtimes:
//
// - Cloudflare Workers (production, via OpenNext): a database socket belongs
//   to the request that opened it — reusing one across requests fails — so
//   each request gets its own client, connected through a Hyperdrive binding
//   (pooled connections next to Neon; see wrangler.jsonc).
// - Node (`next dev`, `next start`, tests): one pooled client from
//   DATABASE_URL, kept on globalThis to survive hot reload.
//
// Unlike scripts/lib/db.ts, a missing database throws on first query instead
// of calling process.exit(), so Next.js can surface the error.

import postgres from 'postgres';

type Sql = ReturnType<typeof postgres>;

/**
 * Which Hyperdrive binding to use on Workers. `HYPERDRIVE` caches read
 * queries for 60 s (the same freshness the pages had with their 60 s data
 * cache on Vercel); `HYPERDRIVE_LIVE` never caches, for the live endpoints.
 */
type Binding = 'HYPERDRIVE' | 'HYPERDRIVE_LIVE';

interface Hyperdrive {
  connectionString: string;
}

/** The per-request context OpenNext stores under this symbol (an AsyncLocalStorage getter). */
interface CloudflareContext {
  env: Partial<Record<Binding, Hyperdrive>>;
}

const CLOUDFLARE_CONTEXT = Symbol.for('__cloudflare-context__');

function cloudflareContext(): CloudflareContext | undefined {
  return (globalThis as Record<symbol, CloudflareContext | undefined>)[CLOUDFLARE_CONTEXT];
}

const perRequest = new WeakMap<CloudflareContext, Map<Binding, Sql>>();

function workerClient(ctx: CloudflareContext, binding: Binding): Sql | null {
  const hyperdrive = ctx.env[binding] ?? ctx.env.HYPERDRIVE;
  if (!hyperdrive) return null;
  let clients = perRequest.get(ctx);
  if (!clients) perRequest.set(ctx, (clients = new Map()));
  let client = clients.get(binding);
  if (!client) {
    client = postgres(hyperdrive.connectionString, {
      max: 5, // parallel queries within one page render
      idle_timeout: 5,
      connect_timeout: 10,
    });
    clients.set(binding, client);
  }
  return client;
}

/**
 * Without DATABASE_URL (e.g. builds that collect page data without a
 * database) importing this module must not throw. Instead every use of `sql`
 * throws the same clear error the first time something actually queries.
 */
function missingDatabase(): never {
  throw new Error('DATABASE_URL is not set. Configure .env.local and restart the dev server.');
}

// Survive Next.js hot reload in development: store the singleton on globalThis
// so repeated module evaluation re-uses the same connection pool.
const globalForDb = globalThis as unknown as { _sql: Sql | undefined };

function nodeClient(): Sql {
  if (globalForDb._sql) return globalForDb._sql;
  const url = process.env.DATABASE_URL;
  if (!url) missingDatabase();
  globalForDb._sql = postgres(url, {
    max: 10,
    idle_timeout: 30,
    connect_timeout: 10,
  });
  return globalForDb._sql;
}

/** The client for the current request (Workers) or the process (Node). */
export function getSql(binding: Binding = 'HYPERDRIVE'): Sql {
  const ctx = cloudflareContext();
  return (ctx && workerClient(ctx, binding)) || nodeClient();
}

/**
 * A stand-in for the current client, so call sites keep writing sql`...` and
 * sql.unsafe(...). Each use resolves the client of the request it runs in.
 */
function lazySql(binding: Binding): Sql {
  return new Proxy(function () {} as unknown as Sql, {
    apply: (_target, _this, args) =>
      Reflect.apply(getSql(binding) as unknown as (...a: unknown[]) => unknown, undefined, args),
    get: (_target, prop) => {
      const client = getSql(binding);
      const value = Reflect.get(client, prop, client);
      return typeof value === 'function' ? value.bind(client) : value;
    },
  });
}

/** Read queries for pages and data APIs (cached up to 60 s by Hyperdrive on Workers). */
export const sql: Sql = lazySql('HYPERDRIVE');

/** Never-cached queries, for live game state and the poll-live writer. */
export const liveSql: Sql = lazySql('HYPERDRIVE_LIVE');

/**
 * Internal nba_team_id for the LA Clippers as stored in the teams table.
 * The DB uses sequential IDs (1-30), not real NBA API IDs. LAC = 13.
 */
export const LAC_NBA_TEAM_ID = 13;
