import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Command } from "commander";
import { applyClientSetup, planClientSetup, stageCodexDesktopPlugin, type HarnessClient, type SetupReport } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { CliError, isProfileId, profileConfigPathFromEnv, validateInstallationUrl } from "../profile.js";

const HARNESS_TARGETS = {
  "claude-code": "claude",
  codex: "codex",
} as const satisfies Record<string, HarnessClient>;

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

function renderSetupPlan(deps: CliDeps, input: { harness: string; profileId: string; report: SetupReport }): void {
  deps.stdout.write(`Harness: ${input.harness}; Kintsugi profile: ${input.profileId}\n`);
  deps.stdout.write(`Generated package: ${input.report.pluginRoot}\n`);
  deps.stdout.write("Package files created or updated:\n");
  if (input.report.written.length === 0) deps.stdout.write("  No package files needed changes.\n");
  else for (const path of input.report.written) deps.stdout.write(`  ${path}\n`);
  deps.stdout.write("Package files unchanged:\n");
  if (input.report.unchanged.length === 0) deps.stdout.write("  (none)\n");
  else for (const path of input.report.unchanged) deps.stdout.write(`  ${path}\n`);
  if (input.report.installationMode === "desktop-ui") {
    deps.stdout.write(`Codex personal marketplace: ${input.report.marketplacePath ?? join(input.report.artifactRoot, "marketplace.json")}\n`);
    deps.stdout.write("Prepared for Codex Desktop; not installed yet.\n");
    deps.stdout.write("Next: Restart Codex Desktop. Open Plugins → Plugins Directory, select the local Kintsugi marketplace, review and install the plugin.\n");
    deps.stdout.write("In a new local conversation, the first MCP request opens Kintsugi browser sign-in.\n");
    return;
  }
  deps.stdout.write("Planned native commands:\n");
  for (const command of input.report.installCommands) deps.stdout.write(`  ${command}\n`);
  deps.stdout.write("Rollback commands:\n");
  for (const command of input.report.rollbackCommands) deps.stdout.write(`  ${command}\n`);
  deps.stdout.write(`Restart or reload ${input.harness === "claude-code" ? "Claude Code" : "Codex"} after installation to load the plugin. The first MCP connection will open Kintsugi browser sign-in.\n`);
}

function rollbackInstructions(report: SetupReport): string {
  return [
    "To roll back this Kintsugi plugin setup, run:",
    ...report.rollbackCommands.map((command) => `  ${command}`),
    `Then remove the generated package directory: ${report.artifactRoot}`,
  ].join("\n");
}

export function registerPluginsCommand(program: Command, deps: CliDeps): void {
  const plugins = program.command("plugins").description("Install the Kintsugi connector plugin");
  plugins.command("setup")
    .description("Prepare or install the project-scoped Kintsugi connector plugin")
    .option("--install-mode <mode>", "Install mode: native-cli or desktop-ui", "native-cli")
    .requiredOption("--harness <harness>", "Harness: claude-code or codex")
    .requiredOption("--url <canonical-url>", "Canonical Kintsugi installation URL")
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as { harness: string; url: string; project: string; profile?: string; installMode: string; json?: boolean; format?: string };
      if (!Object.hasOwn(HARNESS_TARGETS, options.harness)) {
        throw new CliError("PLUGIN_HARNESS_INVALID", "Harness must be claude-code or codex");
      }
      if (options.installMode !== "native-cli" && options.installMode !== "desktop-ui") {
        throw new CliError("PLUGIN_INSTALL_MODE_INVALID", "Install mode must be native-cli or desktop-ui");
      }
      if (options.installMode === "desktop-ui" && options.harness !== "codex") {
        throw new CliError("PLUGIN_INSTALL_MODE_UNSUPPORTED", "The desktop-ui install mode currently supports Codex Desktop only");
      }
      const baseUrl = validateInstallationUrl(options.url);
      if (typeof options.project !== "string") throw new CliError("PROJECT_REQUIRED", "Provide the Kintsugi project with --project <project-id>");
      const projectId = validateProjectId(options.project);
      if (options.profile !== undefined && !isProfileId(options.profile)) {
        throw new CliError("PROFILE_ID_INVALID", "Profile ID must start with a letter or number and contain only letters, numbers, dots, underscores, or hyphens");
      }
      if (deps.launcher === undefined) {
        throw new CliError("PLUGIN_SETUP_UNAVAILABLE", "This CLI cannot verify its local Node launcher and installed CLI entrypoint");
      }

      const harness = options.harness as keyof typeof HARNESS_TARGETS;
      const target = HARNESS_TARGETS[harness];
      const profileId = options.profile ?? stableProjectProfileId(baseUrl, projectId);
      const config = await deps.profiles.load();
      const existing = config.profiles[profileId];
      const profile = { ...existing, id: profileId, baseUrl, projectId };
      const profileChanged = existing === undefined || existing.baseUrl !== baseUrl || existing.projectId !== projectId;
      const profileConfigPath = profileConfigPathFromEnv(deps.env, deps.cwd);
      let report: SetupReport;
      if (options.installMode === "desktop-ui") {
        report = await stageCodexDesktopPlugin({
          ...deps.launcher,
          profileId,
          pluginDisplayName: `Kintsugi Workflow · ${projectId.slice(0, 48)}`,
          homeDir: deps.homeDir ?? homedir(),
        });
      } else {
        if (deps.getClientVersion === undefined || deps.runClientCommand === undefined) {
          throw new CliError("PLUGIN_SETUP_UNAVAILABLE", "This CLI cannot verify its native client version and command runner");
        }
        let clientVersion: string;
        try {
          clientVersion = await deps.getClientVersion(target);
        } catch {
          throw new CliError("PLUGIN_CLIENT_UNAVAILABLE", `Could not read the ${target} CLI version; install it or make it available on PATH`);
        }
        const artifactRoot = join(dirname(profileConfigPath), "plugins", "connector", safeProfileDirectory(profileId), harness);
        report = await applyClientSetup(planClientSetup({ target, clientVersion, artifactRoot, ...deps.launcher, profileId }));
      }

      if (profileChanged) {
        try {
          await deps.profiles.save({ ...config, profiles: { ...config.profiles, [profileId]: profile } });
        } catch (error) {
          if (options.installMode === "desktop-ui") {
            throw new CliError("PLUGIN_PROFILE_SAVE_FAILED", `The marketplace package is staged at ${report.pluginRoot}, but the Kintsugi profile could not be saved. Do not install the plugin yet; fix profile storage and rerun this setup. ${(error as Error).message}`);
          }
          throw error;
        }
      }

      const jsonOutput = options.json === true || options.format === "json";
      if (!jsonOutput) renderSetupPlan(deps, { harness, profileId, report });

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

      if (jsonOutput) {
        const desktopUi = report.installationMode === "desktop-ui";
        const restartHint = desktopUi
          ? "Restart Codex Desktop, then install the staged plugin from Plugins → Plugins Directory → Kintsugi personal marketplace."
          : `Restart or reload ${harness === "claude-code" ? "Claude Code" : "Codex"} to load the plugin.`;
        deps.stdout.write(`${JSON.stringify({ success: true, data: { ...report, harness, profileId, installed: !desktopUi, staged: desktopUi, restartHint } }, null, 2)}\n`);
        return;
      }
      deps.stdout.write(report.installationMode === "desktop-ui" ? "Codex Desktop marketplace package prepared; install it from the Codex app to finish.\n" : "Plugin installation completed.\n");
    });
}
