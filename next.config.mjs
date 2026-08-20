import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { withBotId } from "botid/next/config";

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Keep production builds within small VPS/workspace memory limits.
  experimental: {
    cpus: 1,
    workerThreads: false,
    webpackBuildWorker: true,
    staticGenerationRetryCount: 1,
    staticGenerationMaxConcurrency: 1,
  },
  productionBrowserSourceMaps: false,
  // Emit .next/standalone: a self-contained server plus only the node_modules it
  // actually traced. Needed to run in a container (Cloud Run); Vercel ignores it,
  // so both targets keep working from the same build.
  output: "standalone",
  // Pin the workspace root to this project (a stray lockfile lives in the parent).
  outputFileTracingRoot: dirname(fileURLToPath(import.meta.url)),
  // The watermark font is read at runtime; force it into each function bundle that
  // composites images (Next won't trace a runtime-built path on its own).
  outputFileTracingIncludes: {
    // /api/media watermarks images on the fly (font for the text badge).
    "/api/media": ["./assets/watermark-font.ttf"],
    "/api/v1/images/generations": ["./assets/watermark-font.ttf"],
    "/api/v1/chat/completions": ["./assets/watermark-font.ttf"],
  },
  // Expose the OpenAI-style /v1/* paths, backed by the route handlers in app/api/v1/*.
  async rewrites() {
    return [{ source: "/v1/:path*", destination: "/api/v1/:path*" }];
  },
};

// withBotId sets up the proxy rewrites BotID needs to run its challenge.
export default withBotId(nextConfig);
