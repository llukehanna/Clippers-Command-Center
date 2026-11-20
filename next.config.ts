import type { NextConfig } from "next";

/**
 * Edge TTLs for the Cloudflare Worker's shared cache (worker.ts,
 * src/lib/edge-cache.ts): a hit is answered from the Cache API without running
 * Next.js, so a prerendered page isn't re-read and re-parsed from its (often
 * multi-MB) OpenNext cache entry on every request. Browsers ignore
 * CDN-Cache-Control, and still get Next's own Cache-Control.
 * `stale-while-revalidate` = how long a stale copy may be served while one
 * background render refreshes it.
 *
 * Applies to prerendered pages too: OpenNext's routing layer adds these
 * headers() to responses its cache interception serves straight from the
 * prerender cache (@opennextjs/aws core/routingHandler.js), the same as to
 * rendered ones.
 *
 * Every page is prerendered at build time and only a deploy changes it, and
 * the edge cache is keyed by the Worker version (a deploy starts it empty), so
 * pages get a full day. Never listed: /api/live (sets its own 2 s / 30 s),
 * /api/media (below: updated every 15 min at runtime), /api/cron/* (refused by
 * the cache anyway), /live (live pipeline), and every other /api/* (the Worker
 * 404s it before the cache).
 */
const edgeTtl = (fresh: number, stale: number) => [
  { key: "CDN-Cache-Control", value: `public, s-maxage=${fresh}, stale-while-revalidate=${stale}` },
];

const DAY = 86400;

const EDGE_TTLS: Array<[source: string, fresh: number, stale: number]> = [
  ["/home", DAY, DAY],
  ["/schedule", DAY, DAY],
  ["/schedule/:game_id", DAY, DAY],
  ["/schedule/:game_id/ics", DAY, DAY],
  ["/schedule.ics", DAY, DAY],
  ["/players", DAY, DAY],
  ["/players/:player_id", DAY, DAY],
  ["/players/:player_id/season/:path*", DAY, DAY],
  ["/players/table", DAY, DAY],
  ["/players/all-time", DAY, DAY],
  ["/players/traded/:path*", DAY, DAY],
  ["/history", DAY, DAY],
  ["/history/:game_id", DAY, DAY],
  ["/history/season/:path*", DAY, DAY],
  // Rendered on demand (not prerendered); a shared link's card barely changes once the game is final.
  ["/history/:game_id/opengraph-image", DAY, DAY],
  ["/franchise", DAY, DAY],
  ["/franchise/:path*", DAY, DAY],
  // The news pages are static shells; their items load live from /api/media.
  ["/news", DAY, DAY],
  ["/news/:path*", DAY, DAY],
  // sync-media runs hourly; each render costs ~0.5 s CPU and a query, so keep it 15 min.
  ["/api/media", 900, 3600],
];

const nextConfig: NextConfig = {
  // The commit SHA in CI, so a data-only rebuild of the same commit writes
  // identical paths and Wrangler re-uploads only the files whose bytes changed.
  // null (local builds) lets Next generate a random id.
  generateBuildId: async () => process.env.GITHUB_SHA ?? null,
  async headers() {
    return EDGE_TTLS.map(([source, fresh, stale]) => ({ source, headers: edgeTtl(fresh, stale) }));
  },
  experimental: {
    // Keep visited pages in the client router cache briefly so switching back
    // to a tab is instant instead of a fresh server round-trip.
    // 60 s: data changes only when the pipeline syncs, and the Live page polls
    // on its own. Also how long an intent prefetch (IntentPrefetch) stays usable.
    staleTimes: { dynamic: 60, static: 300 },
  },
  images: {
    // Serve images as-is. Headshots come pre-sized from the NBA's CDN and team
    // logos are small PNGs, so Vercel's optimizer adds little — and the CDN's
    // 12h max-age meant every viewed headshot re-billed a transformation twice
    // a day, blowing through the Hobby plan's 5,000/month.
    unoptimized: true,
  },
};

export default nextConfig;
