import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts", "builtin/plugins/*/tests/**/*.test.ts"],
    // The plugin tests read every file of the built-in plugins: slow when the whole monorepo tests at once.
    testTimeout: 30_000,
  },
});
