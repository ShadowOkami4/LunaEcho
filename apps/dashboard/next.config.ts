import type { NextConfig } from "next";

const config: NextConfig = {
  // Workspace packages ship TypeScript sources during development.
  transpilePackages: ["@lunaecho/core", "@lunaecho/db", "@lunaecho/modules"],
  // Native modules stay outside the bundle; @napi-rs/canvas draws the welcome card previews.
  serverExternalPackages: ["pg", "pino", "@electric-sql/pglite", "@napi-rs/canvas"],
  experimental: {
    // Welcome card backgrounds may be up to 5 MB, plus multipart overhead.
    serverActions: { bodySizeLimit: "6mb" },
  },
  poweredByHeader: false,
  // Next would otherwise write AGENTS.md and CLAUDE.md into the app on every dev start.
  agentRules: false,
  images: {
    remotePatterns: [{ hostname: "cdn.discordapp.com", protocol: "https" }],
  },
  // `next dev` runs on webpack, because the workspace sources import each other with `.js`
  // endings (NodeNext) and only webpack can map those to the `.ts` files. Production builds use
  // Turbopack with the compiled packages and do not need this.
  webpack: (webpackConfig: { resolve: { extensionAlias?: Record<string, string[]> } }) => {
    webpackConfig.resolve.extensionAlias = { ".js": [".ts", ".tsx", ".js"] };
    return webpackConfig;
  },
};

export default config;
