import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessClient } from "@kintsugi/harness-hub";
import { windowsLauncherInvocation } from "./client-command.js";
import { CliError } from "./profile.js";

const execFileAsync = promisify(execFile);
const NATIVE_CLIENT_COMMANDS: Record<HarnessClient, string> = {
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
};

/** How long a client may take to say its version: started directly, and through PowerShell (a cold start with an npm shim). */
const DIRECT_PROBE_MS = 5_000;
const LAUNCHER_PROBE_MS = 20_000;

interface NativeClientExecOptions {
  timeout: number;
  windowsHide: boolean;
  shell: false;
  env?: NodeJS.ProcessEnv;
}

type NativeClientExecutor = (
  command: string,
  args: string[],
  options: NativeClientExecOptions,
) => Promise<{ stdout: string; stderr: string }>;

const executeNativeClient: NativeClientExecutor = async (command, args, options) => {
  const { stdout, stderr } = await execFileAsync(command, args, { ...options, encoding: "utf8" });
  return { stdout, stderr };
};

/** A client that was started but did not say its version in time: slow, not missing. */
export class ClientVersionTimeout extends Error {
  constructor(
    readonly target: HarnessClient,
    readonly timeoutMs: number,
  ) {
    super(`${target} did not answer its version check within ${Math.round(timeoutMs / 1000)} s`);
  }
}

/** True when the version check failed because the client did not answer in time. */
export function clientVersionTimedOut(error: unknown): error is ClientVersionTimeout {
  return error instanceof ClientVersionTimeout;
}

/** What to tell a member whose client version could not be read: a slow client is not a missing one. */
export function clientUnavailable(target: HarnessClient, error: unknown): CliError {
  if (clientVersionTimedOut(error)) return new CliError("PLUGIN_CLIENT_UNAVAILABLE", `${error.message}; it is installed but slow to start, so run the command again`);
  return new CliError("PLUGIN_CLIENT_UNAVAILABLE", `Could not read the ${target} CLI version; install it or make it available on PATH`);
}

/** execFile kills a child that runs past its timeout. */
const killedByTimeout = (error: unknown): boolean => {
  const failure = error as { killed?: boolean; code?: unknown };
  return failure.killed === true || failure.code === "ETIMEDOUT";
};

export async function getNativeClientVersion(
  target: HarnessClient,
  platform: NodeJS.Platform = process.platform,
  execute: NativeClientExecutor = executeNativeClient,
): Promise<string> {
  const options: NativeClientExecOptions = { timeout: DIRECT_PROBE_MS, windowsHide: true, shell: false };
  let output: { stdout: string; stderr: string };
  try {
    output = await execute(NATIVE_CLIENT_COMMANDS[target], ["--version"], options);
  } catch (error) {
    if (killedByTimeout(error)) throw new ClientVersionTimeout(target, DIRECT_PROBE_MS);
    // An npm install of a client on Windows is `claude.cmd`, which cannot be started directly; PowerShell finds it.
    if (platform !== "win32" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const launch = windowsLauncherInvocation(NATIVE_CLIENT_COMMANDS[target], ["--version"], process.env);
    try {
      output = await execute(launch.command, launch.args, { ...options, timeout: LAUNCHER_PROBE_MS, env: launch.env });
    } catch (launchError) {
      if (killedByTimeout(launchError)) throw new ClientVersionTimeout(target, LAUNCHER_PROBE_MS);
      throw launchError;
    }
  }
  const { stdout, stderr } = output;
  const match = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/.exec(`${stdout}\n${stderr}`);
  if (match?.[0] === undefined) throw new Error("Native client did not report a semantic version");
  return match[0];
}

/** One version check per client for the life of `get`: a command that looks at a client twice asks it once. */
export function rememberClientVersions(get: (target: HarnessClient) => Promise<string>): (target: HarnessClient) => Promise<string> {
  const asked = new Map<HarnessClient, Promise<string>>();
  return (target) => {
    let version = asked.get(target);
    if (version === undefined) {
      version = get(target);
      asked.set(target, version);
    }
    return version;
  };
}
