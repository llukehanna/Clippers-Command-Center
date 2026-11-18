// src/lib/data/franchise-common.ts
// Small helpers shared by the franchise loaders (src/lib/data/franchise-*.ts).

import { json, type ApiResult } from './result';
import { buildMeta, buildError } from '@/src/lib/api-utils';
import { playerHref } from '@/src/lib/franchise/trade-tree';
import type { FranchisePersonRef } from '@/src/lib/ui/types';

/** BIGINT/NUMERIC arrive as strings from postgres.js; unknown stays null. */
export function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** TIMESTAMPTZ (Date or string) → ISO string; null stays null. */
export function isoTime(v: unknown): string | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

export function personRef(person_key: string, name: string | null, player_id: string | number | null): FranchisePersonRef {
  const id = player_id == null ? null : String(player_id);
  return { person_key, name: name ?? person_key, player_id: id, href: playerHref(id) };
}

/** 200 with the meta envelope and a public cache header of `ttl` seconds. */
export function ok<T extends object>(body: T, ttl: number): ApiResult {
  return json({ meta: buildMeta('db', ttl), ...body }, { headers: { 'Cache-Control': `public, max-age=${ttl}` } });
}

export function badRequest(message: string): ApiResult {
  return json(buildError('BAD_REQUEST', message), { status: 400 });
}

export function internalError(route: string, err: unknown): ApiResult {
  console.error(`[GET ${route}]`, err);
  return json(buildError('INTERNAL_ERROR', 'Unexpected server error'), { status: 500 });
}
