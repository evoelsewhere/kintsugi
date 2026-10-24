import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The release tests pack bundles and take several seconds on a slow CI runner.
    testTimeout: 60_000,
  },
});
