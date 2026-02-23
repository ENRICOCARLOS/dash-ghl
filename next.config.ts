import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  transpilePackages: ["geist"],
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
