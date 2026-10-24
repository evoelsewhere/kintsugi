import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { HarnessClient } from "@kintsugi/harness-hub";
import { windowsLauncherInvocation } from "./client-command.js";

const execFileAsync = promisify(execFile);
const NATIVE_CLIENT_COMMANDS: Record<HarnessClient, string> = {
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
};

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

export async function getNativeClientVersion(
  target: HarnessClient,
  platform: NodeJS.Platform = process.platform,
  execute: NativeClientExecutor = executeNativeClient,
): Promise<string> {
  const options: NativeClientExecOptions = { timeout: 5_000, windowsHide: true, shell: false };
  let output: { stdout: string; stderr: string };
  try {
    output = await execute(NATIVE_CLIENT_COMMANDS[target], ["--version"], options);
  } catch (error) {
    // An npm install of a client on Windows is `claude.cmd`, which cannot be started directly; PowerShell finds it.
    if (platform !== "win32" || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const launch = windowsLauncherInvocation(NATIVE_CLIENT_COMMANDS[target], ["--version"], process.env);
    output = await execute(launch.command, launch.args, { ...options, env: launch.env });
  }
  const { stdout, stderr } = output;
  const match = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/.exec(`${stdout}\n${stderr}`);
  if (match?.[0] === undefined) throw new Error("Native client did not report a semantic version");
  return match[0];
}
