import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { HarnessClient, InstallScope, SetupReport } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { CliError, profileConfigPathFromEnv } from "../profile.js";

export const HARNESS_TARGETS = {
  "claude-code": "claude",
  codex: "codex",
  copilot: "copilot",
} as const satisfies Record<string, HarnessClient>;

export function safeProfileDirectory(profileId: string): string {
  return `profile-${createHash("sha256").update(profileId, "utf8").digest("hex").slice(0, 16)}`;
}

export function rollbackInstructions(report: SetupReport): string {
  return [
    "To roll back this Kintsugi plugin setup, run:",
    ...report.rollbackCommands.map((command) => `  ${command}`),
    `Then remove the generated package directory: ${report.artifactRoot}`,
  ].join("\n");
}

export async function runInstallSteps(deps: CliDeps, report: SetupReport): Promise<void> {
  for (let index = 0; index < report.installSteps.length; index++) {
    const command = report.installSteps[index]!;
    if (deps.runClientCommand === undefined) throw new CliError("PLUGIN_SETUP_UNAVAILABLE", "This CLI has no native client command runner");
    let result: Awaited<ReturnType<NonNullable<CliDeps["runClientCommand"]>>>;
    try {
      result = await deps.runClientCommand(command.executable, command.args);
    } catch {
      throw new CliError(
        "PLUGIN_SETUP_COMMAND_FAILED",
        `Native setup failed to start at command ${index + 1} of ${report.installSteps.length}. Completed ${index} of ${report.installSteps.length} commands.\n${rollbackInstructions(report)}`,
      );
    }
    if (result.exitCode !== 0) {
      throw new CliError(
        "PLUGIN_SETUP_COMMAND_FAILED",
        `Native setup stopped at command ${index + 1} of ${report.installSteps.length} (exit code ${result.exitCode}). Completed ${index} of ${report.installSteps.length} commands.\n${rollbackInstructions(report)}`,
      );
    }
  }
}

/** `claude` and `claude-code` name the same client. */
export function normalizeHarness(value: string): keyof typeof HARNESS_TARGETS {
  const name = value === "claude" ? "claude-code" : value;
  if (!Object.hasOwn(HARNESS_TARGETS, name)) throw new CliError("PLUGIN_HARNESS_INVALID", "The client must be claude, codex or copilot");
  return name as keyof typeof HARNESS_TARGETS;
}

/** Where the Kintsugi package of a profile and client lives: below the folder of the profile file. */
export function artifactRootFor(deps: CliDeps, profileId: string, harness: keyof typeof HARNESS_TARGETS): string {
  return join(dirname(profileConfigPathFromEnv(deps.env, deps.cwd)), "plugins", "connector", safeProfileDirectory(profileId), harness);
}

/** Every client this profile has been set up for (`kintsugi init`), in a fixed order. */
export async function initializedHarnesses(deps: CliDeps, profileId: string): Promise<Array<keyof typeof HARNESS_TARGETS>> {
  const connected: Array<keyof typeof HARNESS_TARGETS> = [];
  for (const harness of Object.keys(HARNESS_TARGETS) as Array<keyof typeof HARNESS_TARGETS>) {
    const marker = join(artifactRootFor(deps, profileId, harness), ".kintsugi-managed.json");
    if (await stat(marker).then(() => true, () => false)) connected.push(harness);
  }
  return connected;
}

/** The client to use when none is given: the only one this profile has been set up for. */
export async function detectHarness(deps: CliDeps, profileId: string): Promise<keyof typeof HARNESS_TARGETS> {
  const connected = await initializedHarnesses(deps, profileId);
  if (connected.length === 1) return connected[0]!;
  throw new CliError("PLUGIN_HARNESS_REQUIRED", connected.length === 0 ? "Set up a client first: kintsugi init" : "More than one client is set up; choose one with -H claude, -H codex or -H copilot, or use --all");
}

/** Where a client installs its plugins: for the user, or for the workspace `init` ran in. */
export interface HarnessScope {
  scope: InstallScope;
  /** The folder of the workspace, for the scopes that belong to one. */
  workspace?: string;
}

const SCOPE_FILE = ".kintsugi-scope.json";

export async function readHarnessScope(artifactRoot: string): Promise<HarnessScope> {
  try {
    const value = JSON.parse(await readFile(join(artifactRoot, SCOPE_FILE), "utf8")) as Partial<HarnessScope>;
    if (value.scope === "user" || value.scope === "project" || value.scope === "local") return { scope: value.scope, ...(typeof value.workspace === "string" ? { workspace: value.workspace } : {}) };
  } catch { /* A package made before scopes existed was made for the user. */ }
  return { scope: "user" };
}

export async function writeHarnessScope(artifactRoot: string, scope: HarnessScope): Promise<void> {
  await writeFile(join(artifactRoot, SCOPE_FILE), `${JSON.stringify(scope, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

/** A workspace-scoped client installs into the folder the command runs in, so the command must run there. */
export function assertWorkspace(deps: CliDeps, harness: string, scope: HarnessScope): void {
  if (scope.scope === "user" || scope.workspace === undefined) return;
  if (resolve(scope.workspace) !== resolve(deps.cwd)) {
    throw new CliError("PLUGIN_WORKSPACE_MISMATCH", `${harness} was set up for the workspace ${scope.workspace}; run this command there, or run kintsugi init again here`);
  }
}

/**
 * The version a client sees for a plugin: the plugin's own, with a short hash of its content. Every client keeps its copy of a
 * plugin in a folder named after the version, so a plugin edited without a new version number would otherwise never be refreshed.
 */
export function clientPluginVersion(version: string, contentHash: string): string {
  const hash = contentHash.replace(/^sha256:/, "").slice(0, 8);
  return version.includes("-") ? `${version}.${hash}` : `${version}-${hash}`;
}
