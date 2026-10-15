import type { NextConfig } from "next";

/**
 * Two builds from one codebase:
 *  - Full (default): talks to the Python API, proxied under /api so cookies stay first-party.
 *  - Lite (KOLD_STATIC=1): a static site for GitHub Pages; everything runs on the user's device.
 */
const STATIC = process.env.KOLD_STATIC === "1";
const BASE_PATH = process.env.KOLD_BASE_PATH ?? (STATIC ? "/kold/app" : "");
// The Python API (FastAPI) runs on :8000.
const API_ORIGIN = process.env.KOLD_API_ORIGIN ?? "http://127.0.0.1:8000";

const nextConfig: NextConfig = {
  cacheComponents: !STATIC,
  partialPrefetching: !STATIC,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  env: {
    NEXT_PUBLIC_KOLD_MODE: STATIC ? "lite" : "full",
    NEXT_PUBLIC_BASE_PATH: BASE_PATH,
  },
  ...(STATIC
    ? {
        output: "export",
        basePath: BASE_PATH,
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {
        experimental: {
          // Drafting with the local model (resume tailoring + email) can take a minute on a laptop GPU.
          proxyTimeout: 300_000,
        },
        async rewrites() {
          return [{ source: "/api/:path*", destination: `${API_ORIGIN}/api/:path*` }];
        },
        async headers() {
          return [
            {
              source: "/sw.js",
              headers: [
                { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
                { key: "Content-Type", value: "application/javascript; charset=utf-8" },
              ],
            },
          ];
        },
      }),
};

export default nextConfig;
