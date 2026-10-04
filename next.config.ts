import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
