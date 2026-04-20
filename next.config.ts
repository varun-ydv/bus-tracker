import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [],
  outputFileTracingIncludes: {
    "/*": [
      path.join(__dirname, "data", "act-routes.json"),
      path.join(__dirname, "data", "act-timetables.json"),
    ],
  },
};

export default nextConfig;
