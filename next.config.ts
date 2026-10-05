import type { NextConfig } from "next";

/**
 * Edge TTLs for the Cloudflare Worker's shared cache (worker.ts,
 * src/lib/edge-cache.ts): one render per Cloudflare location per TTL instead
 * of one per request. Browsers ignore CDN-Cache-Control, and still get Next's
 * own Cache-Control. `stale-while-revalidate` = how long a stale copy may be
 * served while one background render refreshes it. Matched to how often the
 * data actually changes (pipelines: games finalize at night or at the final
 * buzzer, schedule daily, media every 15 min). Never listed: /api/live (sets
 * its own 2 s / 30 s), /api/cron/* (refused by the cache anyway).
 */
const edgeTtl = (fresh: number, stale: number) => [
  { key: "CDN-Cache-Control", value: `public, s-maxage=${fresh}, stale-while-revalidate=${stale}` },
];

const EDGE_TTLS: Array<[source: string, fresh: number, stale: number]> = [
  ["/home", 300, 600],
  ["/api/home", 300, 600],
  ["/schedule", 600, 1800],
  ["/api/schedule", 600, 1800],
  ["/players", 600, 3600],
  ["/players/:player_id", 600, 3600],
  ["/api/players", 600, 3600],
  ["/api/players/:player_id", 600, 3600],
  ["/history", 3600, 3600],
  ["/history/:game_id", 3600, 3600],
  ["/api/history/:path*", 3600, 3600],
  ["/news", 60, 300],
  ["/api/media", 60, 300],
  ["/api/insights", 30, 120],
];

const nextConfig: NextConfig = {
  async headers() {
    return EDGE_TTLS.map(([source, fresh, stale]) => ({ source, headers: edgeTtl(fresh, stale) }));
  },
  experimental: {
    // Keep visited pages in the client router cache briefly so switching back
    // to a tab is instant instead of a fresh server round-trip.
    staleTimes: { dynamic: 30, static: 180 },
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
