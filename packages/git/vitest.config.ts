import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests drive real git processes; under a parallel `pnpm test` they can take seconds.
    testTimeout: 30_000,
  },
});
