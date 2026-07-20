import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the workspace root to this project (a stray lockfile lives in the parent).
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // Expose the OpenAI-style /v1/* paths, backed by the route handlers in app/api/v1/*.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: "/api/v1/:path*" }];
  },
};

export default nextConfig;
