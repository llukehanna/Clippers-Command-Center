// scripts/lib/bdl-client.ts
import type { BDLPaginatedResponse } from '../types/bdl.js';

const BDL_BASE = 'https://api.balldontlie.io/v1';
const BDL_API_KEY = process.env.BALLDONTLIE_API_KEY;

if (!BDL_API_KEY) {
  console.error('ERROR: BALLDONTLIE_API_KEY is not set.');
  console.error('Add BALLDONTLIE_API_KEY to .env.local and run: npm run backfill');
  process.exit(1);
}

// DELAY_MS: time to wait between API requests.
// Free tier (5 req/min) requires >= 12000ms.
// ALL-STAR tier (60 req/min) can use 1000ms.
// Override by setting DELAY_MS env var.
export const DELAY_MS = parseInt(process.env.DELAY_MS ?? '12000', 10);

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function bdlGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BDL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const res = await fetch(url.toString(), {
    headers: { Authorization: BDL_API_KEY! },
  });
  if (res.status === 429) throw new Error('RATE_LIMITED');
  if (!res.ok) throw new Error(`BDL ${res.status}: ${path} params=${JSON.stringify(params)}`);
  return res.json() as Promise<T>;
}

/**
 * Fetch all pages for a paginated BDL endpoint, collecting into a flat array.
 * Sleeps DELAY_MS between each paginated request.
 */
export async function fetchAll<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const results: T[] = [];
  let cursor: number | null = null;

  do {
    const p: Record<string, string> = {
      ...params,
      per_page: '100',
      ...(cursor !== null ? { cursor: String(cursor) } : {}),
    };
    const resp = await bdlGet<BDLPaginatedResponse<T>>(path, p);
    results.push(...resp.data);
    cursor = resp.meta.next_cursor;
    if (cursor !== null) await sleep(DELAY_MS);
  } while (cursor !== null);

  return results;
}

/**
 * Retry wrapper: attempts fn up to MAX_RETRIES times with exponential backoff.
 * Returns null if all attempts fail (caller must handle null and log/skip).
 */
const MAX_RETRIES = 3;

export async function withRetry<T>(fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const wait = Math.pow(2, attempt) * 1000;
      console.warn(
        `  Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${(err as Error).message}. Retrying in ${wait}ms...`
      );
      await sleep(wait);
    }
  }
  console.error(`  All ${MAX_RETRIES} retries failed — skipping this request.`);
  return null;
}
