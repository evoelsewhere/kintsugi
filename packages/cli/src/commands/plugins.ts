import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import type { Command } from "commander";
import { applyClientSetup, planClientSetup, type CodingAgentClient } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { CliError, isProfileId, profileConfigPathFromEnv, validateInstallationUrl } from "../profile.js";

const HARNESS_TARGETS = {
  "claude-code": "claude",
  codex: "codex",
} as const satisfies Record<string, CodingAgentClient>;

function stableProjectProfileId(baseUrl: string, projectId: string): string {
  const identity = `${baseUrl}\0${projectId}`;
  return `kintsugi-${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 12)}`;
}

function safeProfileDirectory(profileId: string): string {
  return `profile-${createHash("sha256").update(profileId, "utf8").digest("hex").slice(0, 16)}`;
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function validateProjectId(value: string): string {
  if (value.trim() !== value || value.length < 1 || value.length > 200 || hasControlCharacters(value)) {
    throw new CliError("PROJECT_INVALID", "Project ID must be 1 to 200 characters without surrounding whitespace or control characters");
  }
  return value;
}

function renderSetupPlan(deps: CliDeps, input: { harness: string; profileId: string; report: Awaited<ReturnType<typeof applyClientSetup>> }): void {
  deps.stdout.write(`Harness: ${input.harness}; Kintsugi profile: ${input.profileId}\n`);
  deps.stdout.write(`Generated package: ${input.report.pluginRoot}\n`);
  deps.stdout.write("Package files created or updated:\n");
  if (input.report.written.length === 0) deps.stdout.write("  No package files needed changes.\n");
  else for (const path of input.report.written) deps.stdout.write(`  ${path}\n`);
  deps.stdout.write("Package files unchanged:\n");
  if (input.report.unchanged.length === 0) deps.stdout.write("  (none)\n");
  else for (const path of input.report.unchanged) deps.stdout.write(`  ${path}\n`);
  deps.stdout.write("Planned native commands:\n");
  for (const command of input.report.installCommands) deps.stdout.write(`  ${command}\n`);
  deps.stdout.write("Rollback commands:\n");
  for (const command of input.report.rollbackCommands) deps.stdout.write(`  ${command}\n`);
  deps.stdout.write(`Restart or reload ${input.harness === "claude-code" ? "Claude Code" : "Codex"} after installation to load the plugin. The first MCP connection will open Kintsugi browser sign-in.\n`);
}

function rollbackInstructions(report: Awaited<ReturnType<typeof applyClientSetup>>): string {
  return [
    "To roll back this Kintsugi plugin setup, run:",
    ...report.rollbackCommands.map((command) => `  ${command}`),
    `Then remove the generated package directory: ${report.artifactRoot}`,
  ].join("\n");
}

export function registerPluginsCommand(program: Command, deps: CliDeps): void {
  const plugins = program.command("plugins").description("Install the Kintsugi Coding Agent Workflow plugin");
  plugins.command("setup")
    .description("Generate and install a project-scoped plugin without signing in")
    .requiredOption("--harness <harness>", "Harness: claude-code or codex")
    .requiredOption("--url <canonical-url>", "Canonical Kintsugi installation URL")
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as { harness: string; url: string; project: string; profile?: string; json?: boolean; format?: string };
      if (!Object.hasOwn(HARNESS_TARGETS, options.harness)) {
        throw new CliError("PLUGIN_HARNESS_INVALID", "Harness must be claude-code or codex");
      }
      const baseUrl = validateInstallationUrl(options.url);
      if (typeof options.project !== "string") throw new CliError("PROJECT_REQUIRED", "Provide the Kintsugi project with --project <project-id>");
      const projectId = validateProjectId(options.project);
      if (options.profile !== undefined && !isProfileId(options.profile)) {
        throw new CliError("PROFILE_ID_INVALID", "Profile ID must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens");
      }
      if (deps.launcher === undefined || deps.getClientVersion === undefined || deps.runClientCommand === undefined) {
        throw new CliError("PLUGIN_SETUP_UNAVAILABLE", "This CLI cannot verify its local launcher and native client command runner");
      }

      const harness = options.harness as keyof typeof HARNESS_TARGETS;
      const target = HARNESS_TARGETS[harness];
      const profileId = options.profile ?? stableProjectProfileId(baseUrl, projectId);
      let clientVersion: string;
      try {
        clientVersion = await deps.getClientVersion(target);
      } catch {
        throw new CliError("PLUGIN_CLIENT_UNAVAILABLE", `Could not read the ${target} CLI version; install it or make it available on PATH`);
      }

      const config = await deps.profiles.load();
      const existing = config.profiles[profileId];
      const profile = { ...existing, id: profileId, baseUrl, projectId };
      const profileChanged = existing === undefined || existing.baseUrl !== baseUrl || existing.projectId !== projectId;
      const profileConfigPath = profileConfigPathFromEnv(deps.env, deps.cwd);
      const artifactRoot = join(dirname(profileConfigPath), "plugins", "coding-agent-workflow", safeProfileDirectory(profileId), harness);
      const changes = planClientSetup({ target, clientVersion, artifactRoot, ...deps.launcher, profileId });
      const report = await applyClientSetup(changes);

      if (profileChanged) {
        await deps.profiles.save({ ...config, profiles: { ...config.profiles, [profileId]: profile } });
      }

      const jsonOutput = options.json === true || options.format === "json";
      if (!jsonOutput) renderSetupPlan(deps, { harness, profileId, report });

      for (let index = 0; index < report.installSteps.length; index++) {
        const command = report.installSteps[index]!;
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

      if (jsonOutput) {
        const restartHint = `Restart or reload ${harness === "claude-code" ? "Claude Code" : "Codex"} to load the plugin.`;
        deps.stdout.write(`${JSON.stringify({ success: true, data: { ...report, harness, profileId, installed: true, restartHint } }, null, 2)}\n`);
        return;
      }
      deps.stdout.write("Plugin installation completed.\n");
    });
}
