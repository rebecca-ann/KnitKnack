import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "**.ravelrycache.com" }],
  },
};

export default nextConfig;
