// Built-in plugins (ADR-0035): the modernization content shipped with Kintsugi, grouped into
// plugins by builtin/plugins.json. A plugin is a folder in the Claude Code plugin format extended with
// workflows/ and scripts/; phase 1 declares each plugin's members by name and keeps the files where the
// orchestrator reads them, so a plugin's files are virtual paths relative to builtin/ plus a generated
// `.claude-plugin/plugin.json`.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { BUILTIN_DIR, loadBuiltinCatalog } from "./builtin.js";
import { type BuiltinCommand, loadBuiltinCommands } from "./commands.js";
import { type FlowNode, flowComponents } from "./flow.js";

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

/** One thing a command runs, in the order its text names it. */
export interface PluginFlowStep {
  kind: "script" | "workflow" | "agent";
  name: string;
  /** The component's main file inside the plugin. */
  path: string;
  /** Workflow: the agents it starts and the scripts it names. */
  agents?: string[];
  scripts?: string[];
}

/** How one command works: what it reads, what it runs, what it writes and where a person decides. */
export interface PluginFlow {
  /** The command's stage id (`assess`). */
  command: string;
  path: string;
  description: string;
  audience: string;
  reads: string[];
  steps: PluginFlowStep[];
  writes: string[];
  gates: string[];
  /** What the stage really runs, in order, as the command declares it; absent when it declares none (then `steps` is read from its text). */
  flow?: FlowNode[];
}

/** A command whose output another command reads: the plugin's pipeline. */
export interface PluginLink {
  from: string;
  to: string;
  /** The shared artifacts. */
  via: string[];
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
  flows: PluginFlow[];
  pipeline: PluginLink[];
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

/** Where in `text` the component is first named (a file name, or the name beside the word "workflow"); -1 when it is not. */
function firstMention(text: string, kind: PluginFlowStep["kind"], name: string): number {
  // Component names are lowercase words, digits, dashes and underscores: safe inside a pattern.
  const pattern =
    kind === "script"
      ? String.raw`${name}\.py`
      : kind === "workflow"
        ? String.raw`${name}\.js|workflows/${name}|${name}[*` + "`" + String.raw`]{0,2}\s+workflow|workflow[\s*` + "`" + String.raw`]{1,3}${name}`
        : String.raw`(?<![\w-])${name}(?![\w-])`;
  return text.search(new RegExp(pattern));
}

/** The agents a workflow file starts (`agentType: 'x'`) and the plugin scripts it names. */
function workflowParts(text: string, agents: readonly string[], scripts: readonly string[]): { agents: string[]; scripts: string[] } {
  return {
    agents: agents.filter((name) => text.includes(`agentType: '${name}'`) || text.includes(`agentType: "${name}"`)),
    scripts: scripts.filter((name) => text.includes(`${name}.py`)),
  };
}

/** Whether an artifact one command writes is one another reads (a file, or a folder the file is in). */
function feeds(write: string, read: string): boolean {
  return write === read || (read.endsWith("/") && write.startsWith(read)) || (write.endsWith("/") && read.startsWith(write));
}

/** Which command feeds which, without the links another path already implies (a → c when a → b → c). */
function pipelineOf(flows: readonly PluginFlow[]): PluginLink[] {
  const links: PluginLink[] = flows.flatMap((from, index) =>
    flows.slice(index + 1).flatMap((to) => {
      const via = from.writes.filter((write) => to.reads.some((readPath) => feeds(write, readPath)));
      return via.length === 0 ? [] : [{ from: from.command, to: to.command, via }];
    }),
  );
  const reaches = (from: string, to: string, skip: PluginLink): boolean =>
    links.some((link) => link !== skip && link.from === from && (link.to === to || reaches(link.to, to, skip)));
  return links.filter((link) => !links.some((other) => other !== link && other.from === link.from && other.to !== link.to && reaches(other.to, link.to, link)));
}

/** The flow of every command of the plugin, from its metadata and the order its text names its parts. */
async function flowsOf(dir: string, components: readonly PluginComponent[], commands: readonly BuiltinCommand[], manifest: Manifest): Promise<PluginFlow[]> {
  const agents = components.filter((entry) => entry.kind === "agent").map((entry) => entry.name);
  const scripts = components.filter((entry) => entry.kind === "script").map((entry) => entry.name);
  const workflows = new Map<string, { agents: string[]; scripts: string[] }>();
  for (const entry of components.filter((component) => component.kind === "workflow")) workflows.set(entry.name, workflowParts(await read(dir, entry.path), agents, scripts));

  const flows: PluginFlow[] = [];
  for (const command of manifest.commands) {
    const entry = commands.find((candidate) => candidate.command === command)!;
    const text = await read(dir, `commands/${command}.md`);
    const steps: Array<PluginFlowStep & { at: number }> = [];
    for (const name of scripts) {
      const at = firstMention(text, "script", name);
      if (at >= 0) steps.push({ kind: "script", name, path: `scripts/${name}.py`, at });
    }
    for (const [name, parts] of workflows) {
      const at = firstMention(text, "workflow", name);
      if (at >= 0) steps.push({ kind: "workflow", name, path: `workflows/${name}.js`, at, ...(parts.agents.length === 0 ? {} : { agents: parts.agents }), ...(parts.scripts.length === 0 ? {} : { scripts: parts.scripts }) });
    }
    for (const name of entry.agents) {
      const at = firstMention(text, "agent", name);
      if (agents.includes(name) && at >= 0) steps.push({ kind: "agent", name, path: `agents/${name}.md`, at });
    }
    steps.sort((a, b) => a.at - b.at);
    flows.push({
      command: entry.id,
      path: `commands/${command}.md`,
      description: entry.description,
      audience: entry.audience,
      reads: entry.reads,
      steps: steps.map(({ at: _at, ...step }) => step),
      writes: entry.writes,
      gates: entry.gates,
      ...(entry.flow === undefined ? {} : { flow: entry.flow }),
    });
  }
  return flows;
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

    const flows = await flowsOf(dir, components, commands, manifest);
    for (const flow of flows) {
      for (const used of flowComponents(flow.flow ?? [])) {
        if (used.generated === true) continue;
        const known = { script: manifest.scripts, agent: manifest.agents, workflow: manifest.workflows }[used.kind];
        if (!known.includes(used.name)) problems.push(`plugin ${manifest.name}: /${flow.command} flow uses ${used.kind} ${used.name}, which the plugin does not carry`);
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
      flows,
      pipeline: pipelineOf(flows),
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
