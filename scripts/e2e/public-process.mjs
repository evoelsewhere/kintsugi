import { resolve } from "node:path";

const ENTRYPOINTS = {
  api: "apps/api/dist/main.js",
  worker: "services/orchestrator/dist/main.js",
};

const WINDOWS_RUNTIME_ENV = ["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "PATHEXT", "COMSPEC"];
const POSIX_RUNTIME_ENV = ["PATH", "TMPDIR"];

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
