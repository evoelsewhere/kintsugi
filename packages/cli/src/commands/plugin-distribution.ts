// Member plugins distributed by Kintsugi (ADR-0069, ADR-0072): list what the signed-in member may install in a project,
// install one into the clients they set up with `kintsugi init`, update it, or remove it. Each plugin becomes a plugin of
// its own in the client (so a command is `/modernize:build`). The files come from the installation, are checked against
// their hashes, and are written only into the Kintsugi-owned package, never into the client's own settings.

import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Command } from "commander";
import {
  applyClientSetup,
  clientVersionStatus,
  PLUGIN_STATE_PATH,
  planClientSetup,
  plannedMemberFiles,
  pruneStalePluginFiles,
  readPluginState,
  removeMemberPluginFolder,
  serializePluginState,
  withInstalledPlugin,
  withoutPlugin,
  type MemberPluginSetup,
} from "@kintsugi/harness-hub";
import type { PluginBundle } from "@kintsugi/harness-sdk";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";
import { HARNESS_TARGETS, artifactRootFor, assertWorkspace, clientPluginVersion, initializedHarnesses, normalizeHarness, readHarnessScope, runInstallSteps, type HarnessScope } from "./plugin-native.js";
import { apiFor, emit, projectId, selectedProfile, type CommandOptions } from "./shared.js";

type HarnessName = keyof typeof HARNESS_TARGETS;

const sha256 = (value: string): string => createHash("sha256").update(value, "utf8").digest("hex");

/** The hash a bundle must have: over the sorted paths and file hashes, as the API computes it. */
export function bundleContentHash(files: ReadonlyArray<{ path: string; sha256: string }>): string {
  return `sha256:${sha256(files.map((file) => `${file.path}:${file.sha256}`).join(";"))}`;
}

/** Every file must match its hash and the bundle its content hash before anything is written. */
export function verifyBundle(bundle: PluginBundle): void {
  for (const file of bundle.files) {
    if (sha256(file.content) !== file.sha256) throw new CliError("PLUGIN_BUNDLE_CORRUPT", `The downloaded file ${file.path} does not match its hash`);
  }
  if (bundleContentHash(bundle.files) !== bundle.contentHash) throw new CliError("PLUGIN_BUNDLE_CORRUPT", "The downloaded plugin does not match its content hash");
}

const LABELS: Record<HarnessName, string> = { "claude-code": "Claude Code", codex: "Codex", copilot: "GitHub Copilot" };

/** A client of a profile, checked once: the launcher, the client version, the package root and the scope it was set up with. */
interface Prepared {
  harness: HarnessName;
  target: (typeof HARNESS_TARGETS)[HarnessName];
  profileId: string;
  clientVersion: string;
  artifactRoot: string;
  scope: HarnessScope;
  launcher: NonNullable<CliDeps["launcher"]>;
}

async function prepare(deps: CliDeps, profileId: string, harness: HarnessName): Promise<Prepared> {
  const target = HARNESS_TARGETS[harness];
  if (deps.launcher === undefined) throw new CliError("PLUGIN_SETUP_UNAVAILABLE", "This CLI cannot verify its local Node launcher and installed CLI entrypoint");
  if (deps.getClientVersion === undefined || deps.runClientCommand === undefined) {
    throw new CliError("PLUGIN_SETUP_UNAVAILABLE", "This CLI cannot verify its native client version and command runner");
  }
  let clientVersion: string;
  try {
    clientVersion = await deps.getClientVersion(target);
  } catch {
    throw new CliError("PLUGIN_CLIENT_UNAVAILABLE", `Could not read the ${target} CLI version; install it or make it available on PATH`);
  }
  if (clientVersionStatus(target, clientVersion) === "untested") deps.stderr.write(`Note: ${LABELS[harness]} ${clientVersion} has not been tested with this Kintsugi release; continuing.\n`);
  const artifactRoot = artifactRootFor(deps, profileId, harness);
  const scope = await readHarnessScope(artifactRoot);
  assertWorkspace(deps, LABELS[harness], scope);
  return { harness, target, profileId, clientVersion, artifactRoot, scope, launcher: deps.launcher };
}

interface HarnessOptions {
  harness?: string;
  all?: boolean;
}

/** Which of the member's set-up clients a command acts on: the one named, all of them, the only one, or the ones chosen. */
async function chooseHarnesses(deps: CliDeps, command: Command, profileId: string, options: HarnessOptions, among?: (harness: HarnessName) => Promise<boolean>, everyone = false): Promise<HarnessName[]> {
  if (options.harness !== undefined) return [normalizeHarness(options.harness)];
  let ready = await initializedHarnesses(deps, profileId);
  if (among !== undefined) ready = (await Promise.all(ready.map(async (harness) => (await among(harness)) ? harness : undefined))).filter((harness): harness is HarnessName => harness !== undefined);
  if (ready.length === 0) throw new CliError("PLUGIN_HARNESS_REQUIRED", among === undefined ? "Set up a client first: kintsugi init" : "The plugin is not installed in any client you set up");
  if (options.all === true || everyone || ready.length === 1) return ready;
  const globals = command.optsWithGlobals() as CommandOptions & { input?: boolean };
  if (deps.choose !== undefined && deps.isTTY && globals.noInput !== true && globals.input !== false) {
    const picked = await deps.choose({
      message: "Which clients?",
      options: ready.map((harness) => ({ value: harness, label: LABELS[harness] })),
      multiple: true,
      defaults: ready,
    });
    return picked.map((value) => normalizeHarness(value));
  }
  throw new CliError("PLUGIN_HARNESS_REQUIRED", "More than one client is set up; choose one with -H claude or -H codex, or use --all");
}

function report(deps: CliDeps, command: Command, value: Record<string, unknown>, lines: string[]): void {
  const options = command.optsWithGlobals() as CommandOptions;
  if (options.json === true || options.format === "json") emit(deps, command, value);
  else deps.stdout.write(`${lines.join("\n")}\n`);
}

interface Installed {
  harness: HarnessName;
  files: number;
  skipped: number;
  status: "installed" | "updated" | "up-to-date";
  /** Something the member must do in the client before the plugin works fully. */
  note?: string;
}

/** Writes one plugin into the package of one client as a plugin of its own, and installs or updates it with the client's commands. */
async function installInto(deps: CliDeps, native: Prepared, bundle: PluginBundle, mode: "install" | "fetch"): Promise<Installed> {
  // What goes into the package depends on the client: a command becomes a skill where the client has no commands, an agent is left
  // out where it has no agents, and the clients whose hooks cover the whole plugin get a hook file Kintsugi generates.
  const files = bundle.files;
  const planned = plannedMemberFiles(native.target, Object.fromEntries(files.map((file) => [file.path, file.content])));
  const skipped = files.filter((file) => /^agents\//.test(file.path) && native.target === "codex").length;
  const state = await readPluginState(native.artifactRoot);
  const previous = state.plugins[bundle.name];
  if (mode === "fetch" && previous?.contentHash === bundle.contentHash && previous.version === bundle.version) return { harness: native.harness, files: files.length, skipped, status: "up-to-date" };

  const { state: next, stale } = withInstalledPlugin(state, bundle.name, {
    version: bundle.version,
    contentHash: bundle.contentHash,
    ...(bundle.description === undefined || bundle.description === "" ? {} : { description: bundle.description }),
    files: Object.keys(planned),
  });
  const members: MemberPluginSetup[] = Object.entries(next.plugins).map(([name, plugin]) => ({
    name,
    version: clientPluginVersion(plugin.version, plugin.contentHash),
    ...(plugin.description === undefined ? {} : { description: plugin.description }),
    ...(name === bundle.name ? { files: Object.fromEntries(files.map((file) => [file.path, file.content])), installed: previous !== undefined } : {}),
  }));
  const setup = await applyClientSetup(planClientSetup({
    target: native.target,
    clientVersion: native.clientVersion,
    artifactRoot: native.artifactRoot,
    ...native.launcher,
    profileId: native.profileId,
    scope: native.scope.scope,
    memberPlugins: members,
    stateFile: serializePluginState(next),
  }));
  await pruneStalePluginFiles(native.artifactRoot, native.target, bundle.name, stale);
  try { await runInstallSteps(deps, setup); } catch (error) {
    // The client did not take the plugin: the record must not say it is installed, or the next try would ask it to update.
    await writeFile(join(native.artifactRoot, PLUGIN_STATE_PATH), serializePluginState(state), "utf8");
    throw error;
  }
  // Codex runs a plugin's hook only after the member has reviewed it, and the review is the client's own (/hooks).
  const note = native.target === "codex" && planned["hooks/hooks.json"] !== undefined
    ? "Codex asks you to trust the Kintsugi reporting hook of this plugin once: open /hooks in Codex and trust it."
    : undefined;
  return { harness: native.harness, files: files.length - skipped, skipped, status: previous === undefined ? "installed" : "updated", ...(note === undefined ? {} : { note }) };
}

async function removeFrom(deps: CliDeps, native: Prepared, name: string): Promise<void> {
  const { state: next } = withoutPlugin(await readPluginState(native.artifactRoot), name);
  const members: MemberPluginSetup[] = Object.entries(next.plugins).map(([other, plugin]) => ({ name: other, version: clientPluginVersion(plugin.version, plugin.contentHash), ...(plugin.description === undefined ? {} : { description: plugin.description }) }));
  const setup = await applyClientSetup(planClientSetup({
    target: native.target,
    clientVersion: native.clientVersion,
    artifactRoot: native.artifactRoot,
    ...native.launcher,
    profileId: native.profileId,
    scope: native.scope.scope,
    memberPlugins: members,
    removePlugins: [name],
    stateFile: serializePluginState(next),
  }));
  await runInstallSteps(deps, setup);
  await removeMemberPluginFolder(native.artifactRoot, native.target, name);
}

const CLIENT_OPTION = "-H, --harness <client>";
const CLIENT_HELP = "claude, codex or copilot (default: the client you set up)";
const ALL_OPTION = "--all";
const ALL_HELP = "every client you set up with kintsugi init";

async function installAction(deps: CliDeps, command: Command, names: readonly string[] | undefined, mode: "install" | "fetch"): Promise<void> {
  const options = command.optsWithGlobals() as CommandOptions & HarnessOptions;
  const { profile } = await selectedProfile(deps, command);
  const project = projectId(options, profile.projectId);
  const { client } = await apiFor(deps, command);

  // `update` (`install fetch`) with no name updates every plugin installed in the chosen clients.
  let plugins = names ?? [];
  if (plugins.length === 0) {
    const installed = new Set<string>();
    for (const harness of options.harness === undefined ? await initializedHarnesses(deps, profile.id) : [normalizeHarness(options.harness)]) {
      for (const name of Object.keys((await readPluginState(artifactRootFor(deps, profile.id, harness))).plugins)) installed.add(name);
    }
    plugins = [...installed].sort();
    if (plugins.length === 0) { report(deps, command, { updated: [] }, ["No plugin is installed yet. Install one with: kintsugi install plugin <name> --all"]); return; }
  }

  const results: Array<{ plugin: string; version: string; installed: Installed[] }> = [];
  for (const name of plugins) {
    const harnesses = await chooseHarnesses(deps, command, profile.id, options, mode === "fetch"
      ? async (harness) => (await readPluginState(artifactRootFor(deps, profile.id, harness))).plugins[name] !== undefined
      : undefined, mode === "fetch");
    const bundle = await client.pluginBundle({ projectId: project, name });
    verifyBundle(bundle);
    const installed: Installed[] = [];
    for (const harness of harnesses) installed.push(await installInto(deps, await prepare(deps, profile.id, harness), bundle, mode));
    results.push({ plugin: bundle.name, version: bundle.version, installed });
  }

  const first = results[0]!;
  const lines = results.flatMap((result) => [
    ...result.installed.map((entry) => entry.status === "up-to-date"
      ? `${result.plugin} ${result.version} is up to date in ${LABELS[entry.harness]}.`
      : `${entry.status === "installed" ? "Installed" : "Updated"} ${result.plugin} ${result.version} for ${entry.harness} (${entry.files} files${entry.skipped > 0 ? `, ${entry.skipped} not supported by this client` : ""}).`),
  ]);
  for (const note of new Set(results.flatMap((result) => result.installed.map((entry) => entry.note).filter((entry): entry is string => entry !== undefined)))) lines.push(note);
  if (results.some((result) => result.installed.some((entry) => entry.status !== "up-to-date"))) lines.push("Start a new client session to load it.");
  report(deps, command, {
    plugin: first.plugin,
    version: first.version,
    harness: first.installed[0]?.harness,
    files: first.installed[0]?.files,
    skipped: first.installed[0]?.skipped,
    installed: true,
    plugins: results,
  }, lines);
}

/** `plugins list|install|remove`, and the short `add` and `remove` at the top level. */
export function registerPluginDistribution(plugins: Command, deps: CliDeps, names: { list?: string; install: string; remove: string } = { list: "list", install: "install", remove: "remove" }): void {
  if (names.list !== undefined) plugins.command(names.list)
    .description("List the member plugins you may install in the project, and which are installed")
    .option("--project <id>", "Project id")
    .option(CLIENT_OPTION, CLIENT_HELP)
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as CommandOptions & HarnessOptions;
      const { client, profile } = await apiFor(deps, this);
      const available = await client.listPlugins({ projectId: projectId(options, profile.projectId) });
      const harnesses = options.harness === undefined ? await initializedHarnesses(deps, profile.id) : [normalizeHarness(options.harness)];
      const installed = new Map<string, { version: string; harnesses: HarnessName[] }>();
      for (const harness of harnesses) {
        for (const [name, plugin] of Object.entries((await readPluginState(artifactRootFor(deps, profile.id, harness))).plugins)) {
          const entry = installed.get(name) ?? { version: plugin.version, harnesses: [] };
          entry.harnesses.push(harness);
          installed.set(name, entry);
        }
      }
      const items = available.items.map((item) => ({ ...item, installed: installed.get(item.name)?.version ?? null, installedIn: installed.get(item.name)?.harnesses ?? [] }));
      report(deps, this, { harnesses, items }, items.length === 0 ? ["No member plugins are available to you in this project."] : items.map((item) => `${item.name} ${item.version} — ${item.title}${item.installed === null ? "" : ` (installed ${item.installed} in ${item.installedIn.join(", ")})`}`));
    });

  plugins.command(`${names.install} <name>`)
    .description("Install or update a member plugin for your AI client")
    .option(CLIENT_OPTION, CLIENT_HELP)
    .option(ALL_OPTION, ALL_HELP)
    .option("--project <id>", "Project id")
    .action(async function(this: Command, name: string) { await installAction(deps, this, [name], "install"); });

  plugins.command(`${names.remove} <name>`)
    .description("Remove a member plugin from your AI client")
    .option(CLIENT_OPTION, CLIENT_HELP)
    .option(ALL_OPTION, ALL_HELP)
    .action(async function(this: Command, name: string) {
      const options = this.optsWithGlobals() as CommandOptions & HarnessOptions;
      const { profile } = await selectedProfile(deps, this);
      const harnesses = await chooseHarnesses(deps, this, profile.id, options, options.harness === undefined
        ? async (harness) => (await readPluginState(artifactRootFor(deps, profile.id, harness))).plugins[name] !== undefined
        : undefined);
      for (const harness of harnesses) await removeFrom(deps, await prepare(deps, profile.id, harness), name);
      report(deps, this, { plugin: name, harnesses, removed: true, harness: harnesses[0] }, [...harnesses.map((harness) => `Removed ${name} from ${harness}.`), "Start a new client session to unload it."]);
    });
}

/** Options and action of `kintsugi update [name]` and its alias `kintsugi install fetch [name]`. */
function updateCommand(command: Command, deps: CliDeps): Command {
  return command
    .option(CLIENT_OPTION, CLIENT_HELP)
    .option(ALL_OPTION, ALL_HELP)
    .option("--project <id>", "Project id")
    .action(async function(this: Command, name: string | undefined) { await installAction(deps, this, name === undefined ? undefined : [name], "fetch"); });
}

/**
 * `kintsugi install plugin <name>` puts a plugin into the clients; `kintsugi update [name]` brings installed plugins
 * up to date, and `kintsugi install fetch [name]` is kept as its alias.
 */
export function registerInstallCommands(program: Command, deps: CliDeps): void {
  const install = program.command("install").description("Install plugins into the AI clients you set up (update them with kintsugi update)");
  install.command("plugin <name>")
    .description("Install a plugin your project offers (add --all for every client you set up)")
    .option(CLIENT_OPTION, CLIENT_HELP)
    .option(ALL_OPTION, ALL_HELP)
    .option("--project <id>", "Project id")
    .action(async function(this: Command, name: string) { await installAction(deps, this, [name], "install"); });
  updateCommand(install.command("fetch [name]").description("Alias of kintsugi update"), deps);
  updateCommand(
    program.command("update [plugin]").description("Bring an installed plugin up to date (every installed plugin when no name is given)"),
    deps,
  );
}
