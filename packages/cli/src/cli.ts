import { Command, CommanderError } from "commander";
import { serveCodingAgentStdio } from "@kintsugi/harness-hub";
import type { CodingAgentClient } from "@kintsugi/harness-hub";
import type { CodingAgentWorkflowCapabilities, CodingAgentWorkflowPort } from "@kintsugi/harness-sdk";
import { execFile } from "node:child_process";
import { realpathSync } from "node:fs";
import { emitKeypressEvents } from "node:readline";
import { promisify } from "node:util";
import { CodingAgentClientError } from "@kintsugi/kintsugi-client";
import type { CredentialStore } from "./credential-store.js";
import { NativeCredentialStore } from "./credential-store.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerDocumentCommands } from "./commands/document.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerProjectCommands } from "./commands/project.js";
import { registerTaskCommands } from "./commands/task.js";
import { registerMcpCommands } from "./commands/mcp.js";
import { registerPluginsCommand } from "./commands/plugins.js";
import { validateFormat } from "./commands/shared.js";
import { CliError, FileProfileStore, profileConfigPathFromEnv, type ProfileStore } from "./profile.js";
import { KINTSUGI_CLI_VERSION } from "./version.js";

const execFileAsync = promisify(execFile);

const NATIVE_CLIENT_COMMANDS: Record<CodingAgentClient, string> = {
  claude: "claude",
  codex: "codex",
  copilot: "copilot",
};

export interface CliDeps {
  profiles: ProfileStore;
  credentials: CredentialStore;
  fetch: typeof globalThis.fetch;
  serveMcp: (access: CodingAgentWorkflowPort, capabilities: CodingAgentWorkflowCapabilities) => Promise<void>;
  cwd: string;
  env: NodeJS.ProcessEnv;
  isTTY: boolean;
  promptSecret: () => Promise<string>;
  readStdin: () => Promise<string>;
  stdout: { write(value: string): unknown };
  stderr: { write(value: string): unknown };
  sleep: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
  launcher?: { launcherPath: string; cliEntrypointPath: string; cliVersion: string };
  getClientVersion?: (target: CodingAgentClient) => Promise<string>;
  signal?: AbortSignal;
  /** Subscription lifetime, independent of the ordinary request deadline. */
  watchSignal?: AbortSignal;
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
    serveMcp: (access, capabilities) => serveCodingAgentStdio({ access, capabilities }),
    launcher: {
      launcherPath: process.execPath,
      cliEntrypointPath: entrypoint === undefined ? process.execPath : realpathSync(entrypoint),
      cliVersion: KINTSUGI_CLI_VERSION,
    },
    getClientVersion: async (target) => {
      const { stdout, stderr } = await execFileAsync(NATIVE_CLIENT_COMMANDS[target], ["--version"], { timeout: 5_000, windowsHide: true });
      const match = /\b\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\b/.exec(`${stdout}\n${stderr}`);
      if (match?.[0] === undefined) throw new Error("Native client did not report a semantic version");
      return match[0];
    },
    cwd: process.cwd(),
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
    signal: AbortSignal.timeout(60_000),
  };
}

function errorFields(error: unknown): { code: string; status?: number; message: string; details?: unknown } {
  if (error instanceof CodingAgentClientError || error instanceof CliError) {
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
  program.name("kintsugi").description("Read project context and workflow data from Kintsugi").version(KINTSUGI_CLI_VERSION);
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
  registerTaskCommands(program, deps);
  registerDocumentCommands(program, deps);
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
