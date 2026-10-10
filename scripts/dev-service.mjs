// Development runner for a Node service (apps/api, services/orchestrator): recompiles on
// change (tsc --watch) and restarts the service when the build output changes
// (node --watch). Run it from the package directory (its "dev" script); the service
// runs from the repo root so it reads the root .env, like `node apps/api/dist/main.js`.
// Used by `pnpm dev` / `make dev`.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";

const packageDir = process.cwd();
const repoRoot = resolve(import.meta.dirname, "..");
const tsc = resolve(dirname(createRequire(join(packageDir, "package.json")).resolve("typescript/package.json")), "bin/tsc");

const children = [];
const run = (args, cwd) => {
  const child = spawn(process.execPath, args, { cwd, stdio: "inherit" });
  children.push(child);
  child.on("exit", (code) => {
    // One side died: stop the other so the dev task fails visibly instead of half-running.
    for (const other of children) if (other !== child) other.kill();
    process.exitCode = code ?? 1;
  });
  return child;
};

// Initial build first, so node starts on a complete dist/.
const build = spawn(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: packageDir, stdio: "inherit" });
build.on("exit", (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  run([tsc, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], packageDir);
  run(["--watch-path", resolve(packageDir, "dist"), resolve(packageDir, "dist/main.js")], repoRoot);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill();
    process.exit();
  });
}
