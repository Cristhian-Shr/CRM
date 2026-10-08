import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pg", "ws", "@neondatabase/serverless"],
};

export default nextConfig;
