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

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

async function bdlGet<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BDL_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.append(k, v));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: BDL_API_KEY! },
      signal: controller.signal,
    });
    if (res.status === 429) throw new Error('RATE_LIMITED');
    if (!res.ok) throw new Error(`BDL ${res.status}: ${path} params=${JSON.stringify(params)}`);
    return res.json() as Promise<T>;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`TIMEOUT after ${REQUEST_TIMEOUT_MS}ms: ${path}`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fetch all pages for a paginated BDL endpoint, collecting into a flat array.
 * Retries each page independently (preserves progress on rate limits).
 * Logs per-page progress. Sleeps DELAY_MS between pages.
 */
export async function fetchAll<T>(
  path: string,
  params: Record<string, string> = {}
): Promise<T[]> {
  const results: T[] = [];
  let cursor: number | null = null;
  let page = 0;

  do {
    page++;
    const p: Record<string, string> = {
      ...params,
      per_page: '100',
      ...(cursor !== null ? { cursor: String(cursor) } : {}),
    };

    let resp: BDLPaginatedResponse<T> | null = null;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        resp = await bdlGet<BDLPaginatedResponse<T>>(path, p);
        break;
      } catch (err) {
        const msg = (err as Error).message;
        const wait = msg.startsWith('RATE_LIMITED') ? DELAY_MS : Math.pow(2, attempt) * 1000;
        console.warn(`  [${path}] page ${page} attempt ${attempt + 1}/${MAX_RETRIES} failed: ${msg}. Retrying in ${wait}ms...`);
        await sleep(wait);
      }
    }

    if (!resp) throw new Error(`${path}: page ${page} failed after ${MAX_RETRIES} retries`);

    results.push(...resp.data);
    cursor = resp.meta?.next_cursor ?? null;
    console.log(`  [${path}] page ${page}: +${resp.data.length} (${results.length} total)${cursor !== null ? ', fetching next...' : ', done'}`);
    if (cursor !== null) await sleep(DELAY_MS);
  } while (cursor !== null);

  return results;
}

/**
 * Retry wrapper for one-shot requests (non-paginated).
 * Do NOT wrap fetchAll with this — fetchAll retries per-page internally.
 */
export async function withRetry<T>(fn: () => Promise<T>): Promise<T | null> {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = (err as Error).message;
      const wait = msg.startsWith('RATE_LIMITED') ? DELAY_MS : Math.pow(2, attempt) * 1000;
      console.warn(`  Attempt ${attempt + 1}/${MAX_RETRIES} failed: ${msg}. Retrying in ${wait}ms...`);
      await sleep(wait);
    }
  }
  console.error(`  All ${MAX_RETRIES} retries failed — skipping this request.`);
  return null;
}
