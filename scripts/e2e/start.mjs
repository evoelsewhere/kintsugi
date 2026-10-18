// Local end-to-end environment: a throwaway database, a local Git server with a sample legacy
// repository and a document repository, and the API, worker and portal pointed at them. The
// development database is never touched. Run after `pnpm build`:
//
//   node scripts/e2e/start.mjs            # then open http://localhost:5174
//
// It prints the admin credentials and the repository URLs to register. Everything lives under
// .kintsugi/e2e/ (gitignored) and the database is dropped and recreated on every start.
// Agent jobs use the mock runtime (KINTSUGI_RUNTIME_MODE=mock): no LLM key is needed.

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(import.meta.dirname, "../..");
const home = join(root, ".kintsugi/e2e");
const API_PORT = Number(process.env["E2E_API_PORT"] ?? 3100);
const PORTAL_PORT = Number(process.env["E2E_PORTAL_PORT"] ?? 5174);
const DB_NAME = "kintsugi_e2e";

function readDotEnv() {
  const values = {};
  for (const line of readFileSync(join(root, ".env"), "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (match) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
  }
  return values;
}

const dotenv = readDotEnv();
if (!dotenv.DATABASE_URL) throw new Error("DATABASE_URL is missing from .env");
const serverUrl = new URL(dotenv.DATABASE_URL);
const e2eUrl = new URL(dotenv.DATABASE_URL);
e2eUrl.pathname = `/${DB_NAME}`;
if (serverUrl.pathname === `/${DB_NAME}`) throw new Error("the development database must not be the e2e database");

// 1. Throwaway database (dropped and recreated).
const pg = createRequire(join(root, "apps/api/package.json"))("pg");
const admin = new pg.Client({ connectionString: (() => { const u = new URL(serverUrl); u.pathname = "/postgres"; return u.toString(); })() });
await admin.connect();
await admin.query(`drop database if exists ${DB_NAME} with (force)`);
await admin.query(`create database ${DB_NAME}`);
await admin.end();

// 2. Local Git server with the fixture repositories.
await rm(home, { recursive: true, force: true });
await mkdir(join(home, "data"), { recursive: true });
const { startGitHttpServer } = await import(pathToFileURL(join(root, "packages/git/dist/testing.js")).href);
const git = await startGitHttpServer();

async function seed(name, dir) {
  await git.createRepository(name, "main");
  const walk = (current) =>
    readdirSync(current).flatMap((entry) => {
      const path = join(current, entry);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });
  for (const file of walk(dir)) {
    const path = relative(dir, file).replaceAll("\\", "/");
    // Format samples stay in the template; only the skeleton is seeded (ADR-0038).
    if (path.includes(".example") && name === "billing-docs") continue;
    await git.commit(name, path, readFileSync(file, "utf8"), "main");
  }
}
await seed("billing-legacy", join(import.meta.dirname, "fixtures/billing-legacy"));
await seed("billing-docs", join(root, "templates/document-repo")); // the ADR-0038 document-repo skeleton

// 3. API, worker and portal.
const password = randomBytes(12).toString("base64url");
const env = {
  ...process.env,
  ...dotenv,
  DATABASE_URL: e2eUrl.toString(),
  PORT: String(API_PORT),
  KINTSUGI_DATA_DIR: join(home, "data"),
  KINTSUGI_BOOTSTRAP_ADMIN_USER: "admin",
  KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD: password,
  KINTSUGI_GIT_POLL_INTERVAL: "30",
  KINTSUGI_RUNTIME_MODE: "mock",
  KINTSUGI_API_URL: `http://localhost:${API_PORT}`,
};

const children = [];
function start(name, args, cwd) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  const prefix = `[${name}] `;
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", (chunk) => process.stdout.write(chunk.toString().split(/\r?\n/).filter(Boolean).map((line) => prefix + line).join("\n") + "\n"));
  }
  child.on("exit", (code) => console.log(`${prefix}exited with ${code}`));
  children.push(child);
}
start("api", [join(root, "apps/api/dist/main.js")], root);
start("worker", [join(root, "services/orchestrator/dist/main.js")], root);
const vite = join(createRequire(join(root, "apps/portal/package.json")).resolve("vite/package.json"), "../bin/vite.js");
start("portal", [vite, "--port", String(PORTAL_PORT), "--strictPort"], join(root, "apps/portal"));

const summary = [
  `Portal:            http://localhost:${PORTAL_PORT}`,
  `Admin:             admin / ${password}`,
  `Git server (none): ${git.baseUrl}  (kind plain-git, no credential)`,
  `Legacy repo:       ${git.baseUrl}/billing-legacy.git`,
  `Document repo:     ${git.baseUrl}/billing-docs.git`,
  `Database:          ${DB_NAME} (dropped on next start)`,
].join("\n");
writeFileSync(join(home, "session.txt"), summary + "\n");
console.log(`\n${summary}\n(also in .kintsugi/e2e/session.txt)\n`);

const stop = async () => {
  for (const child of children) child.kill();
  await git.close();
  process.exit();
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
