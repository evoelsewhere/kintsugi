// kintsugi-worker entry point (ADR-0003, ADR-0025). Configuration is deployment
// environment only: DATABASE_URL, KINTSUGI_SECRET_KEY (decrypts Git credentials),
// KINTSUGI_DATA_DIR, KINTSUGI_GIT_POLL_INTERVAL and KINTSUGI_BOT_EMAIL. Git servers and
// repositories are configured in the portal.

import { existsSync } from "node:fs";
import { CheckoutStorage, checkGitVersion, dataDirFromEnv } from "@kintsugi/git";
import { Pool } from "pg";
import { DEFAULT_BOT_EMAIL, startWorker } from "./worker.js";

/** Local development configuration lives in .env (gitignored); the compose package passes env directly. */
if (existsSync(".env")) process.loadEnvFile(".env");

async function main(): Promise<void> {
  const databaseUrl = process.env["DATABASE_URL"];
  if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");
  if ((process.env["KINTSUGI_SECRET_KEY"] ?? "") === "") throw new Error("KINTSUGI_SECRET_KEY is not set; it decrypts Git credentials");
  const pollIntervalSeconds = Number(process.env["KINTSUGI_GIT_POLL_INTERVAL"] ?? 180);
  if (!Number.isFinite(pollIntervalSeconds) || pollIntervalSeconds < 30) throw new Error("KINTSUGI_GIT_POLL_INTERVAL must be at least 30 seconds");

  const botEmail = (process.env["KINTSUGI_BOT_EMAIL"] ?? "").trim() || DEFAULT_BOT_EMAIL;
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(botEmail)) throw new Error("KINTSUGI_BOT_EMAIL must be a plain email address");

  const gitVersion = await checkGitVersion();
  const storage = new CheckoutStorage(dataDirFromEnv());
  const pool = new Pool({ connectionString: databaseUrl, max: 5 });
  const worker = await startWorker({ databaseUrl, pool, storage, pollIntervalSeconds, botEmail });
  console.log(`[worker] git ${gitVersion}, data ${storage.root}, polling every ${pollIntervalSeconds}s, commits as kintsugi-bot <${botEmail}>`);

  const shutdown = async (): Promise<void> => {
    await worker.stop();
    await pool.end();
    process.exit(0);
  };
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(`[worker] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
