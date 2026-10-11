// Restarts one service of a running end-to-end environment (scripts/e2e/start.mjs) without
// resetting it, for example after a rebuild or to switch the worker to the real runtime once an
// LLM provider is configured in the portal:
//
//   node scripts/e2e/worker.mjs [mock|pi]     # the worker (default: pi)
//   node scripts/e2e/worker.mjs api           # the API on the e2e port
//
// It reuses the e2e database and data directory; stop the previous process first.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const target = process.argv[2] ?? "pi";
if (!["mock", "pi", "api"].includes(target)) throw new Error("usage: worker.mjs [mock|pi|api]");

const dotenv = {};
for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
  const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
  if (match) dotenv[match[1]] = match[2].replace(/^["']|["']$/g, "");
}
const url = new URL(dotenv.DATABASE_URL);
url.pathname = "/kintsugi_e2e";
const session = readFileSync(join(root, ".kintsugi/e2e/session.txt"), "utf8");
const password = /Admin:\s+admin \/ (\S+)/.exec(session)?.[1] ?? "";

const env = {
  ...process.env,
  ...dotenv,
  DATABASE_URL: url.toString(),
  KINTSUGI_DATA_DIR: join(root, ".kintsugi/e2e/data"),
  KINTSUGI_GIT_POLL_INTERVAL: "30",
  KINTSUGI_BOOTSTRAP_ADMIN_USER: "admin",
  KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD: password,
  PORT: process.env["E2E_API_PORT"] ?? "3100",
  KINTSUGI_RUNTIME_MODE: target === "api" ? "mock" : target,
};
const entry = target === "api" ? "apps/api/dist/main.js" : "services/orchestrator/dist/main.js";
const child = spawn(process.execPath, [join(root, entry)], { cwd: root, stdio: "inherit", env });
child.on("exit", (code) => process.exit(code ?? 1));
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill());
