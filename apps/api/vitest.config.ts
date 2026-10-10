import { defineConfig } from "vitest/config";

// NestJS constructor injection needs decorator metadata (tsconfig emitDecoratorMetadata);
// Vite's oxc transform emits it when told to.
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
