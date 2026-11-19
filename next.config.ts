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
  ["/schedule/:game_id", 300, 600],
  ["/api/schedule/:game_id", 300, 600],
  ["/schedule/:game_id/ics", 3600, 3600],
  ["/schedule.ics", 3600, 3600],
  ["/players", 600, 3600],
  ["/players/:player_id", 600, 3600],
  ["/api/players", 600, 3600],
  ["/api/players/:player_id", 600, 3600],
  ["/api/players/:player_id/career", 3600, 3600],
  ["/history", 3600, 3600],
  // A game page gains postgame insights at the final buzzer and again at the nightly run: 5 min fresh, then
  // served stale while one background render refreshes it (the response's own max-age is 24 h only once settled).
  ["/history/:game_id", 300, 3600],
  ["/api/history/:path*", 3600, 3600],
  ["/api/history/games/:game_id", 300, 3600],
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
