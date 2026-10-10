// The built-in catalog (ADR-0026, ADR-0027): the modernization content shipped with
// Kintsugi under packages/agents/builtin/ (derived from the upstream code-modernization
// plugin, see builtin/NOTICE), versioned with the release and seeded into the
// installation at startup. Read-only; admins fork a built-in agent to change it.
//
//   builtin/agents/<name>.md        runtime agents (audience runtime) and member agents
//   builtin/skills/<name>/SKILL.md  shared skills (optional)
//   builtin/commands, workflows, scripts, hooks, tests   read by later stages

import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { type AgentPackage, parseAgentFile, parseSkillLibrary, type SkillPackage } from "./format.js";

export const BUILTIN_DIR = resolve(import.meta.dirname, "../builtin");

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

/** Loads and parses the built-in catalog; throws with every problem when it is invalid. */
export async function loadBuiltinCatalog(dir: string = BUILTIN_DIR): Promise<BuiltinCatalog> {
  const problems: string[] = [];
  const skillsDir = join(dir, "skills");
  const skills = existsSync(skillsDir) ? parseSkillLibrary(await readPackageDir(skillsDir)) : { ok: true as const, value: [] };
  if (!skills.ok) problems.push(...skills.problems);

  const agents: AgentPackage[] = [];
  const agentsDir = join(dir, "agents");
  for (const entry of await readdir(agentsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const file = `agents/${entry.name}`;
    const parsed = parseAgentFile(await readFile(join(agentsDir, entry.name), "utf8"), file);
    if (!parsed.ok) problems.push(...parsed.problems);
    else if (`${parsed.value.manifest.name}.md` !== entry.name) problems.push(`${file}: name "${parsed.value.manifest.name}" must match the file name`);
    else agents.push(parsed.value);
  }
  if (problems.length > 0) throw new Error(`Invalid built-in agent catalog:\n- ${problems.join("\n- ")}`);
  return { agents: agents.sort((a, b) => a.manifest.name.localeCompare(b.manifest.name)), skills: skills.ok ? skills.value : [] };
}
