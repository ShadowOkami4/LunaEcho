import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Every database test file boots its own PGlite and runs all migrations; in parallel that is slow.
    hookTimeout: 60_000,
    include: ["test/**/*.test.ts"],
    mockReset: true,
    restoreMocks: true,
  },
});
