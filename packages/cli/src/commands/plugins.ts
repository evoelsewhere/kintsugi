import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import type { Command } from "commander";
import { applyClientSetup, clientVersionStatus, planClientSetup, readPluginState, stageCodexDesktopPlugin, type InstallScope, type SetupReport } from "@kintsugi/harness-hub";
import type { CliDeps } from "../cli.js";
import { registerInstallCommands, registerPluginDistribution } from "./plugin-distribution.js";
import { HARNESS_TARGETS, clientPluginVersion, normalizeHarness, runInstallSteps, safeProfileDirectory, writeHarnessScope } from "./plugin-native.js";
import { oauthFor } from "../oauth.js";
import { CliError, defaultInstallationUrl, isProfileId, profileConfigPathFromEnv, stableProjectProfileId, validateInstallationUrl } from "../profile.js";

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
  /** Where the client installs plugins (Claude Code: user, project or local). */
  scope?: InstallScope;
  /** Say nothing about the result; the caller prints its own summary. */
  quiet?: boolean;
}

/** Writes the Kintsugi connector package of a client and installs it with the client's own plugin commands. */
export async function runSetup(deps: CliDeps, options: SetupOptions): Promise<void> {
  if (!Object.hasOwn(HARNESS_TARGETS, options.harness)) {
    throw new CliError("PLUGIN_HARNESS_INVALID", "Harness must be claude-code, codex or copilot");
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
    // Clients update often; another version than the one this release was probed with goes ahead, with a note (ADR-0072).
    if (clientVersionStatus(target, clientVersion) === "untested") deps.stderr.write(`Note: ${target} ${clientVersion} has not been tested with this Kintsugi release; continuing.\n`);
    // Setting a client up again must not drop the plugins already installed from the package's marketplace.
    const installed = Object.entries((await readPluginState(artifactRoot)).plugins).map(([name, plugin]) => ({ name, version: clientPluginVersion(plugin.version, plugin.contentHash), ...(plugin.description === undefined ? {} : { description: plugin.description }) }));
    report = await applyClientSetup(planClientSetup({ target, clientVersion, artifactRoot, ...deps.launcher, profileId, ...(options.scope === undefined ? {} : { scope: options.scope }), ...(installed.length === 0 ? {} : { memberPlugins: installed }) }));
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
  if (options.installMode === "native-cli") {
    await writeHarnessScope(report.artifactRoot, { scope: options.scope ?? "user", ...(options.scope === undefined || options.scope === "user" ? {} : { workspace: deps.cwd }) });
  }
  if (options.quiet === true) return;

  if (jsonOutput) {
    const desktopUi = report.installationMode === "desktop-ui";
    const restartHint = desktopUi
      ? "Restart Codex Desktop, then install the staged plugin from Plugins → Plugins Directory → Kintsugi personal marketplace."
      : `Restart or reload ${harness === "claude-code" ? "Claude Code" : harness === "copilot" ? "GitHub Copilot" : "Codex"} to load the plugin.`;
    deps.stdout.write(`${JSON.stringify({ success: true, data: { ...report, harness, profileId, installed: !desktopUi, staged: desktopUi, restartHint } }, null, 2)}\n`);
    return;
  }
  if (options.verbose === true) {
    deps.stdout.write(report.installationMode === "desktop-ui" ? "Codex Desktop marketplace package prepared; install it from the Codex app to finish.\n" : "Plugin installation completed.\n");
    return;
  }
  const client = harness === "claude-code" ? "Claude Code" : harness === "copilot" ? "GitHub Copilot" : report.installationMode === "desktop-ui" ? "Codex Desktop" : "Codex";
  deps.stdout.write(report.installationMode === "desktop-ui"
    ? `Prepared ${client} for project ${projectId}. Restart it, then install Kintsugi from Plugins \u2192 Plugins Directory.\n`
    : `Connected ${client} to project ${projectId}. Restart it to load Kintsugi; the first use opens browser sign-in.\n`);
}

/** The names a member types for the clients: `claude`, `codex`, and `codex-desktop` for the app. */
function clientOf(value: string): { harness: string; installMode: string } {
  if (value === "codex-desktop") return { harness: "codex", installMode: "desktop-ui" };
  return { harness: normalizeHarness(value), installMode: "native-cli" };
}

interface ClientChoice {
  /** The name a member types: claude, codex or codex-desktop. */
  id: "claude" | "codex" | "codex-desktop" | "copilot";
  label: string;
  detail: string;
}

/** The AI clients on this machine that Kintsugi can set up, found by asking each for its version. */
async function findClients(deps: CliDeps): Promise<{ found: ClientChoice[]; unsupported: string[] }> {
  const found: ClientChoice[] = [];
  const unsupported: string[] = [];
  const version = async (target: "claude" | "codex" | "copilot"): Promise<string | undefined> => {
    try { return await deps.getClientVersion?.(target); } catch { return undefined; }
  };
  const claude = await version("claude");
  if (claude !== undefined) found.push({ id: "claude", label: "Claude Code", detail: claude });
  const codex = await version("codex");
  if (codex !== undefined) found.push({ id: "codex", label: "Codex CLI", detail: codex });
  const home = deps.homeDir ?? homedir();
  if (await stat(join(home, ".codex")).then(() => true, () => false)) found.push({ id: "codex-desktop", label: "Codex Desktop", detail: "app" });
  const copilot = await version("copilot");
  if (copilot !== undefined) found.push({ id: "copilot", label: "GitHub Copilot CLI", detail: copilot });
  return { found, unsupported };
}

const SCOPES = { global: "user", workspace: "local" } as const;

/** `kintsugi init`: find the clients, ask which to set up and whether globally or for this workspace, and connect them. */
async function runInit(deps: CliDeps, command: Command, projectArgument: string | undefined): Promise<void> {
  const options = command.optsWithGlobals() as { url?: string; project?: string; profile?: string; json?: boolean; format?: string; verbose?: boolean; harness?: string; all?: boolean; scope?: string; yes?: boolean; noInput?: boolean; input?: boolean };
  const interactive = deps.choose !== undefined && deps.isTTY && options.yes !== true && options.noInput !== true && options.input !== false;
  const config = await deps.profiles.load();
  const active = config.profiles[options.profile ?? config.activeProfile ?? ""];
  const url = options.url ?? await defaultInstallationUrl(deps.env, deps.launcher?.cliEntrypointPath, active?.baseUrl);
  if (url === undefined) throw new CliError("URL_REQUIRED", "Pass the installation URL with --url <url>; the installer records it for a CLI installed from the installation");
  const baseUrl = validateInstallationUrl(url);
  const project = projectArgument ?? options.project ?? active?.projectId;
  if (project === undefined) throw new CliError("PROJECT_REQUIRED", "Say which project: kintsugi login <project>, then kintsugi init");
  const profileId = options.profile ?? stableProjectProfileId(baseUrl, project);

  // Which clients.
  const { found, unsupported } = await findClients(deps);
  let chosen: string[];
  if (options.harness !== undefined) chosen = options.harness.split(",").map((value) => value.trim()).filter((value) => value !== "");
  else if (found.length === 0) throw new CliError("PLUGIN_CLIENT_UNAVAILABLE", `No supported AI client was found on this machine (Claude Code, Codex)${unsupported.length === 0 ? "" : `; ${unsupported.join(", ")} is not supported yet`}`);
  else if (options.all === true || found.length === 1 || !interactive) chosen = found.map((client) => client.id);
  else chosen = await deps.choose!({ message: "Which AI clients should Kintsugi set up?", options: found.map((client) => ({ value: client.id, label: client.label, hint: client.detail })), multiple: true, defaults: found.map((client) => client.id) });
  const clients = chosen.map((value) => {
    if (value !== "claude" && value !== "codex" && value !== "codex-desktop" && value !== "copilot") throw new CliError("PLUGIN_HARNESS_INVALID", "The client must be claude, codex, codex-desktop or copilot");
    return value;
  });

  // Where: for every workspace, or only this one.
  let where: "global" | "workspace" = "global";
  if (options.scope !== undefined) {
    if (options.scope !== "global" && options.scope !== "workspace") throw new CliError("SCOPE_INVALID", "Scope must be global or workspace");
    where = options.scope;
  } else if (interactive && clients.includes("claude")) {
    const [answer] = await deps.choose!({
      message: "Install for all your workspaces, or only for this one?",
      options: [{ value: "global", label: "Global", hint: "every workspace" }, { value: "workspace", label: "This workspace", hint: deps.cwd }],
      multiple: false,
      defaults: ["global"],
    });
    where = answer === "workspace" ? "workspace" : "global";
  }

  const outcomes: string[] = [];
  for (const client of clients) {
    const workspaceScoped = where === "workspace" && client === "claude";
    if (where === "workspace" && client !== "claude") deps.stderr.write(`Note: ${client} has no per-workspace install; set up globally.\n`);
    await runSetup(deps, { ...options, ...clientOf(client), url: baseUrl, project, profile: profileId, scope: SCOPES[workspaceScoped ? "workspace" : "global"], quiet: true, verbose: options.verbose === true });
    outcomes.push(`${client === "claude" ? "Claude Code" : client === "codex" ? "Codex CLI" : client === "copilot" ? "GitHub Copilot CLI" : "Codex Desktop"} — ${workspaceScoped ? `workspace ${deps.cwd}` : "global"}${client === "codex-desktop" ? " (finish in the app: Plugins → Plugins Directory)" : ""}`);
  }

  // The project becomes the active one, and the member signs in now when this is a terminal: the first use would ask anyway.
  const saved = await deps.profiles.load();
  saved.activeProfile = profileId;
  await deps.profiles.save(saved);
  let signedIn = (await deps.credentials.get(profileId)) !== undefined;
  if (!signedIn && interactive) {
    try {
      await oauthFor(deps).beginBrowserLogin(saved.profiles[profileId]!, project);
      signedIn = true;
    } catch (error) {
      deps.stderr.write(`Sign-in did not finish (${error instanceof Error ? error.message : "cancelled"}); run: kintsugi login ${project}\n`);
    }
  }

  const lines = [`Kintsugi is set up for project ${project}:`, ...outcomes.map((line) => `  ✓ ${line}`), signedIn ? "  ✓ signed in" : `  · not signed in yet: run kintsugi login ${project} (or your AI client opens the browser on first use)`, "", "Next: kintsugi plugins list, then kintsugi install plugin <name> --all", "Restart your AI client to load Kintsugi."];
  if (options.json === true || options.format === "json") deps.stdout.write(`${JSON.stringify({ success: true, data: { project, profileId, clients: clients, scope: where, signedIn } }, null, 2)}\n`);
  else deps.stdout.write(`${lines.join("\n")}\n`);
}

export function registerPluginsCommand(program: Command, deps: CliDeps): void {
  program.command("init [project]")
    .description("Set up your AI clients for Kintsugi: choose the clients found on this machine, and global or this workspace")
    .option("--url <url>", "Kintsugi installation URL (default: the one this CLI was installed from)")
    .option("-H, --harness <clients>", "Clients to set up, comma separated: claude, codex, codex-desktop (default: choose)")
    .option("--all", "Set up every client found, without asking")
    .option("--scope <scope>", "global (every workspace) or workspace (this folder only; Claude Code)")
    .option("-y, --yes", "Accept the defaults without asking")
    .option("--verbose", "Print the files written and the native commands")
    .action(async function(this: Command, project: string | undefined) { await runInit(deps, this, project); });

  program.command("connect <client> [project]")
    .description("Connect one AI client (claude, codex or codex-desktop) to a Kintsugi project (the short form of init -H)")
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
  // The short forms: `kintsugi add modernize`, `kintsugi remove modernize`, and `kintsugi install plugin|fetch`.
  registerPluginDistribution(program, deps, { install: "add", remove: "remove" });
  registerInstallCommands(program, deps);
}
