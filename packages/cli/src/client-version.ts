import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { CodingAgentClient } from "@kintsugi/harness-hub";

const execFileAsync = promisify(execFile);
const NATIVE_CLIENT_COMMANDS: Record<CodingAgentClient, string> = {
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
};

interface NativeClientExecOptions {
  timeout: number;
  windowsHide: boolean;
  shell: false;
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
  target: CodingAgentClient,
  _platform: NodeJS.Platform = process.platform,
  execute: NativeClientExecutor = executeNativeClient,
): Promise<string> {
  const { stdout, stderr } = await execute(NATIVE_CLIENT_COMMANDS[target], ["--version"], {
    timeout: 5_000,
    windowsHide: true,
    shell: false,
  });
  const match = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/.exec(`${stdout}\n${stderr}`);
  if (match?.[0] === undefined) throw new Error("Native client did not report a semantic version");
  return match[0];
}
