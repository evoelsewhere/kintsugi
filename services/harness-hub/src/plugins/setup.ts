import { lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, parse, relative, resolve, sep } from "node:path";
import { assertClientCompatibility } from "./compatibility.js";
import { CODING_AGENT_WORKFLOW_PLUGIN_NAME, generateAccessPlugin, PluginSetupError, type AccessPluginInput, type CodingAgentClient } from "./generate.js";

export interface SetupInput extends AccessPluginInput {
  clientVersion: string;
  /** Dedicated per-client root below Kintsugi's local config directory. */
  artifactRoot: string;
}

export interface SetupChange {
  root: string;
  relativePath: string;
  content: string;
  target: CodingAgentClient;
  pluginName: string;
  marketplaceName: string;
}

export interface SetupReport {
  target: CodingAgentClient;
  artifactRoot: string;
  pluginRoot: string;
  marketplaceName: string;
  written: string[];
  unchanged: string[];
  installCommands: string[];
  rollbackCommands: string[];
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
const SETUP_MARKER = (target: CodingAgentClient) => JSON.stringify({ schemaVersion: "1", owner: "kintsugi", feature: "coding-agent-workflow", target }, null, 2) + "\n";
const MARKETPLACE_NAME = CODING_AGENT_WORKFLOW_PLUGIN_NAME;

function within(root: string, child: string): boolean {
  const path = relative(root, child);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

function assertRelativeFile(path: string): void {
  if (path.length === 0 || isAbsolute(path) || path.split(/[\\/]+/).some((part) => part === ".." || part === "")) {
    throw new PluginSetupError("SETUP_PATH_INVALID", "Setup file paths must stay inside the Kintsugi-managed artifact root");
  }
}

export function generateAccessMarketplace(target: CodingAgentClient, version: string): { path: string; content: string } {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new PluginSetupError("PLUGIN_VERSION_INVALID", "Plugin marketplace version must be an exact semantic version");
  }
  const pluginName = CODING_AGENT_WORKFLOW_PLUGIN_NAME;
  const pluginPath = `./plugins/${target}/${pluginName}`;
  if (target === "claude") {
    return {
      path: ".claude-plugin/marketplace.json",
      content: `${JSON.stringify({
        name: MARKETPLACE_NAME,
        description: "Local Kintsugi Coding Agent Workflow plugins.",
        owner: { name: "Kintsugi" },
        plugins: [{ name: pluginName, source: pluginPath, description: "Read-only Kintsugi task context and workflow evidence.", version }],
      }, null, 2)}\n`,
    };
  }
  if (target === "codex") {
    return {
      path: ".agents/plugins/marketplace.json",
      content: `${JSON.stringify({
        name: MARKETPLACE_NAME,
        interface: { displayName: "Kintsugi Coding Agent Workflow" },
        plugins: [{
          name: pluginName,
          source: { source: "local", path: pluginPath },
          version,
          policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" },
          category: "Developer tools",
        }],
      }, null, 2)}\n`,
    };
  }
  return {
    path: ".github/plugin/marketplace.json",
    content: `${JSON.stringify({
      name: MARKETPLACE_NAME,
      owner: { name: "Kintsugi" },
      metadata: { description: "Local Kintsugi Coding Agent Workflow plugins.", version },
      plugins: [{ name: pluginName, source: pluginPath, description: "Read-only Kintsugi task context and workflow evidence.", version }],
    }, null, 2)}\n`,
  };
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function nativeCommands(target: CodingAgentClient, root: string, pluginName: string, marketplaceName: string): { install: string[]; rollback: string[] } {
  const pathArg = process.platform === "win32" ? quotePowerShell(root) : `'${root.replace(/'/g, "'\\''")}'`;
  const installByClient: Record<CodingAgentClient, string[]> = {
    claude: [`claude plugin marketplace add --scope user ${pathArg}`, `claude plugin install --scope user ${pluginName}@${marketplaceName}`],
    codex: [`codex plugin marketplace add ${pathArg}`, `codex plugin add ${pluginName}@${marketplaceName}`],
    copilot: [`copilot plugin marketplace add ${pathArg}`, `copilot plugin install ${pluginName}@${marketplaceName}`],
  };
  const rollbackByClient: Record<CodingAgentClient, string[]> = {
    claude: [`claude plugin uninstall --scope user ${pluginName}@${marketplaceName}`, `claude plugin marketplace remove --scope user ${marketplaceName}`],
    codex: [`codex plugin remove ${pluginName}@${marketplaceName}`, `codex plugin marketplace remove ${marketplaceName}`],
    copilot: [`copilot plugin uninstall ${pluginName}`, `copilot plugin marketplace remove ${marketplaceName}`],
  };
  return { install: installByClient[target], rollback: rollbackByClient[target] };
}

/** Validates client compatibility before producing a deterministic list of package files. */
export function planClientSetup(input: SetupInput): SetupChange[] {
  assertClientCompatibility(input.target, input.clientVersion);
  if (!isAbsolute(input.artifactRoot)) throw new PluginSetupError("SETUP_ROOT_INVALID", "The Kintsugi plugin artifact root must be an absolute path");
  const root = resolve(input.artifactRoot);
  const generated = generateAccessPlugin(input);
  const marketplace = generateAccessMarketplace(input.target, input.cliVersion);
  const entries: Array<[string, string]> = [
    [MARKER_PATH, SETUP_MARKER(input.target)],
    [marketplace.path, marketplace.content],
    ...Object.entries(generated.files).map(([path, content]): [string, string] => [`plugins/${input.target}/${generated.pluginName}/${path}`, content]),
  ];
  return entries.map(([relativePath, content]) => {
    assertRelativeFile(relativePath);
    const destination = resolve(root, relativePath);
    if (!within(root, destination)) throw new PluginSetupError("SETUP_PATH_INVALID", "A generated path escaped the Kintsugi artifact root");
    return { root, relativePath, content, target: input.target, pluginName: generated.pluginName, marketplaceName: MARKETPLACE_NAME };
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

function validateChanges(changes: readonly SetupChange[]): { root: string; target: CodingAgentClient; pluginName: string; marketplaceName: string } {
  if (changes.length === 0) throw new PluginSetupError("SETUP_CHANGES_EMPTY", "No plugin setup files were planned");
  const first = changes[0]!;
  const root = resolve(first.root);
  const metadata = { root, target: first.target, pluginName: first.pluginName, marketplaceName: first.marketplaceName };
  const paths = new Set<string>();
  for (const change of changes) {
    assertRelativeFile(change.relativePath);
    const destination = resolve(root, change.relativePath);
    if (resolve(change.root) !== root || change.target !== metadata.target || change.pluginName !== metadata.pluginName || change.marketplaceName !== metadata.marketplaceName || !within(root, destination)) {
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
    if (marker.owner !== "kintsugi" || marker.feature !== "coding-agent-workflow" || marker.target !== metadata.target) {
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

  const commands = nativeCommands(metadata.target, metadata.root, metadata.pluginName, metadata.marketplaceName);
  return {
    target: metadata.target,
    artifactRoot: metadata.root,
    pluginRoot: join(metadata.root, "plugins", metadata.target, metadata.pluginName),
    marketplaceName: metadata.marketplaceName,
    written,
    unchanged,
    installCommands: commands.install,
    rollbackCommands: commands.rollback,
  };
}
