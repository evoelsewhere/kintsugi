import { existsSync, readFileSync } from "node:fs";

/**
 * Resolve the database URL used by integration helpers. Mandatory release lanes only
 * accept the explicitly supplied disposable test server and never inspect the root .env.
 */
export function databaseUrlFromEnvironment(env, envFilePath) {
  let raw;
  if (env.KINTSUGI_REQUIRED_INTEGRATION === "1") {
    raw = env.KINTSUGI_TEST_DATABASE_URL;
    if (raw === undefined || raw.trim() === "") {
      throw new Error("KINTSUGI_TEST_DATABASE_URL is required for mandatory integration runs");
    }
  } else {
    raw = env.DATABASE_URL;
    if ((raw === undefined || raw.trim() === "") && envFilePath !== undefined && existsSync(envFilePath)) {
      raw = /^DATABASE_URL=(.*)$/m.exec(readFileSync(envFilePath, "utf8"))?.[1]?.trim();
    }
  }
  if (raw === undefined || raw.trim() === "") return undefined;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("DATABASE_URL is not a valid PostgreSQL URL");
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) || parsed.hostname === "" || parsed.pathname === "/") {
    throw new Error("DATABASE_URL must be a PostgreSQL URL with a database name");
  }
  return raw;
}
