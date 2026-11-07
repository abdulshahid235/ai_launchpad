import type { NextConfig } from "next";

// [HNI-INFRA-06] Standalone output is what the runtime image copies.
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
};

export default nextConfig;
