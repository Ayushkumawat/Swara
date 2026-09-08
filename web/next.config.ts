import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native addon — has to be required at runtime by Node, not bundled.
  serverExternalPackages: ["better-sqlite3"],
};

export default nextConfig;
