import { resolve } from "node:path";

const ENTRYPOINTS = {
  api: "apps/api/dist/main.js",
  worker: "services/orchestrator/dist/main.js",
};

const LOOPBACK_POSTGRES_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const POSTGRES_TARGET_QUERY_KEYS = new Set(["host", "hostaddr", "port", "service", "servicefile"]);
const WINDOWS_RUNTIME_ENV = ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATHEXT", "COMSPEC"];
const POSIX_RUNTIME_ENV = ["PATH", "TMPDIR"];

export function resolveSmokeDatabaseConfig(connectionString, parseIntoClientConfig) {
  if (typeof connectionString !== "string" || connectionString.trim() === "") {
    throw new TypeError("KINTSUGI_TEST_DATABASE_URL must be a PostgreSQL URL");
  }
  if (typeof parseIntoClientConfig !== "function") {
    throw new TypeError("the installed PostgreSQL connection-string parser is required");
  }

  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new TypeError("KINTSUGI_TEST_DATABASE_URL must be a valid PostgreSQL URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new TypeError("KINTSUGI_TEST_DATABASE_URL must use PostgreSQL URL syntax");
  }

  const targetOverrides = [...url.searchParams.keys()].filter((key) => POSTGRES_TARGET_QUERY_KEYS.has(key.toLowerCase()));
  if (targetOverrides.length > 0) {
    throw new TypeError("PostgreSQL connection target overrides are not permitted in KINTSUGI_TEST_DATABASE_URL");
  }

  let config;
  try {
    config = parseIntoClientConfig(connectionString);
  } catch {
    throw new TypeError("KINTSUGI_TEST_DATABASE_URL could not be parsed as a PostgreSQL URL");
  }
  const host = typeof config.host === "string" ? config.host.replace(/^\[(.+)\]$/, "$1").toLowerCase() : "";
  if (!LOOPBACK_POSTGRES_HOSTS.has(host)) {
    throw new TypeError("Smoke requires a loopback PostgreSQL server");
  }

  const port = config.port ?? 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new TypeError("KINTSUGI_TEST_DATABASE_URL must contain a valid PostgreSQL port");
  }

  // Supplying these explicitly prevents PGHOST/PGPORT from redirecting a URL
  // whose authority omitted a value. The child processes also use an allowlist.
  return { ...config, host, port };
}

export function capturePublicProcessClientError(client) {
  let firstError;
  client.on("error", (error) => { firstError ??= error; });
  return () => {
    if (firstError !== undefined) throw firstError;
  };
}

export function redactPublicProcessDiagnostics(value, secrets = []) {
  let safe = String(value ?? "").replace(/\bpostgres(?:ql)?:\/\/[^\s"'<>]+/gi, "[redacted database URL]");
  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length > 0) safe = safe.replaceAll(secret, "[redacted secret]");
  }
  return safe;
}

export async function attemptPublicProcessCleanup(steps, secrets = []) {
  const errors = [];
  for (const step of steps) {
    try {
      await step.cleanup();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${step.label}: ${redactPublicProcessDiagnostics(message, secrets)}`);
    }
  }
  return errors;
}

function requiredString(value, message) {
  if (typeof value !== "string" || value.trim() === "") throw new TypeError(message);
  return value;
}

/** Build a test child that exercises the same entrypoint as the deployed service. */
export function createPublicProcessSpec(kind, options, inherited = process.env, platform = process.platform) {
  const entrypoint = ENTRYPOINTS[kind];
  if (entrypoint === undefined) throw new TypeError(`unsupported public process: ${String(kind)}`);

  const repoRoot = requiredString(options.repoRoot, "repository root is required");
  const cwd = requiredString(options.cwd, "working directory is required");
  const databaseUrl = requiredString(options.databaseUrl, "database URL is required");
  const dataDir = requiredString(options.dataDir, "data directory is required");
  const secretKey = requiredString(options.secretKey, "secret key is required");

  const environment = {};
  for (const name of platform === "win32" ? WINDOWS_RUNTIME_ENV : POSIX_RUNTIME_ENV) {
    const value = inherited[name];
    if (value !== undefined && value !== "") environment[name] = value;
  }
  if (environment.PATH === undefined) throw new TypeError("PATH is required to run Git in the public process smoke");

  Object.assign(environment, {
    DATABASE_URL: databaseUrl,
    KINTSUGI_DATA_DIR: dataDir,
    KINTSUGI_SECRET_KEY: secretKey,
    LOG_LEVEL: "error",
  });

  if (kind === "api") {
    if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
      throw new TypeError("valid API port is required");
    }
    Object.assign(environment, {
      PORT: String(options.port),
      KINTSUGI_BOOTSTRAP_ADMIN_USER: requiredString(options.adminUser, "bootstrap admin user is required"),
      KINTSUGI_BOOTSTRAP_ADMIN_PASSWORD: requiredString(options.adminPassword, "bootstrap admin password is required"),
    });
    if (options.adminPassword.length < 8) throw new TypeError("bootstrap admin password must contain at least 8 characters");
  } else {
    environment.KINTSUGI_GIT_POLL_INTERVAL = "30";
    environment.KINTSUGI_RUNTIME_MODE = "mock";
  }

  return {
    command: process.execPath,
    args: [resolve(repoRoot, entrypoint)],
    cwd,
    env: environment,
  };
}
