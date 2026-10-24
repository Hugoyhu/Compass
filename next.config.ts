import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
    // Transcript PDFs are capped at 4 MB in the upload action; leave room for multipart overhead.
    serverActions: { bodySizeLimit: "5mb" },
  },
  // The repository reads catalog JSON at request time; make sure deployments bundle it.
  outputFileTracingIncludes: {
    "/**": ["./data/catalog/**/*.json"],
  },
  cacheComponents: true,
  partialPrefetching: true,
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
