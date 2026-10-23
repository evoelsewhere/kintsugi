import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Command } from "commander";
import { applyClientSetup, planClientSetup, stageCodexDesktopPlugin, type SetupReport } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { registerPluginDistribution } from "./plugin-distribution.js";
import { HARNESS_TARGETS, normalizeHarness, runInstallSteps, safeProfileDirectory } from "./plugin-native.js";
import { CliError, defaultInstallationUrl, isProfileId, profileConfigPathFromEnv, validateInstallationUrl } from "../profile.js";

function stableProjectProfileId(baseUrl: string, projectId: string): string {
  const identity = `${baseUrl}\0${projectId}`;
  return `kintsugi-${createHash("sha256").update(identity, "utf8").digest("hex").slice(0, 12)}`;
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

export interface SetupOptions {
  harness: string;
  installMode: string;
  url: string;
  project: string | undefined;
  profile?: string;
  json?: boolean;
  format?: string;
  /** Print the files written and the native commands, not just the result. */
  verbose?: boolean;
}

/** Writes the Kintsugi connector package of a client and installs it with the client's own plugin commands. */
export async function runSetup(deps: CliDeps, options: SetupOptions): Promise<void> {
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
  const becomesActive = config.activeProfile === undefined;
  const profileChanged = existing === undefined || existing.baseUrl !== baseUrl || existing.projectId !== projectId || becomesActive;
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
      await deps.profiles.save({ ...config, ...(becomesActive ? { activeProfile: profileId } : {}), profiles: { ...config.profiles, [profileId]: profile } });
    } catch (error) {
      if (options.installMode === "desktop-ui") {
        throw new CliError("PLUGIN_PROFILE_SAVE_FAILED", `The marketplace package is staged at ${report.pluginRoot}, but the Kintsugi profile could not be saved. Do not install the plugin yet; fix profile storage and rerun this setup. ${(error as Error).message}`);
      }
      throw error;
    }
  }

  const jsonOutput = options.json === true || options.format === "json";
  if (!jsonOutput && options.verbose === true) renderSetupPlan(deps, { harness, profileId, report });

  await runInstallSteps(deps, report);

  if (jsonOutput) {
    const desktopUi = report.installationMode === "desktop-ui";
    const restartHint = desktopUi
      ? "Restart Codex Desktop, then install the staged plugin from Plugins → Plugins Directory → Kintsugi personal marketplace."
      : `Restart or reload ${harness === "claude-code" ? "Claude Code" : "Codex"} to load the plugin.`;
    deps.stdout.write(`${JSON.stringify({ success: true, data: { ...report, harness, profileId, installed: !desktopUi, staged: desktopUi, restartHint } }, null, 2)}\n`);
    return;
  }
  if (options.verbose === true) {
    deps.stdout.write(report.installationMode === "desktop-ui" ? "Codex Desktop marketplace package prepared; install it from the Codex app to finish.\n" : "Plugin installation completed.\n");
    return;
  }
  const client = harness === "claude-code" ? "Claude Code" : report.installationMode === "desktop-ui" ? "Codex Desktop" : "Codex";
  deps.stdout.write(report.installationMode === "desktop-ui"
    ? `Prepared ${client} for project ${projectId}. Restart it, then install Kintsugi from Plugins \u2192 Plugins Directory.\n`
    : `Connected ${client} to project ${projectId}. Restart it to load Kintsugi; the first use opens browser sign-in.\n`);
}

/** The names a member types for the clients: `claude`, `codex`, and `codex-desktop` for the app. */
function clientOf(value: string): { harness: string; installMode: string } {
  if (value === "codex-desktop") return { harness: "codex", installMode: "desktop-ui" };
  return { harness: normalizeHarness(value), installMode: "native-cli" };
}

export function registerPluginsCommand(program: Command, deps: CliDeps): void {
  program.command("connect <client> [project]")
    .description("Connect your AI client (claude, codex or codex-desktop) to a Kintsugi project")
    .option("--url <url>", "Kintsugi installation URL (default: the one this CLI was installed from)")
    .option("--verbose", "Print the files written and the native commands")
    .action(async function(this: Command, client: string, project: string | undefined) {
      const options = this.optsWithGlobals() as { url?: string; project?: string; profile?: string; json?: boolean; format?: string; verbose?: boolean };
      const config = await deps.profiles.load();
      const url = options.url ?? await defaultInstallationUrl(deps.env, deps.launcher?.cliEntrypointPath, config.profiles[config.activeProfile ?? ""]?.baseUrl);
      if (url === undefined) throw new CliError("URL_REQUIRED", "Pass the installation URL with --url <url>; the installer records it for a CLI installed from the installation");
      await runSetup(deps, { ...options, ...clientOf(client), url, project: project ?? options.project });
    });

  const plugins = program.command("plugins").description("Install the Kintsugi connector and the member plugins Kintsugi distributes");
  plugins.command("setup")
    .description("Prepare or install the project-scoped Kintsugi connector plugin (the long form of connect)")
    .option("--install-mode <mode>", "Install mode: native-cli or desktop-ui", "native-cli")
    .requiredOption("--harness <harness>", "Harness: claude-code or codex")
    .requiredOption("--url <canonical-url>", "Canonical Kintsugi installation URL")
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as SetupOptions;
      await runSetup(deps, { ...options, verbose: true });
    });
  registerPluginDistribution(plugins, deps);
  // The short forms: `kintsugi add context`, `kintsugi remove context`.
  registerPluginDistribution(program, deps, { install: "add", remove: "remove" });
}
