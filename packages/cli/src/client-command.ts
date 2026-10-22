import { spawn } from "node:child_process";
import { resolve } from "node:path";
import type { NativeClientCommandResult } from "./cli.js";
import { CliError } from "./profile.js";

const ALLOWED_EXECUTABLES = new Set(["claude", "codex", "copilot"]);
const WINDOWS_LAUNCHER = [
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "  [string[]]$nativeArgs = @(ConvertFrom-Json -InputObject $env:KINTSUGI_NATIVE_ARGS)",
  "  $nativeExecutable = $env:KINTSUGI_NATIVE_EXECUTABLE",
  "  $application = Get-Command -Name $nativeExecutable -CommandType Application -ErrorAction Stop",
  "  & $application.Source @nativeArgs",
  "  if ($null -eq $LASTEXITCODE) { exit 0 }",
  "  exit $LASTEXITCODE",
  "} catch {",
  "  [Console]::Error.WriteLine($_.Exception.Message)",
  "  exit 127",
  "}",
].join("\n");

interface NativeChild {
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  once(event: "error", listener: (error: Error) => void): this;
  once(event: "close", listener: (code: number | null, signal: NodeJS.Signals | null) => void): this;
}

type NativeSpawn = (
  command: string,
  args: string[],
  options: { cwd?: string; env: NodeJS.ProcessEnv; shell: false; windowsHide: true; stdio: ["ignore", "pipe", "pipe"] },
) => NativeChild;

export interface NativeClientCommandOptions {
  platform?: NodeJS.Platform;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
  spawn?: NativeSpawn;
}

function windowsPowerShellPath(env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot ?? env.windir;
  if (root === undefined || root.trim() === "") throw new CliError("NATIVE_COMMAND_UNAVAILABLE", "Windows PowerShell could not be located through SystemRoot");
  return resolve(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export async function runNativeClientCommand(
  executable: string,
  args: readonly string[],
  options: NativeClientCommandOptions,
): Promise<NativeClientCommandResult> {
  if (!ALLOWED_EXECUTABLES.has(executable)) throw new CliError("NATIVE_COMMAND_NOT_ALLOWED", "Only Claude Code, Codex CLI, and Copilot CLI commands can be started by plugin setup");
  if (args.some((argument) => argument.includes("\0"))) throw new CliError("NATIVE_ARGUMENT_INVALID", "Native client arguments cannot contain NUL characters");

  const platform = options.platform ?? process.platform;
  const env = { ...process.env, ...options.env };
  let command = executable;
  let commandArgs = [...args];
  if (platform === "win32") {
    const serializedArgs = JSON.stringify(args);
    if (serializedArgs.length > 24_000) throw new CliError("NATIVE_ARGUMENT_INVALID", "Native client arguments exceed the Windows command limit");
    command = windowsPowerShellPath(env);
    commandArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(WINDOWS_LAUNCHER, "utf16le").toString("base64")];
    env.KINTSUGI_NATIVE_EXECUTABLE = executable;
    env.KINTSUGI_NATIVE_ARGS = serializedArgs;
  }

  const execute = options.spawn ?? (spawn as NativeSpawn);
  let child: NativeChild;
  try {
    child = execute(command, commandArgs, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    throw new CliError("NATIVE_COMMAND_FAILED", `Could not start the ${executable} CLI command`);
  }

  return await new Promise<NativeClientCommandResult>((resolveResult, rejectResult) => {
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      const value = String(chunk);
      stdout += value;
      options.stdout.write(value);
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      const value = String(chunk);
      stderr += value;
      options.stderr.write(value);
    });
    child.once("error", () => rejectResult(new CliError("NATIVE_COMMAND_FAILED", `Could not start the ${executable} CLI command`)));
    child.once("close", (code) => resolveResult({ exitCode: code ?? 1, stdout, stderr }));
  });
}
