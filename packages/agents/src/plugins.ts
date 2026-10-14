// Built-in plugins (ADR-0035): the modernization content shipped with Kintsugi, grouped into
// plugins by builtin/plugins.json. A plugin is a folder in the Claude Code plugin format extended with
// workflows/ and scripts/; phase 1 declares each plugin's members by name and keeps the files where the
// orchestrator reads them, so a plugin's files are virtual paths relative to builtin/ plus a generated
// `.claude-plugin/plugin.json`.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { BUILTIN_DIR, loadBuiltinCatalog } from "./builtin.js";
import { loadBuiltinCommands } from "./commands.js";

export type PluginComponentKind = "agent" | "command" | "skill" | "workflow" | "script" | "hook";
export type PluginAudience = "runtime" | "member";

export interface PluginComponent {
  kind: PluginComponentKind;
  name: string;
  /** Path of the component's main file inside the plugin. */
  path: string;
  description: string;
  /** Agents: their audience; commands: who runs them. */
  audience?: string;
}

export interface PluginFile {
  path: string;
  size: number;
}

export interface BuiltinPlugin {
  name: string;
  title: string;
  version: string;
  description: string;
  audience: PluginAudience;
  /** Shared skills the plugin carries. */
  skills: string[];
  components: PluginComponent[];
  files: PluginFile[];
}

interface Manifest {
  name: string;
  title: string;
  version: string;
  description: string;
  audience: PluginAudience;
  skills: string[];
  agents: string[];
  commands: string[];
  workflows: string[];
  scripts: string[];
  hooks: string[];
}

export const PLUGIN_MANIFEST_DIR = ".claude-plugin";
export const PLUGIN_MANIFEST_FILE = `${PLUGIN_MANIFEST_DIR}/plugin.json`;

const IGNORED = new Set(["__pycache__", ".pytest_cache", "node_modules", "tests"]);

async function walk(dir: string, root: string): Promise<PluginFile[]> {
  const files: PluginFile[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (IGNORED.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path, root)));
    else if (entry.isFile()) files.push({ path: relative(root, path).split(sep).join("/"), size: (await stat(path)).size });
  }
  return files;
}

/** The workflow's `meta.description` (the first string after `description:`). */
function workflowDescription(text: string): string {
  const match = /description:\s*(['"`])((?:\\.|(?!\1)[^\\])*)\1/s.exec(text);
  return match?.[2] === undefined ? "" : match[2].replace(/\\(.)/g, "$1").replace(/\s+/g, " ").trim();
}

/** The first line of a script's module docstring, else its first comment. */
function scriptDescription(text: string): string {
  const doc = /^(?:#!.*\n)?\s*(?:"""|''')\s*([^\n]*)/.exec(text);
  if (doc?.[1] !== undefined && doc[1].trim() !== "") return doc[1].trim();
  const comment = /^(?:#!.*\n)?#\s*(.+)/.exec(text);
  return comment?.[1]?.trim() ?? "";
}

const read = (dir: string, path: string): Promise<string> => readFile(join(dir, path), "utf8");

async function manifestsOf(dir: string): Promise<Manifest[]> {
  return (JSON.parse(await read(dir, "plugins.json")) as { plugins: Manifest[] }).plugins;
}

function generatedManifest(manifest: Manifest): string {
  return `${JSON.stringify({ name: manifest.name, version: manifest.version, description: manifest.description, author: { name: "Kintsugi" }, keywords: ["kintsugi", manifest.audience] }, null, 2)}\n`;
}

/** Loads the built-in plugins; throws with every problem when the manifest names something that does not exist. */
export async function loadBuiltinPlugins(dir: string = BUILTIN_DIR): Promise<BuiltinPlugin[]> {
  const [manifests, catalog, commands] = await Promise.all([manifestsOf(dir), loadBuiltinCatalog(dir), loadBuiltinCommands(dir)]);
  const problems: string[] = [];
  const plugins: BuiltinPlugin[] = [];

  for (const manifest of manifests) {
    const components: PluginComponent[] = [];
    const files = new Map<string, PluginFile>();
    const add = async (path: string): Promise<boolean> => {
      try {
        files.set(path, { path, size: (await stat(join(dir, path))).size });
        return true;
      } catch {
        problems.push(`plugin ${manifest.name}: ${path} does not exist`);
        return false;
      }
    };

    for (const name of manifest.agents) {
      const agent = catalog.agents.find((entry) => entry.manifest.name === name);
      if (agent === undefined) problems.push(`plugin ${manifest.name}: unknown agent ${name}`);
      else if (await add(`agents/${name}.md`)) components.push({ kind: "agent", name, path: `agents/${name}.md`, description: agent.manifest.description, audience: agent.manifest.audience });
    }
    for (const command of manifest.commands) {
      const entry = commands.find((candidate) => candidate.command === command);
      if (entry === undefined) problems.push(`plugin ${manifest.name}: unknown command ${command}`);
      else if (await add(`commands/${command}.md`)) components.push({ kind: "command", name: entry.id, path: `commands/${command}.md`, description: entry.description, audience: entry.audience });
    }
    for (const name of manifest.skills) {
      const skill = catalog.skills.find((entry) => entry.name === name);
      if (skill === undefined) {
        problems.push(`plugin ${manifest.name}: unknown skill ${name}`);
        continue;
      }
      for (const file of await walk(join(dir, "skills", name), dir)) files.set(file.path, file);
      components.push({ kind: "skill", name, path: `skills/${name}/SKILL.md`, description: skill.description });
    }
    for (const name of manifest.workflows) {
      const path = `workflows/${name}.js`;
      if (await add(path)) components.push({ kind: "workflow", name, path, description: workflowDescription(await read(dir, path)) });
    }
    for (const name of manifest.scripts) {
      const path = `scripts/${name}.py`;
      if (await add(path)) components.push({ kind: "script", name, path, description: scriptDescription(await read(dir, path)) });
    }
    for (const hook of manifest.hooks) {
      for (const file of await walk(join(dir, hook), dir)) {
        files.set(file.path, file);
        if (/^hooks\/[^/]+\.py$/.test(file.path)) components.push({ kind: "hook", name: file.path.slice("hooks/".length), path: file.path, description: scriptDescription(await read(dir, file.path)) });
      }
    }

    files.set(PLUGIN_MANIFEST_FILE, { path: PLUGIN_MANIFEST_FILE, size: Buffer.byteLength(generatedManifest(manifest)) });
    plugins.push({
      name: manifest.name,
      title: manifest.title,
      version: manifest.version,
      description: manifest.description,
      audience: manifest.audience,
      skills: manifest.skills,
      components,
      files: [...files.values()].sort((a, b) => a.path.localeCompare(b.path)),
    });
  }
  if (problems.length > 0) throw new Error(`Invalid built-in plugins:\n- ${problems.join("\n- ")}`);
  return plugins;
}

/** The text of one file of a built-in plugin (the generated manifest included); undefined when the plugin has no such file. */
export async function readBuiltinPluginFile(plugins: readonly BuiltinPlugin[], name: string, path: string, dir: string = BUILTIN_DIR): Promise<string | undefined> {
  const plugin = plugins.find((entry) => entry.name === name);
  if (plugin === undefined || !plugin.files.some((file) => file.path === path)) return undefined;
  if (path === PLUGIN_MANIFEST_FILE) {
    const manifest = (await manifestsOf(dir)).find((entry) => entry.name === name);
    return manifest === undefined ? undefined : generatedManifest(manifest);
  }
  return read(dir, path);
}
