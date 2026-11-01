import { availableParallelism } from "node:os";
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
    globalSetup: ["test/support/global-setup.ts"],
    testTimeout: 30_000,
    // Every integration file starts the whole API on a database of its own: ~10 s of module evaluation each, more when
    // the machine is busy. A third of the cores keeps those starts from starving each other into hook timeouts, and
    // the hooks get room for a slow start (test/support/app.ts fails earlier, naming the step).
    maxWorkers: Math.max(2, Math.floor(availableParallelism() / 3)),
    hookTimeout: 180_000,
  },
});
