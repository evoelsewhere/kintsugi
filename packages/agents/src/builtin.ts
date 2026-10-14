// The built-in catalog (ADR-0026, ADR-0027, ADR-0035): the modernization content shipped with
// Kintsugi under packages/agents/builtin/ (derived from the upstream code-modernization
// plugin, see builtin/NOTICE), versioned with the release and seeded into the
// installation at startup. Read-only; admins fork a built-in agent to change it.
//
// The content is a set of plugins, one folder each under builtin/plugins/, in the Claude Code plugin
// format extended with workflows/ and scripts/:
//
//   plugins/<name>/.claude-plugin/plugin.json   name, version, description
//   plugins/<name>/kintsugi.json                title, audience (runtime | member), requires
//   plugins/<name>/agents/<name>.md             runtime agents (audience runtime) and member agents
//   plugins/<name>/skills/<name>/SKILL.md       shared skills, referenced by name from agents' `skills:`;
//                                               references/ and license files beside SKILL.md ride along
//   plugins/<name>/commands, workflows, scripts, hooks, tests
//
// A skill or script two plugins need is copied into both (a plugin stands alone); a test keeps the
// copies identical.

import { existsSync, readdirSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { type AgentPackage, parseAgentFile, parseSkillLibrary, type SkillPackage } from "./format.js";

export const BUILTIN_DIR = resolve(import.meta.dirname, "../builtin");

export interface BuiltinPluginDir {
  name: string;
  /** Absolute path of the plugin's folder. */
  dir: string;
}

/** The plugin folders under `<dir>/plugins` (those with a `.claude-plugin/plugin.json`), by name. */
export function builtinPluginDirs(dir: string = BUILTIN_DIR): BuiltinPluginDir[] {
  const root = join(dir, "plugins");
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, ".claude-plugin", "plugin.json")))
    .map((entry) => ({ name: entry.name, dir: join(root, entry.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** A script, workflow or hook file of whichever built-in plugin carries it (`kind` is the folder). */
export function findBuiltinFile(kind: "scripts" | "workflows" | "hooks", file: string, dir: string = BUILTIN_DIR): string | undefined {
  return builtinPluginDirs(dir)
    .map((plugin) => join(plugin.dir, kind, file))
    .find((path) => existsSync(path));
}

export interface BuiltinCatalog {
  agents: AgentPackage[];
  skills: SkillPackage[];
}

/** Reads every file under `dir` as a package-files map (relative POSIX paths). */
export async function readPackageDir(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    files.set(relative(dir, path).split(sep).join("/"), await readFile(path, "utf8"));
  }
  return files;
}

/** Loads and parses the built-in catalog of every plugin; throws with every problem when it is invalid. */
export async function loadBuiltinCatalog(dir: string = BUILTIN_DIR): Promise<BuiltinCatalog> {
  const problems: string[] = [];
  const skills = new Map<string, SkillPackage>();
  const agents = new Map<string, AgentPackage>();
  for (const plugin of builtinPluginDirs(dir)) {
    const skillsDir = join(plugin.dir, "skills");
    if (existsSync(skillsDir)) {
      const parsed = parseSkillLibrary(await readPackageDir(skillsDir));
      if (!parsed.ok) problems.push(...parsed.problems.map((problem) => `plugin ${plugin.name}: ${problem}`));
      else {
        for (const skill of parsed.value) {
          const other = skills.get(skill.name);
          if (other !== undefined && JSON.stringify(other) !== JSON.stringify(skill)) problems.push(`plugin ${plugin.name}: skill ${skill.name} differs from its copy in another plugin`);
          skills.set(skill.name, skill);
        }
      }
    }
    const agentsDir = join(plugin.dir, "agents");
    if (!existsSync(agentsDir)) continue;
    for (const entry of await readdir(agentsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const file = `plugins/${plugin.name}/agents/${entry.name}`;
      const parsed = parseAgentFile(await readFile(join(agentsDir, entry.name), "utf8"), file);
      if (!parsed.ok) problems.push(...parsed.problems);
      else if (`${parsed.value.manifest.name}.md` !== entry.name) problems.push(`${file}: name "${parsed.value.manifest.name}" must match the file name`);
      else if (agents.has(parsed.value.manifest.name)) problems.push(`${file}: agent ${parsed.value.manifest.name} is in two plugins`);
      else agents.set(parsed.value.manifest.name, parsed.value);
    }
  }
  if (problems.length > 0) throw new Error(`Invalid built-in agent catalog:\n- ${problems.join("\n- ")}`);
  return {
    agents: [...agents.values()].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)),
    skills: [...skills.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}
