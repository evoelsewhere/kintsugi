import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Some tests spawn client processes and take several seconds on a slow CI runner.
    testTimeout: 60_000,
  },
});
