// src/lib/espn/fetch.ts
// ESPN's public site API, fetched server-side for the game pages. Never
// throws: a timeout, network error, non-2xx or bad JSON is null, and the
// page hides the section. On Cloudflare the `cf` hint caches the upstream
// response at the edge for 15 minutes; Node ignores it.

export const ESPN_CACHE_TTL_SECONDS = 900;

export async function fetchEspnJson(url: string, timeoutMs = 4000): Promise<unknown | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: 'application/json' },
      cf: { cacheTtl: ESPN_CACHE_TTL_SECONDS, cacheEverything: true },
    } as RequestInit);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}
