import { createHash } from "node:crypto";
import type { HarnessClient, SetupReport } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";

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
