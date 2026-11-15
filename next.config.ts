import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Every page here is private and per-user, so nothing is statically cached or prerendered.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
