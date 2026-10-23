// Member plugins distributed by Kintsugi (ADR-0069): list what the signed-in member may install in a project, install
// one into the Kintsugi package of a client, or remove it again. The files come from the installation, are checked
// against their hashes, and are written only into the Kintsugi-owned package, never into the client's own settings.

import { createHash } from "node:crypto";
import type { Command } from "commander";
import {
  applyClientSetup,
  planClientSetup,
  pruneStalePluginFiles,
  readPluginState,
  serializePluginState,
  withInstalledPlugin,
  withoutPlugin,
  type SetupReport,
} from "@kintsugi/harness-hub";
import type { PluginBundle } from "@kintsugi/harness-sdk";
import type { CliDeps } from "../cli.js";
import { CliError } from "../profile.js";
import { HARNESS_TARGETS, artifactRootFor, detectHarness, normalizeHarness, runInstallSteps } from "./plugin-native.js";
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

/** Everything a native package change needs, checked once: the launcher, the client version and the package root. */
async function nativePackage(deps: CliDeps, command: Command, harnessValue: string | undefined): Promise<{
  harness: HarnessName;
  target: (typeof HARNESS_TARGETS)[HarnessName];
  profileId: string;
  clientVersion: string;
  artifactRoot: string;
  launcher: NonNullable<CliDeps["launcher"]>;
}> {
  const { profile } = await selectedProfile(deps, command);
  const harness = harnessValue === undefined ? await detectHarness(deps, profile.id) : normalizeHarness(harnessValue);
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
  const artifactRoot = artifactRootFor(deps, profile.id, harness);
  return { harness, target, profileId: profile.id, clientVersion, artifactRoot, launcher: deps.launcher };
}

function report(deps: CliDeps, command: Command, value: Record<string, unknown>, lines: string[]): void {
  const options = command.optsWithGlobals() as CommandOptions;
  if (options.json === true || options.format === "json") emit(deps, command, value);
  else deps.stdout.write(`${lines.join("\n")}\n`);
}

const CLIENT_OPTION = "-H, --harness <client>";
const CLIENT_HELP = "claude or codex (default: the client you connected)";

/** `plugins list|install|remove`, and the short `add` and `remove` at the top level. */
export function registerPluginDistribution(plugins: Command, deps: CliDeps, names: { list?: string; install: string; remove: string } = { list: "list", install: "install", remove: "remove" }): void {
  if (names.list !== undefined) plugins.command(names.list)
    .description("List the member plugins you may install in the project, and which are installed")
    .option("--project <id>", "Project id")
    .option(CLIENT_OPTION, CLIENT_HELP)
    .action(async function(this: Command) {
      const options = this.optsWithGlobals() as CommandOptions & { harness?: string };
      const { client, profile } = await apiFor(deps, this);
      const available = await client.listPlugins({ projectId: projectId(options, profile.projectId) });
      const harness = options.harness === undefined ? await detectHarness(deps, profile.id).catch(() => undefined) : normalizeHarness(options.harness);
      const installed = harness === undefined ? {} : (await readPluginState(artifactRootFor(deps, profile.id, harness))).plugins;
      const items = available.items.map((item) => ({ ...item, installed: installed[item.name]?.version ?? null }));
      report(deps, this, { harness, items }, items.length === 0 ? ["No member plugins are available to you in this project."] : items.map((item) => `${item.name} ${item.version} — ${item.title}${item.installed === null ? "" : ` (installed ${item.installed})`}`));
    });

  plugins.command(`${names.install} <name>`)
    .description("Install or update a member plugin for your AI client")
    .option(CLIENT_OPTION, CLIENT_HELP)
    .option("--project <id>", "Project id")
    .action(async function(this: Command, name: string) {
      const options = this.optsWithGlobals() as CommandOptions & { harness?: string };
      const native = await nativePackage(deps, this, options.harness);
      const { client, profile } = await apiFor(deps, this);
      const bundle = await client.pluginBundle({ projectId: projectId(options, profile.projectId), name });
      verifyBundle(bundle);
      // Codex reads skills only; agents and commands of the plugin stay out of its package.
      const files = bundle.files.filter((file) => native.target !== "codex" || file.path.startsWith("skills/"));
      const skipped = bundle.files.length - files.length;
      const { state, stale } = withInstalledPlugin(await readPluginState(native.artifactRoot), bundle.name, {
        version: bundle.version,
        contentHash: bundle.contentHash,
        files: files.map((file) => file.path),
      });
      const setup: SetupReport = await applyClientSetup(planClientSetup({
        target: native.target,
        clientVersion: native.clientVersion,
        artifactRoot: native.artifactRoot,
        ...native.launcher,
        profileId: native.profileId,
        extraFiles: Object.fromEntries(files.map((file) => [file.path, file.content])),
        stateFile: serializePluginState(state),
      }));
      await pruneStalePluginFiles(native.artifactRoot, native.target, stale);
      await runInstallSteps(deps, setup);
      report(deps, this, { plugin: bundle.name, version: bundle.version, harness: native.harness, files: files.length, skipped, installed: true }, [
        `Installed ${bundle.name} ${bundle.version} for ${native.harness} (${files.length} files${skipped > 0 ? `, ${skipped} not supported by this client` : ""}).`,
        "Start a new client session to load it.",
      ]);
    });

  plugins.command(`${names.remove} <name>`)
    .description("Remove a member plugin from your AI client")
    .option(CLIENT_OPTION, CLIENT_HELP)
    .action(async function(this: Command, name: string) {
      const options = this.optsWithGlobals() as CommandOptions & { harness?: string };
      const native = await nativePackage(deps, this, options.harness);
      const { state, stale } = withoutPlugin(await readPluginState(native.artifactRoot), name);
      const setup: SetupReport = await applyClientSetup(planClientSetup({
        target: native.target,
        clientVersion: native.clientVersion,
        artifactRoot: native.artifactRoot,
        ...native.launcher,
        profileId: native.profileId,
        stateFile: serializePluginState(state),
      }));
      await pruneStalePluginFiles(native.artifactRoot, native.target, stale);
      await runInstallSteps(deps, setup);
      report(deps, this, { plugin: name, harness: native.harness, removed: true }, [`Removed ${name} from ${native.harness}.`, "Start a new client session to unload it."]);
    });
}
