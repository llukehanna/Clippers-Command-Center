import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Keep visited pages in the client router cache briefly so switching back
    // to a tab is instant instead of a fresh server round-trip.
    staleTimes: { dynamic: 30, static: 180 },
  },
  images: {
    // Player headshots from the NBA's public CDN (keyed by nba_player_id).
    remotePatterns: [
      { protocol: "https", hostname: "cdn.nba.com", pathname: "/headshots/**" },
    ],
  },
};

export default nextConfig;
