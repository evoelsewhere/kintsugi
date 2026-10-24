import { spawn } from "node:child_process";
import { win32 } from "node:path";
import type { NativeClientCommandResult } from "./cli.js";
import { CliError } from "./profile.js";

const ALLOWED_EXECUTABLES = new Set(["claude", "codex", "copilot"]);
const WINDOWS_LAUNCHER = [
  "$ErrorActionPreference = 'Stop'",
  "$ProgressPreference = 'SilentlyContinue'",
  "try {",
  // Windows PowerShell 5.1 hands back the whole JSON array as one object, which a cast would join into a single argument.
  "  $parsedArgs = ConvertFrom-Json -InputObject $env:KINTSUGI_NATIVE_ARGS",
  "  [string[]]$nativeArgs = foreach ($argument in $parsedArgs) { [string]$argument }",
  "  $nativeExecutable = $env:KINTSUGI_NATIVE_EXECUTABLE",
  // An npm install leaves `claude` (a shell script) and `claude.cmd` side by side: take one that Windows can start.
  "  $found = @(Get-Command -Name $nativeExecutable -CommandType Application -ErrorAction Stop)",
  "  $application = @($found | Where-Object { $_.Extension -ne '' })[0]",
  "  if ($null -eq $application) { $application = $found[0] }",
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
  options: { cwd?: string; env: NodeJS.ProcessEnv; shell: false; windowsHide: true; stdio: ["inherit", "inherit", "inherit"] },
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
  // Windows environment names are case-insensitive, but a copy of the environment keeps the case it was given (Git Bash: SYSTEMROOT).
  const named = (name: string): string | undefined => Object.entries(env).filter(([key]) => key.toLowerCase() === name).at(-1)?.[1];
  const root = named("systemroot") ?? named("windir");
  if (root === undefined || root.trim() === "") throw new CliError("NATIVE_COMMAND_UNAVAILABLE", "Windows PowerShell could not be located through SystemRoot");
  return win32.resolve(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/**
 * How to start a native client on Windows through PowerShell, which finds `claude.cmd` (an npm install) as well as an
 * executable. The arguments travel as JSON in the environment, so PowerShell never re-splits them.
 */
export function windowsLauncherInvocation(executable: string, args: readonly string[], env: NodeJS.ProcessEnv): { command: string; args: string[]; env: NodeJS.ProcessEnv } {
  const serializedArgs = JSON.stringify(args);
  if (serializedArgs.length > 24_000) throw new CliError("NATIVE_ARGUMENT_INVALID", "Native client arguments exceed the Windows command limit");
  return {
    command: windowsPowerShellPath(env),
    args: ["-NoLogo", "-NoProfile", "-EncodedCommand", Buffer.from(WINDOWS_LAUNCHER, "utf16le").toString("base64")],
    env: { ...env, KINTSUGI_NATIVE_EXECUTABLE: executable, KINTSUGI_NATIVE_ARGS: serializedArgs },
  };
}

export async function runNativeClientCommand(
  executable: string,
  args: readonly string[],
  options: NativeClientCommandOptions,
): Promise<NativeClientCommandResult> {
  if (!ALLOWED_EXECUTABLES.has(executable)) throw new CliError("NATIVE_COMMAND_NOT_ALLOWED", "Only Claude Code, Codex CLI, and Copilot CLI commands can be started by plugin setup");
  if (args.some((argument) => argument.includes("\0"))) throw new CliError("NATIVE_ARGUMENT_INVALID", "Native client arguments cannot contain NUL characters");

  const platform = options.platform ?? process.platform;
  let env = { ...process.env, ...options.env };
  let command = executable;
  let commandArgs = [...args];
  // Codex installs a native Windows executable. Spawning it directly preserves
  // argv; Windows PowerShell 5 otherwise joins the splatted arguments into one.
  if (platform === "win32" && executable !== "codex") {
    const launch = windowsLauncherInvocation(executable, args, env);
    command = launch.command;
    commandArgs = launch.args;
    env = launch.env;
  }

  const execute = options.spawn ?? (spawn as NativeSpawn);
  let child: NativeChild;
  try {
    child = execute(command, commandArgs, {
      ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
      env,
      shell: false,
      windowsHide: true,
      stdio: ["inherit", "inherit", "inherit"],
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
