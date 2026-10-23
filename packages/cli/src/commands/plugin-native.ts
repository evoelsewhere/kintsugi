import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { HarnessClient, SetupReport } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { CliError, profileConfigPathFromEnv } from "../profile.js";

export const HARNESS_TARGETS = {
  "claude-code": "claude",
  codex: "codex",
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
  if (!Object.hasOwn(HARNESS_TARGETS, name)) throw new CliError("PLUGIN_HARNESS_INVALID", "The client must be claude or codex");
  return name as keyof typeof HARNESS_TARGETS;
}

/** Where the Kintsugi package of a profile and client lives: below the folder of the profile file. */
export function artifactRootFor(deps: CliDeps, profileId: string, harness: keyof typeof HARNESS_TARGETS): string {
  return join(dirname(profileConfigPathFromEnv(deps.env, deps.cwd)), "plugins", "connector", safeProfileDirectory(profileId), harness);
}

/** The client to use when none is given: the only one this profile has been connected to. */
export async function detectHarness(deps: CliDeps, profileId: string): Promise<keyof typeof HARNESS_TARGETS> {
  const connected: Array<keyof typeof HARNESS_TARGETS> = [];
  for (const harness of Object.keys(HARNESS_TARGETS) as Array<keyof typeof HARNESS_TARGETS>) {
    const marker = join(artifactRootFor(deps, profileId, harness), ".kintsugi-managed.json");
    if (await stat(marker).then(() => true, () => false)) connected.push(harness);
  }
  if (connected.length === 1) return connected[0]!;
  throw new CliError("PLUGIN_HARNESS_REQUIRED", connected.length === 0 ? "Connect a client first: kintsugi connect claude <project>" : "Both clients are connected; choose one with -H claude or -H codex");
}
