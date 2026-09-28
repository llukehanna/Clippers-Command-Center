import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Player headshots from the NBA's public CDN (keyed by nba_player_id).
    remotePatterns: [
      { protocol: "https", hostname: "cdn.nba.com", pathname: "/headshots/**" },
    ],
  },
};

export default nextConfig;
