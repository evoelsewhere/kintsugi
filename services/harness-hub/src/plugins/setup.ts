import { lstat, mkdir, open, readFile, rename, rm, rmdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { assertClientCompatibility, versionAtLeast } from "./compatibility.js";
import { KINTSUGI_PLUGIN_NAME, clientPluginName, generateConnectorPlugin, generateMemberPlugin, PluginSetupError, type ConnectorPluginInput, type HarnessClient } from "./generate.js";

/** Where the client installs the plugins: for the user everywhere, or only for the workspace the command runs in. */
export type InstallScope = "user" | "project" | "local";

/** A member plugin of the package. `files` are given when the plugin is installed or updated now; a plugin already on disk needs none. */
export interface MemberPluginSetup {
  /** The plugin's name in Kintsugi. */
  name: string;
  version: string;
  description?: string;
  files?: Record<string, string>;
  /** The plugin is installed in the client already: update it instead of installing it. */
  installed?: boolean;
}

export interface SetupInput extends ConnectorPluginInput {
  clientVersion: string;
  /** Installation scope of the client's plugin commands (Claude Code: user, project or local; the other clients ignore it). */
  scope?: InstallScope;
  /** The member plugins of the package, each its own client plugin (`/<plugin>:<command>`). */
  memberPlugins?: MemberPluginSetup[];
  /** Member plugins to uninstall from the client; their folders are deleted by `removeMemberPluginFolder`. */
  removePlugins?: string[];
  /** Dedicated per-client root below Kintsugi's local config directory. */
  artifactRoot: string;
  /** The record of installed member plugins (see PLUGIN_STATE_PATH); written with the package when given. */
  stateFile?: string;
}

export interface SetupChange {
  root: string;
  relativePath: string;
  content: string;
  target: HarnessClient;
  pluginName: string;
  marketplaceName: string;
  installationMode?: "native-cli" | "desktop-ui";
  scope?: InstallScope;
  /** The version the native client reported, which decides the flags of its commands. */
  clientVersion?: string;
  /** Client names of the member plugins to install or update, and of those to uninstall. */
  install?: Array<{ name: string; update: boolean }>;
  uninstall?: string[];
}

/** A native client invocation represented as executable plus literal argv. */
export interface NativeClientCommand {
  executable: HarnessClient;
  args: string[];
}

export interface SetupReport {
  target: HarnessClient;
  artifactRoot: string;
  pluginRoot: string;
  marketplaceName: string;
  written: string[];
  unchanged: string[];
  installSteps: NativeClientCommand[];
  rollbackSteps: NativeClientCommand[];
  installCommands: string[];
  rollbackCommands: string[];
  installationMode?: "native-cli" | "desktop-ui";
  marketplacePath?: string;
  staged?: boolean;
}

export interface CodexDesktopSetupInput extends Omit<ConnectorPluginInput, "target"> {
  /** OS home directory. The marketplace and package are always derived below this directory. */
  homeDir: string;
}

export interface SetupFileDeps {
  mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  lstat(path: string): Promise<{ isSymbolicLink(): boolean; isFile(): boolean; isDirectory(): boolean }>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: string, options: { flag: "wx"; mode: number }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string, options: { force: true }): Promise<void>;
}

const FILES: SetupFileDeps = { mkdir, lstat, readFile, writeFile: async (path, data, options) => {
  const handle = await open(path, options.flag, options.mode);
  try { await handle.writeFile(data, "utf8"); } finally { await handle.close(); }
}, rename, rm };

const MARKER_PATH = ".kintsugi-managed.json";
const SETUP_MARKER = (target: HarnessClient) => JSON.stringify({ schemaVersion: "1", owner: "kintsugi", feature: "connector", target }, null, 2) + "\n";

function marketplaceNameForProfile(profileId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profileId)) {
    throw new PluginSetupError("PLUGIN_PROFILE_INVALID", "Plugin marketplace profile ID is invalid");
  }
  const slug = profileId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 16) || "profile";
  const suffix = createHash("sha256").update(profileId, "utf8").digest("hex").slice(0, 12);
  return `${KINTSUGI_PLUGIN_NAME}-${slug}-${suffix}`;
}

/** Stable Codex plugin identity so multiple Kintsugi project profiles can coexist in one personal marketplace. */
export function codexDesktopPluginName(profileId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(profileId)) {
    throw new PluginSetupError("PLUGIN_PROFILE_INVALID", "Plugin marketplace profile ID is invalid");
  }
  return `${KINTSUGI_PLUGIN_NAME}-${createHash("sha256").update(profileId, "utf8").digest("hex").slice(0, 12)}`;
}

function within(root: string, child: string): boolean {
  const path = relative(root, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function assertRelativeFile(path: string): void {
  if (path.length === 0 || isAbsolute(path) || path.split(/[\\/]+/).some((part) => part === ".." || part === "")) {
    throw new PluginSetupError("SETUP_PATH_INVALID", "Setup file paths must stay inside the Kintsugi-managed artifact root");
  }
}

export function generateConnectorMarketplace(target: HarnessClient, version: string, profileId = "default", members: ReadonlyArray<{ name: string; version: string; description?: string }> = []): { path: string; content: string } {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new PluginSetupError("PLUGIN_VERSION_INVALID", "Plugin marketplace version must be an exact semantic version");
  }
  const pluginName = KINTSUGI_PLUGIN_NAME;
  const marketplaceName = marketplaceNameForProfile(profileId);
  const pluginPath = `./plugins/${target}/${pluginName}`;
  if (target === "claude") {
    return {
      path: ".claude-plugin/marketplace.json",
      content: `${JSON.stringify({
        name: marketplaceName,
        description: "Local Kintsugi plugins.",
        owner: { name: "Kintsugi" },
        plugins: [
          { name: pluginName, source: pluginPath, description: "Read-only Kintsugi task context and workflow evidence.", version },
          ...members.map((member) => ({ name: clientPluginName(member.name), source: `./plugins/${target}/${clientPluginName(member.name)}`, description: member.description ?? `Kintsugi plugin ${member.name}`, version: member.version })),
        ],
      }, null, 2)}\n`,
    };
  }
  if (target === "codex") {
    return {
      path: ".agents/plugins/marketplace.json",
      content: `${JSON.stringify({
        name: marketplaceName,
        interface: { displayName: "Kintsugi" },
        plugins: [{
          name: pluginName,
          source: { source: "local", path: pluginPath },
          version,
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Developer tools",
        }, ...members.map((member) => ({
          name: clientPluginName(member.name),
          source: { source: "local", path: `./plugins/${target}/${clientPluginName(member.name)}` },
          version: member.version,
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Developer tools",
        }))],
      }, null, 2)}\n`,
    };
  }
  return {
    path: ".github/plugin/marketplace.json",
    content: `${JSON.stringify({
      name: marketplaceName,
      owner: { name: "Kintsugi" },
      metadata: { description: "Local Kintsugi plugins.", version },
      plugins: [
        { name: pluginName, source: pluginPath, description: "Read-only Kintsugi task context and workflow evidence.", version },
        ...members.map((member) => ({ name: clientPluginName(member.name), source: `./plugins/${target}/${clientPluginName(member.name)}`, description: member.description ?? `Kintsugi plugin ${member.name}`, version: member.version })),
      ],
    }, null, 2)}\n`,
  };
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function safeUnquotedArgument(value: string): boolean {
  return /^[A-Za-z0-9_./:@+=-]+$/.test(value);
}

function hasControlCharacters(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function formatArgument(value: string, platform: NodeJS.Platform): string {
  if (safeUnquotedArgument(value)) return value;
  return platform === "win32" ? quotePowerShell(value) : quotePosix(value);
}

/** Render a copyable command for the current user's shell; execution still uses argv. */
export function formatNativeCommand(command: NativeClientCommand, platform: NodeJS.Platform = process.platform): string {
  return [command.executable, ...command.args.map((argument) => formatArgument(argument, platform))].join(" ");
}

/** Codex 0.163 added `--no-daemon`, which keeps `plugin` commands from starting the app-server daemon; an older Codex refuses it. */
const CODEX_NO_DAEMON_FROM = "0.163.0";

function nativeCommands(target: HarnessClient, root: string, pluginName: string, marketplaceName: string, options: { scope: InstallScope; clientVersion?: string; marketplaceKnown?: boolean; install: ReadonlyArray<{ name: string; update: boolean }>; uninstall: readonly string[] }): { install: NativeClientCommand[]; rollback: NativeClientCommand[] } {
  const scope = options.scope;
  const codexFlags = options.clientVersion !== undefined && versionAtLeast(options.clientVersion, CODEX_NO_DAEMON_FROM) ? ["--no-daemon"] : [];
  const names = [pluginName, ...options.install.map((entry) => entry.name)];
  const installByClient: Record<HarnessClient, () => NativeClientCommand[]> = {
    claude: () => [
      { executable: "claude", args: ["plugin", "marketplace", "add", "--scope", scope, root] },
      ...(options.install.some((entry) => entry.update) ? [{ executable: "claude", args: ["plugin", "marketplace", "update", marketplaceName] } satisfies NativeClientCommand] : []),
      ...options.uninstall.map((name): NativeClientCommand => ({ executable: "claude", args: ["plugin", "uninstall", "--scope", scope, `${name}@${marketplaceName}`] })),
      { executable: "claude", args: ["plugin", "install", "--scope", scope, "--yes", `${pluginName}@${marketplaceName}`] },
      ...options.install.map((entry): NativeClientCommand => ({ executable: "claude", args: ["plugin", entry.update ? "update" : "install", "--scope", scope, "--yes", `${entry.name}@${marketplaceName}`] })),
    ],
    codex: () => [
      { executable: "codex", args: [...codexFlags, "plugin", "marketplace", "add", root] },
      ...options.uninstall.map((name): NativeClientCommand => ({ executable: "codex", args: [...codexFlags, "plugin", "remove", `${name}@${marketplaceName}`] })),
      ...names.map((name): NativeClientCommand => ({ executable: "codex", args: [...codexFlags, "plugin", "add", `${name}@${marketplaceName}`] })),
    ],
    copilot: () => [
      // Copilot refuses to add a marketplace twice (exit 1), so a package set up before is refreshed instead.
      options.marketplaceKnown === true
        ? { executable: "copilot", args: ["plugin", "marketplace", "update", marketplaceName] }
        : { executable: "copilot", args: ["plugin", "marketplace", "add", root] },
      ...options.uninstall.map((name): NativeClientCommand => ({ executable: "copilot", args: ["plugin", "uninstall", name] })),
      { executable: "copilot", args: ["plugin", "install", `${pluginName}@${marketplaceName}`] },
      ...options.install.map((entry): NativeClientCommand => ({ executable: "copilot", args: ["plugin", entry.update ? "update" : "install", `${entry.name}@${marketplaceName}`] })),
    ],
  };
  const rollbackByClient: Record<HarnessClient, () => NativeClientCommand[]> = {
    claude: () => [
      ...[...names].reverse().map((name): NativeClientCommand => ({ executable: "claude", args: ["plugin", "uninstall", "--scope", scope, `${name}@${marketplaceName}`] })),
      { executable: "claude", args: ["plugin", "marketplace", "remove", "--scope", scope, marketplaceName] },
    ],
    codex: () => [
      ...[...names].reverse().map((name): NativeClientCommand => ({ executable: "codex", args: [...codexFlags, "plugin", "remove", `${name}@${marketplaceName}`] })),
      { executable: "codex", args: [...codexFlags, "plugin", "marketplace", "remove", marketplaceName] },
    ],
    copilot: () => [
      ...[...names].reverse().map((name): NativeClientCommand => ({ executable: "copilot", args: ["plugin", "uninstall", name] })),
      { executable: "copilot", args: ["plugin", "marketplace", "remove", marketplaceName] },
    ],
  };
  return { install: installByClient[target](), rollback: rollbackByClient[target]() };
}

/** Validates client compatibility before producing a deterministic list of package files. */
export function planClientSetup(input: SetupInput): SetupChange[] {
  assertClientCompatibility(input.target, input.clientVersion);
  if (!isAbsolute(input.artifactRoot)) throw new PluginSetupError("SETUP_ROOT_INVALID", "The Kintsugi plugin artifact root must be an absolute path");
  if (hasControlCharacters(input.artifactRoot)) throw new PluginSetupError("SETUP_ROOT_INVALID", "The Kintsugi plugin artifact root cannot contain control characters");
  const root = resolve(input.artifactRoot);
  const generated = generateConnectorPlugin(input);
  const marketplaceName = marketplaceNameForProfile(input.profileId);
  const members = input.memberPlugins ?? [];
  const marketplace = generateConnectorMarketplace(input.target, input.cliVersion, input.profileId, members);
  const memberEntries = members.flatMap((member): Array<[string, string]> => {
    if (member.files === undefined) return [];
    const plugin = generateMemberPlugin({ target: input.target, name: member.name, version: member.version, ...(member.description === undefined ? {} : { description: member.description }), files: member.files });
    return Object.entries(plugin.files).map(([path, content]): [string, string] => [`plugins/${input.target}/${plugin.pluginName}/${path}`, content]);
  });
  const entries: Array<[string, string]> = [
    [MARKER_PATH, SETUP_MARKER(input.target)],
    ...(input.stateFile === undefined ? [] : [[PLUGIN_STATE_PATH, input.stateFile] as [string, string]]),
    [marketplace.path, marketplace.content],
    ...Object.entries(generated.files).map(([path, content]): [string, string] => [`plugins/${input.target}/${generated.pluginName}/${path}`, content]),
    ...memberEntries,
  ];
  const install = members.filter((member) => member.files !== undefined).map((member) => ({ name: clientPluginName(member.name), update: member.installed === true }));
  const uninstall = (input.removePlugins ?? []).map((name) => clientPluginName(name));
  return entries.map(([relativePath, content]) => {
    assertRelativeFile(relativePath);
    const destination = resolve(root, relativePath);
    if (!within(root, destination)) throw new PluginSetupError("SETUP_PATH_INVALID", "A generated path escaped the Kintsugi artifact root");
    return { root, relativePath, content, target: input.target, pluginName: generated.pluginName, marketplaceName, installationMode: "native-cli", scope: input.scope ?? "user", clientVersion: input.clientVersion, install, uninstall };
  });
}

/** Plans only the package files that Codex Desktop will discover through the user's local marketplace. */
export function planCodexDesktopSetup(input: CodexDesktopSetupInput): SetupChange[] {
  if (!isAbsolute(input.homeDir)) throw new PluginSetupError("SETUP_ROOT_INVALID", "The user home directory must be an absolute path");
  if (hasControlCharacters(input.homeDir)) throw new PluginSetupError("SETUP_ROOT_INVALID", "The user home directory cannot contain control characters");
  const homeDir = resolve(input.homeDir);
  const pluginName = codexDesktopPluginName(input.profileId);
  const root = resolve(homeDir, ".codex", "plugins", pluginName);
  if (!within(homeDir, root)) throw new PluginSetupError("SETUP_PATH_INVALID", "The generated Codex plugin path escaped the user home directory");
  const generated = generateConnectorPlugin({ ...input, target: "codex", pluginName });
  const marketplaceName = "kintsugi-personal";
  const entries: Array<[string, string]> = [
    [MARKER_PATH, SETUP_MARKER("codex")],
    ...Object.entries(generated.files).map(([path, content]): [string, string] => [path, content]),
  ];
  return entries.map(([relativePath, content]) => {
    assertRelativeFile(relativePath);
    const destination = resolve(root, relativePath);
    if (!within(root, destination)) throw new PluginSetupError("SETUP_PATH_INVALID", "A generated Codex plugin path escaped its package directory");
    return { root, relativePath, content, target: "codex", pluginName: generated.pluginName, marketplaceName, installationMode: "desktop-ui" };
  });
}

async function assertNoSymlinkPath(path: string, deps: SetupFileDeps): Promise<void> {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = relative(root, absolute).split(sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = join(current, part);
    try {
      const info = await deps.lstat(current);
      if (info.isSymbolicLink()) throw new PluginSetupError("SETUP_PATH_UNSAFE", "Generated plugin paths cannot traverse symbolic links");
    } catch (error) {
      if (error instanceof PluginSetupError) throw error;
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

function validateChanges(changes: readonly SetupChange[]): { root: string; target: HarnessClient; pluginName: string; marketplaceName: string; installationMode: "native-cli" | "desktop-ui"; scope: InstallScope; clientVersion: string | undefined; install: Array<{ name: string; update: boolean }>; uninstall: string[] } {
  if (changes.length === 0) throw new PluginSetupError("SETUP_CHANGES_EMPTY", "No plugin setup files were planned");
  const first = changes[0]!;
  const root = resolve(first.root);
  const metadata = { root, target: first.target, pluginName: first.pluginName, marketplaceName: first.marketplaceName, installationMode: first.installationMode ?? "native-cli", scope: (first.scope ?? "user") as InstallScope, clientVersion: first.clientVersion, install: first.install ?? [], uninstall: first.uninstall ?? [] };
  const paths = new Set<string>();
  for (const change of changes) {
    assertRelativeFile(change.relativePath);
    const destination = resolve(root, change.relativePath);
    if (resolve(change.root) !== root || change.target !== metadata.target || change.pluginName !== metadata.pluginName || change.marketplaceName !== metadata.marketplaceName || (change.installationMode ?? "native-cli") !== metadata.installationMode || !within(root, destination)) {
      throw new PluginSetupError("SETUP_CHANGES_INVALID", "All setup changes must belong to one client and one managed artifact root");
    }
    if (paths.has(change.relativePath)) throw new PluginSetupError("SETUP_CHANGES_INVALID", "Setup changes cannot write a path more than once");
    paths.add(change.relativePath);
  }
  if (!paths.has(MARKER_PATH)) throw new PluginSetupError("SETUP_MARKER_MISSING", "Setup changes must include the Kintsugi ownership marker");
  return metadata;
}

/** Writes the managed local package only; native client settings are changed by the printed commands. */
export async function applyClientSetup(changes: readonly SetupChange[], deps: SetupFileDeps = FILES): Promise<SetupReport> {
  const metadata = validateChanges(changes);
  await assertNoSymlinkPath(metadata.root, deps);
  await deps.mkdir(metadata.root, { recursive: true });
  const markerPath = join(metadata.root, MARKER_PATH);
  await assertNoSymlinkPath(markerPath, deps);
  let alreadyManaged = false;
  try {
    const marker = JSON.parse((await deps.readFile(markerPath)).toString("utf8")) as { owner?: string; feature?: string; target?: string };
    if (marker.owner !== "kintsugi" || marker.feature !== "connector" || marker.target !== metadata.target) {
      throw new PluginSetupError("SETUP_ROOT_OWNERSHIP_MISMATCH", "The existing plugin directory is owned by another Kintsugi feature or client");
    }
    alreadyManaged = true;
  } catch (error) {
    if (error instanceof PluginSetupError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }

  const writes: Array<{ destination: string; content: string; unchanged: boolean }> = [];
  for (const change of changes) {
    const destination = resolve(metadata.root, change.relativePath);
    await assertNoSymlinkPath(destination, deps);
    try {
      const info = await deps.lstat(destination);
      if (!info.isFile()) throw new PluginSetupError("SETUP_PATH_UNSAFE", "A generated plugin file path is not a regular file");
      if (!alreadyManaged && change.relativePath !== MARKER_PATH) {
        throw new PluginSetupError("SETUP_UNOWNED_FILE_EXISTS", `Refusing to replace an unowned file: ${change.relativePath}`);
      }
      const current = (await deps.readFile(destination)).toString("utf8");
      writes.push({ destination, content: change.content, unchanged: current === change.content });
    } catch (error) {
      if (error instanceof PluginSetupError) throw error;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      writes.push({ destination, content: change.content, unchanged: false });
    }
  }

  const written: string[] = [];
  const unchanged: string[] = [];
  for (const write of writes) {
    if (write.unchanged) { unchanged.push(write.destination); continue; }
    const directory = resolve(write.destination, "..");
    await deps.mkdir(directory, { recursive: true });
    await assertNoSymlinkPath(directory, deps);
    const temporaryPath = `${write.destination}.${randomUUID()}.tmp`;
    try {
      await deps.writeFile(temporaryPath, write.content, { flag: "wx", mode: 0o600 });
      await deps.rename(temporaryPath, write.destination);
      written.push(write.destination);
    } catch (error) {
      await deps.rm(temporaryPath, { force: true });
      throw error;
    }
  }

  const commands = metadata.installationMode === "desktop-ui"
    ? { install: [] as NativeClientCommand[], rollback: [] as NativeClientCommand[] }
    : nativeCommands(metadata.target, metadata.root, metadata.pluginName, metadata.marketplaceName, { scope: metadata.scope, ...(metadata.clientVersion === undefined ? {} : { clientVersion: metadata.clientVersion }), marketplaceKnown: alreadyManaged, install: metadata.install, uninstall: metadata.uninstall });
  return {
    target: metadata.target,
    artifactRoot: metadata.root,
    pluginRoot: metadata.installationMode === "desktop-ui" ? metadata.root : join(metadata.root, "plugins", metadata.target, metadata.pluginName),
    marketplaceName: metadata.marketplaceName,
    written,
    unchanged,
    installSteps: commands.install,
    rollbackSteps: commands.rollback,
    installCommands: commands.install.map((command) => formatNativeCommand(command)),
    rollbackCommands: commands.rollback.map((command) => formatNativeCommand(command)),
    installationMode: metadata.installationMode,
  };
}

interface CodexMarketplace {
  name: string;
  plugins: Array<Record<string, unknown>>;
  interface?: Record<string, unknown>;
  [key: string]: unknown;
}

function readCodexMarketplace(value: string | undefined): CodexMarketplace {
  if (value === undefined) return { name: "kintsugi-personal", interface: { displayName: "Kintsugi" }, plugins: [] };
  let parsed: unknown;
  try { parsed = JSON.parse(value) as unknown; } catch {
    throw new PluginSetupError("CODEX_MARKETPLACE_INVALID", "The existing Codex personal marketplace is not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new PluginSetupError("CODEX_MARKETPLACE_INVALID", "The Codex personal marketplace must be a JSON object");
  }
  const catalog = parsed as Partial<CodexMarketplace>;
  if (typeof catalog.name !== "string" || catalog.name.trim().length === 0 || !Array.isArray(catalog.plugins)) {
    throw new PluginSetupError("CODEX_MARKETPLACE_INVALID", "The Codex personal marketplace must include a name and a plugins array");
  }
  if (catalog.interface !== undefined && (typeof catalog.interface !== "object" || catalog.interface === null || Array.isArray(catalog.interface))) {
    throw new PluginSetupError("CODEX_MARKETPLACE_INVALID", "The Codex marketplace interface must be a JSON object");
  }
  if (catalog.plugins.some((plugin) => typeof plugin !== "object" || plugin === null || Array.isArray(plugin)
    || typeof (plugin as Record<string, unknown>).name !== "string" || ((plugin as Record<string, unknown>).name as string).trim() === "")) {
    throw new PluginSetupError("CODEX_MARKETPLACE_INVALID", "Every Codex marketplace plugin entry must be an object with a name");
  }
  return catalog as CodexMarketplace;
}

async function readOptionalFile(path: string, deps: SetupFileDeps): Promise<string | undefined> {
  try { return (await deps.readFile(path)).toString("utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function mergeCodexMarketplace(value: string | undefined, pluginName: string, cliVersion: string): string {
  const catalog = readCodexMarketplace(value);
  if (catalog.interface === undefined) catalog.interface = { displayName: "Kintsugi" };
  else if (typeof catalog.interface.displayName !== "string" || catalog.interface.displayName.trim() === "") {
    catalog.interface = { ...catalog.interface, displayName: "Kintsugi" };
  }
  const sourcePath = `./.codex/plugins/${pluginName}`;
  const matches = catalog.plugins.filter((plugin) => plugin.name === pluginName);
  if (matches.length > 1) throw new PluginSetupError("CODEX_MARKETPLACE_CONFLICT", "The Codex marketplace contains duplicate entries for this Kintsugi profile");
  const entry = {
    name: pluginName,
    source: { source: "local", path: sourcePath },
    version: cliVersion,
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
    category: "Developer tools",
  };
  if (matches.length === 1) {
    const existing = matches[0]!;
    const source = existing.source;
    if (typeof source !== "object" || source === null || Array.isArray(source)
      || (source as Record<string, unknown>).source !== "local" || (source as Record<string, unknown>).path !== sourcePath) {
      throw new PluginSetupError("CODEX_MARKETPLACE_CONFLICT", "A Codex marketplace entry already uses this Kintsugi plugin name with a different source");
    }
    catalog.plugins = catalog.plugins.map((plugin) => plugin === existing ? { ...plugin, ...entry } : plugin);
  } else {
    catalog.plugins.push(entry);
  }
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

async function writeAtomic(path: string, content: string, deps: SetupFileDeps): Promise<boolean> {
  await assertNoSymlinkPath(path, deps);
  try {
    const info = await deps.lstat(path);
    if (!info.isFile()) throw new PluginSetupError("SETUP_PATH_UNSAFE", "The Codex marketplace catalog path is not a regular file");
    if ((await deps.readFile(path)).toString("utf8") === content) return false;
  } catch (error) {
    if (error instanceof PluginSetupError) throw error;
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await deps.mkdir(dirname(path), { recursive: true });
  await assertNoSymlinkPath(path, deps);
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  try {
    await deps.writeFile(temporaryPath, content, { flag: "wx", mode: 0o600 });
    await deps.rename(temporaryPath, path);
  } catch (error) {
    await deps.rm(temporaryPath, { force: true });
    throw error;
  }
  return true;
}

/** Stages a Codex Desktop plugin in the personal local marketplace without running Codex CLI. */
export async function stageCodexDesktopPlugin(input: CodexDesktopSetupInput, deps: SetupFileDeps = FILES): Promise<SetupReport & { marketplacePath: string; staged: true }> {
  if (!isAbsolute(input.homeDir)) throw new PluginSetupError("SETUP_ROOT_INVALID", "The user home directory must be an absolute path");
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(input.cliVersion)) {
    throw new PluginSetupError("PLUGIN_VERSION_INVALID", "Kintsugi CLI version must be an exact semantic version");
  }
  const homeDir = resolve(input.homeDir);
  const marketplaceRoot = resolve(homeDir, ".agents", "plugins");
  const marketplacePath = join(marketplaceRoot, "marketplace.json");
  const pluginName = codexDesktopPluginName(input.profileId);
  const pluginRoot = resolve(homeDir, ".codex", "plugins", pluginName);
  if (!within(homeDir, marketplacePath) || !within(homeDir, pluginRoot)) {
    throw new PluginSetupError("SETUP_PATH_INVALID", "The generated Codex marketplace paths escaped the user home directory");
  }
  await assertNoSymlinkPath(marketplaceRoot, deps);
  await assertNoSymlinkPath(marketplacePath, deps);
  const initialCatalog = await readOptionalFile(marketplacePath, deps);
  // Validate before creating the package so malformed and conflicting catalogs leave no partial staging.
  mergeCodexMarketplace(initialCatalog, pluginName, input.cliVersion);

  let packageReport: SetupReport;
  try {
    packageReport = await applyClientSetup(planCodexDesktopSetup({ ...input, homeDir }), deps);
  } catch (error) {
    const code = error instanceof PluginSetupError ? error.code : "CODEX_PLUGIN_STAGE_FAILED";
    throw new PluginSetupError(code, `Could not safely stage the Codex plugin package at ${pluginRoot}: ${(error as Error).message}`);
  }
  let catalogChanged: boolean;
  try {
    await assertNoSymlinkPath(marketplaceRoot, deps);
    const currentCatalog = await readOptionalFile(marketplacePath, deps);
    const mergedCatalog = mergeCodexMarketplace(currentCatalog, pluginName, input.cliVersion);
    catalogChanged = await writeAtomic(marketplacePath, mergedCatalog, deps);
  } catch (error) {
    throw new PluginSetupError("CODEX_MARKETPLACE_WRITE_FAILED", `The plugin package is staged at ${pluginRoot}, but the Codex marketplace catalog could not be updated: ${(error as Error).message}. The plugin is not installed; inspect only Kintsugi-managed package files before cleanup.`);
  }
  return {
    ...packageReport,
    artifactRoot: marketplaceRoot,
    pluginRoot,
    marketplaceName: "kintsugi-personal",
    marketplacePath,
    written: catalogChanged ? [...packageReport.written, marketplacePath] : packageReport.written,
    unchanged: catalogChanged ? packageReport.unchanged : [...packageReport.unchanged, marketplacePath],
    installationMode: "desktop-ui",
    staged: true,
  };
}

// ---------------------------------------------------------------------------------------------------------
// Member plugins distributed by Kintsugi (ADR-0069, ADR-0072). Each is its own client plugin with its own folder next to the
// connector's; this record says which files each carries, so an update deletes exactly those it no longer has.
// ---------------------------------------------------------------------------------------------------------

export const PLUGIN_STATE_PATH = ".kintsugi-plugins.json";

export interface InstalledPlugin {
  version: string;
  contentHash: string;
  description?: string;
  /** Paths relative to the plugin's own folder in the package (`plugins/<client>/<plugin>/`). */
  files: string[];
}

export interface PluginInstallState {
  schemaVersion: "1";
  plugins: Record<string, InstalledPlugin>;
}

export function emptyPluginState(): PluginInstallState {
  return { schemaVersion: "1", plugins: {} };
}

export function serializePluginState(state: PluginInstallState): string {
  const plugins = Object.fromEntries(Object.entries(state.plugins).sort(([a], [b]) => a.localeCompare(b)));
  return JSON.stringify({ schemaVersion: "1", plugins }, null, 2) + "\n";
}

/** The installed-plugin record of a managed package root; empty when the package has none yet. */
export async function readPluginState(artifactRoot: string, deps: SetupFileDeps = FILES): Promise<PluginInstallState> {
  const path = join(resolve(artifactRoot), PLUGIN_STATE_PATH);
  await assertNoSymlinkPath(path, deps);
  let raw: string;
  try { raw = (await deps.readFile(path)).toString("utf8"); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyPluginState();
    throw error;
  }
  let parsed: Partial<PluginInstallState>;
  try { parsed = JSON.parse(raw) as Partial<PluginInstallState>; } catch {
    throw new PluginSetupError("PLUGIN_STATE_INVALID", "The record of installed Kintsugi plugins is not valid JSON");
  }
  if (parsed.schemaVersion !== "1" || typeof parsed.plugins !== "object" || parsed.plugins === null) {
    throw new PluginSetupError("PLUGIN_STATE_INVALID", "The record of installed Kintsugi plugins has an unsupported shape");
  }
  for (const [name, entry] of Object.entries(parsed.plugins)) {
    if (typeof entry?.version !== "string" || typeof entry.contentHash !== "string" || (entry.description !== undefined && typeof entry.description !== "string") || !Array.isArray(entry.files) || entry.files.some((file) => typeof file !== "string")) {
      throw new PluginSetupError("PLUGIN_STATE_INVALID", `The record of installed Kintsugi plugins is malformed at ${name}`);
    }
  }
  return { schemaVersion: "1", plugins: parsed.plugins as Record<string, InstalledPlugin> };
}

/** The state after installing (or updating) one plugin, and the files of its previous version that are now stale. */
export function withInstalledPlugin(state: PluginInstallState, name: string, plugin: InstalledPlugin): { state: PluginInstallState; stale: string[] } {
  const previous = state.plugins[name]?.files ?? [];
  return { state: { schemaVersion: "1", plugins: { ...state.plugins, [name]: plugin } }, stale: previous.filter((file) => !plugin.files.includes(file)) };
}

/** The state after removing one plugin, and its files. */
export function withoutPlugin(state: PluginInstallState, name: string): { state: PluginInstallState; stale: string[] } {
  const entry = state.plugins[name];
  if (entry === undefined) throw new PluginSetupError("PLUGIN_NOT_INSTALLED", `The plugin ${name} is not installed in this package`);
  const { [name]: _removed, ...rest } = state.plugins;
  return { state: { schemaVersion: "1", plugins: rest }, stale: entry.files };
}

/** The folder of one member plugin in the package, checked to stay inside it. */
function memberPluginFolder(artifactRoot: string, target: HarnessClient, name: string): string {
  const root = resolve(artifactRoot);
  const folder = join(root, "plugins", target, clientPluginName(name));
  if (!within(root, folder) || folder === root) throw new PluginSetupError("SETUP_PATH_INVALID", "A member plugin folder escaped the Kintsugi package");
  return folder;
}

/** Deletes files a member plugin no longer carries from its folder in the package, and the folders it leaves empty. */
export async function pruneStalePluginFiles(artifactRoot: string, target: HarnessClient, pluginName: string, relativePaths: readonly string[], deps: SetupFileDeps = FILES): Promise<string[]> {
  const pluginRoot = memberPluginFolder(artifactRoot, target, pluginName);
  const removed: string[] = [];
  for (const relativePath of relativePaths) {
    assertRelativeFile(relativePath);
    const destination = resolve(pluginRoot, relativePath);
    if (!within(pluginRoot, destination) || destination === pluginRoot) throw new PluginSetupError("SETUP_PATH_INVALID", "A stale plugin path escaped the plugin folder");
    await assertNoSymlinkPath(destination, deps);
    await deps.rm(destination, { force: true });
    removed.push(destination);
    for (let directory = dirname(destination); directory !== pluginRoot && within(pluginRoot, directory); directory = dirname(directory)) {
      try { await rmdir(directory); } catch { break; }
    }
  }
  return removed;
}

/** Deletes the whole folder of a removed member plugin (after the client uninstalled it). */
export async function removeMemberPluginFolder(artifactRoot: string, target: HarnessClient, pluginName: string, deps: SetupFileDeps = FILES): Promise<void> {
  const folder = memberPluginFolder(artifactRoot, target, pluginName);
  await assertNoSymlinkPath(folder, deps);
  await rm(folder, { recursive: true, force: true });
}
