import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Tests drive real git processes and a real queue.
    testTimeout: 180_000,
    hookTimeout: 60_000,
  },
});
