// Skill supporting files for a job (Agent Skills `references/`, `scripts/`, `assets/`): the kernel puts
// SKILL.md in the system prompt, and the files beside it are written here, once per job, into a
// read-only part of the job's inputs where the agent's read tool finds them. The definition handed
// to the runtime names the directory and the paths, never the contents.

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, normalize, sep } from "node:path";
import type { AgentDefinition } from "@kintsugi/runtime-sdk";

/** Folder of the job inputs that holds the skills' files. */
export const SKILLS_DIR = ".skills";

export async function materializeSkillFiles(definition: AgentDefinition, inputsDir: string): Promise<AgentDefinition> {
  if (definition.skills === undefined || !definition.skills.some((skill) => skill.files !== undefined)) return definition;
  const skills = [];
  for (const skill of definition.skills) {
    const { files, ...rest } = skill;
    if (files === undefined || Object.keys(files).length === 0) {
      skills.push(rest);
      continue;
    }
    const dir = join(inputsDir, SKILLS_DIR, skill.name);
    const paths: string[] = [];
    for (const [path, content] of Object.entries(files)) {
      const target = normalize(join(dir, ...path.split("/")));
      if (!target.startsWith(dir + sep)) continue; // a path that climbs out of the skill folder is dropped
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      paths.push(path);
    }
    skills.push({ ...rest, supporting: { dir, paths: paths.sort() } });
  }
  return { ...definition, skills };
}
