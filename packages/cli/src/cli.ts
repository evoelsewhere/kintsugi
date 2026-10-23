import { Command, CommanderError } from "commander";
import { serveMemberStdio } from "@kintsugi/harness-hub";
import type { HarnessClient } from "@kintsugi/harness-hub";
import type { MemberPort } from "@kintsugi/harness-sdk";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { emitKeypressEvents } from "node:readline";
import { KintsugiClientError } from "@kintsugi/kintsugi-client";
import { getNativeClientVersion } from "./client-version.js";
import { runNativeClientCommand } from "./client-command.js";
import type { CredentialStore } from "./credential-store.js";
import { NativeCredentialStore } from "./credential-store.js";
import { registerActivityCommands } from "./commands/activity.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerDocumentCommands } from "./commands/document.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerMcpCommands } from "./commands/mcp.js";
import { registerPluginsCommand } from "./commands/plugins.js";
import { validateFormat } from "./commands/shared.js";
import { CliError, FileProfileStore, profileConfigPathFromEnv, type ProfileStore } from "./profile.js";
import { KINTSUGI_CLI_VERSION } from "./version.js";

export interface OAuthLoopbackCallback {
  redirectUri: string;
  waitForCode(): Promise<{ code: string; state: string }>;
  complete?(outcome: "success" | "error"): Promise<void>;
  close(): Promise<void>;
}

export interface NativeClientCommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CliDeps {
  profiles: ProfileStore;
  credentials: CredentialStore;
  fetch: typeof globalThis.fetch;
  serveMcp: (member: MemberPort) => Promise<void>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  promptSecret: () => Promise<string>;
  readStdin: () => Promise<string>;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  launcher?: { launcherPath: string; cliEntrypointPath: string; cliVersion: string };
  /** User home directory, injectable so personal marketplace staging can be tested safely. */
  homeDir?: string;
  getClientVersion?: (target: HarnessClient) => Promise<string>;
  signal?: AbortSignal;
  /** Subscription lifetime, independent of the ordinary request deadline. */
  watchSignal?: AbortSignal;
  /** Browser launch and loopback callback are injectable so auth tests never open a real browser or listener. */
  openBrowser?: (url: string) => Promise<void>;
  createOAuthCallback?: (options: { state: string; signal?: AbortSignal }) => Promise<OAuthLoopbackCallback>;
  /** Native harness process execution is injectable and must use argument-safe spawning. */
  runClientCommand?: (executable: string, args: readonly string[]) => Promise<NativeClientCommandResult>;
}

function sleepWithSignal(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new CliError("CANCELLED", "Request cancelled")); return; }
    let settled = false;
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new CliError("CANCELLED", "Request cancelled"));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, milliseconds);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
  });
}

export function createDefaultCliDeps(): CliDeps {
  const entrypoint = process.argv[1];
  return {
    profiles: new FileProfileStore(profileConfigPathFromEnv(process.env, process.cwd())),
    credentials: new NativeCredentialStore(),
    fetch: globalThis.fetch,
    serveMcp: (member) => serveMemberStdio({ member }),
    launcher: {
      launcherPath: process.execPath,
      cliEntrypointPath: entrypoint === undefined ? process.execPath : realpathSync(entrypoint),
      cliVersion: KINTSUGI_CLI_VERSION,
    },
    getClientVersion: getNativeClientVersion,
    runClientCommand: (executable, args) => runNativeClientCommand(executable, args, {
      cwd: process.cwd(),
      env: process.env,
      // Keep JSON/text reports on stdout; native client progress belongs on stderr.
      stdout: process.stderr,
      stderr: process.stderr,
    }),
    cwd: process.cwd(),
    homeDir: homedir(),
    env: process.env,
    isTTY: Boolean(process.stdin.isTTY),
    promptSecret: async () => {
      const input = process.stdin;
      if (!input.isTTY || typeof input.setRawMode !== "function") throw new CliError("INPUT_REQUIRED", "A hidden token prompt requires an interactive terminal");
      process.stdout.write("Kintsugi token: ");
      emitKeypressEvents(input);
      const wasRaw = input.isRaw;
      input.setRawMode(true);
      input.resume();
      return await new Promise<string>((resolve, reject) => {
        let secret = "";
        const cleanup = () => {
          input.removeListener("keypress", onKeypress);
          input.setRawMode(wasRaw ?? false);
          process.stdout.write("\n");
        };
        const onKeypress = (text: string | undefined, key: { name?: string; ctrl?: boolean }) => {
          if (key.ctrl && key.name === "c") { cleanup(); reject(new CliError("CANCELLED", "Credential prompt cancelled")); return; }
          if (key.name === "return" || key.name === "enter") { cleanup(); resolve(secret); return; }
          if (key.name === "backspace") { secret = secret.slice(0, -1); return; }
          if (text !== undefined && !key.ctrl) secret += text;
        };
        process.stdin.on("keypress", onKeypress);
      });
    },
    readStdin: async () => {
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      return Buffer.concat(chunks).toString("utf8");
    },
    stdout: process.stdout,
    stderr: process.stderr,
    sleep: sleepWithSignal,
  };
}

/** Scope native termination signals to this invocation and release listeners afterwards. */
export async function runCliWithSignals(
  argv: readonly string[],
  deps: CliDeps,
  signals: Pick<NodeJS.Process, "on" | "removeListener"> = process,
): Promise<number> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signals.on("SIGINT", abort);
  signals.on("SIGTERM", abort);
  const signal = deps.signal === undefined ? controller.signal : AbortSignal.any([controller.signal, deps.signal]);
  try { return await runCli(argv, { ...deps, signal }); }
  finally {
    signals.removeListener("SIGINT", abort);
    signals.removeListener("SIGTERM", abort);
  }
}

function errorFields(error: unknown): { code: string; status?: number; message: string; details?: unknown } {
  if (error instanceof KintsugiClientError || error instanceof CliError) {
    const details = "details" in error ? error.details : undefined;
    return { code: error.code, ...(error.status === undefined ? {} : { status: error.status }), message: error.message, ...(details === undefined ? {} : { details }) };
  }
  if (error !== null && typeof error === "object") {
    const value = error as { code?: unknown; status?: unknown; message?: unknown; details?: unknown };
    return {
      code: typeof value.code === "string" ? value.code : "CLI_ERROR",
      ...(typeof value.status === "number" ? { status: value.status } : {}),
      message: typeof value.message === "string" ? value.message : "Kintsugi command failed",
      ...(value.details === undefined ? {} : { details: value.details }),
    };
  }
  return { code: "CLI_ERROR", message: "Kintsugi command failed" };
}

export async function runCli(argv: readonly string[], deps: CliDeps): Promise<number> {
  const program = new Command();
  program.name("kintsugi").description("Connect your coding agent to Kintsugi").version(KINTSUGI_CLI_VERSION);
  program
    .option("--format <format>", "Output format: text, json, or markdown", "text")
    .option("--json", "Alias for --format json")
    .option("--profile <id>", "Use a named local Kintsugi profile")
    .option("--project <id>", "Use a project for this command")
    .option("--no-input", "Disable interactive prompts")
    .option("--token-stdin", "Read a one-shot token from stdin (never persist it)");
  program.configureOutput({
    writeOut: (value) => { deps.stdout.write(value); },
    writeErr: (value) => { deps.stderr.write(value); },
    outputError: (value, write) => { write(value); },
  });
  program.exitOverride();
  program.hook("preAction", (_thisCommand, actionCommand) => {
    const options = actionCommand.optsWithGlobals() as { format?: string };
    if (options.format !== undefined) validateFormat(options.format);
  });
  registerAuthCommands(program, deps);
  registerProjectCommands(program, deps);
  registerDocumentCommands(program, deps);
  registerActivityCommands(program, deps);
  registerDoctorCommand(program, deps);
  registerMcpCommands(program, deps);
  registerPluginsCommand(program, deps);

  try {
    await program.parseAsync([...argv], { from: "user" });
    return 0;
  } catch (error) {
    if (error instanceof CommanderError && error.exitCode === 0) return 0;
    const options = program.opts() as { format?: string; json?: boolean };
    const format = options.json ? "json" : options.format === "json" ? "json" : "text";
    const fields = errorFields(error);
    if (format === "json") deps.stderr.write(`${JSON.stringify({ success: false, error: fields })}\n`);
    else deps.stderr.write(`Error ${fields.code}: ${fields.message}${fields.details === undefined ? "" : `\n${JSON.stringify(fields.details, null, 2)}`}\n`);
    return fields.status === 403 ? 3 : fields.status === 401 ? 3 : 2;
  }
}
