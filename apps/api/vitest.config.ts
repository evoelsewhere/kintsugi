import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// NestJS constructor injection needs decorator metadata (tsconfig emitDecoratorMetadata);
// Vite's oxc transform emits it when told to.
export default defineConfig({
  oxc: { decorator: { legacy: true, emitDecoratorMetadata: true } },
  // `#common/*` and `#modules/*` (package.json "imports") point at dist for Node; tests read the sources.
  resolve: {
    alias: [{ find: /^#(common|modules)\/(.*)\.js$/, replacement: `${fileURLToPath(new URL("./src", import.meta.url))}/$1/$2.ts` }],
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
