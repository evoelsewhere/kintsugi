// Development server: recompiles on change (tsc --watch) and restarts the API when the
// build output changes (node --watch). Runs from the repo root so the API reads the
// root .env, like `node apps/api/dist/main.js`. Used by `pnpm dev` / `make dev`.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const apiDir = resolve(import.meta.dirname, "..");
const repoRoot = resolve(apiDir, "../..");
const tsc = resolve(dirname(createRequire(import.meta.url).resolve("typescript/package.json")), "bin/tsc");

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
const build = spawn(process.execPath, [tsc, "-p", "tsconfig.json"], { cwd: apiDir, stdio: "inherit" });
build.on("exit", (code) => {
  if (code !== 0) {
    process.exitCode = code ?? 1;
    return;
  }
  run([tsc, "-p", "tsconfig.json", "--watch", "--preserveWatchOutput"], apiDir);
  run(["--watch-path", resolve(apiDir, "dist"), resolve(apiDir, "dist/main.js")], repoRoot);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    for (const child of children) child.kill();
    process.exit();
  });
}
