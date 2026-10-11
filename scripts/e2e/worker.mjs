// Restarts only the worker of a running end-to-end environment (scripts/e2e/start.mjs), for
// example with the real runtime once an LLM provider is configured in the portal:
//
//   node scripts/e2e/worker.mjs [mock|pi]
//
// It reuses the e2e database and data directory; stop the previous worker process first.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const mode = process.argv[2] ?? "pi";
if (mode !== "mock" && mode !== "pi") throw new Error("usage: worker.mjs [mock|pi]");

const dotenv = {};
for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match) dotenv[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const url = new URL(dotenv.DATABASE_URL);
url.pathname = "/kintsugi_e2e";

const child = spawn(process.execPath, [join(root, "services/orchestrator/dist/main.js")], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    ...dotenv,
    DATABASE_URL: url.toString(),
    KINTSUGI_DATA_DIR: join(root, ".kintsugi/e2e/data"),
    KINTSUGI_GIT_POLL_INTERVAL: "30",
    KINTSUGI_RUNTIME_MODE: mode,
  },
});
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
