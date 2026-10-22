// From a package to what the kernel runs (ADR-0023, ADR-0026): validation against the
// installation (known kernel tools, shared skills) and the AgentDefinition embedded in a
// JobSpec. The kernel never looks an agent up; this is the launcher's side.

import { isMcpToolEntry } from "@kintsugi/domain";
import type { AgentDefinition } from "@kintsugi/runtime-sdk";
import type { AgentPackage, SkillPackage } from "./format.js";

export interface AgentContext {
  /** Kernel tool names (`@kintsugi/runtime/tool-names`). */
  knownTools: readonly string[];
  /** Shared skills available to agents, by name. */
  sharedSkills: ReadonlyMap<string, SkillPackage>;
}

/** Problems that keep this agent from running on this installation; [] when it can run. */
export function validateAgent(agent: AgentPackage, context: AgentContext): string[] {
  const problems: string[] = [];
  const { manifest } = agent;
  // Member agents name their harness's tools; only runtime agents are checked against the kernel.
  const tools = manifest.tools ?? [];
  if (manifest.audience === "runtime") {
    for (const tool of tools) {
      // An MCP tool (`mcp__<server>__<tool or *>`) names a server an administrator registered; the job checks it exists.
      if (!context.knownTools.includes(tool) && !isMcpToolEntry(tool)) problems.push(`unknown tool "${tool}" (available: ${context.knownTools.join(", ")}, or an MCP tool such as mcp__<server>__*)`);
    }
  }
  if (new Set(tools).size !== tools.length) problems.push("a tool is listed twice");
  const local = new Set(agent.localSkills.map((skill) => skill.name));
  for (const name of manifest.skills) {
    if (!context.sharedSkills.has(name)) problems.push(`unknown shared skill "${name}"`);
    if (local.has(name)) problems.push(`skill "${name}" is both shared and agent-local`);
  }
  if (new Set(manifest.skills).size !== manifest.skills.length) problems.push("a shared skill is listed twice");
  for (const pattern of manifest.denyCommandPatterns ?? []) {
    try {
      new RegExp(pattern);
    } catch {
      problems.push(`deny-command-pattern "${pattern}" is not a valid regular expression`);
    }
  }
  return problems;
}

/** The files a job may read beside SKILL.md: references, scripts and assets (never licenses). */
function runtimeFiles(skill: SkillPackage): { files?: Record<string, string> } {
  const kept = Object.entries(skill.files ?? {}).filter(([path]) => /^(references|scripts|assets)\//.test(path));
  return kept.length === 0 ? {} : { files: Object.fromEntries(kept) };
}

/**
 * The job's agent definition: shared skills first (in manifest order), then local ones. An agent that lists no
 * `tools` gets every kernel tool (`knownTools`).
 */
export function toAgentDefinition(agent: AgentPackage, sharedSkills: ReadonlyMap<string, SkillPackage>, knownTools: readonly string[]): AgentDefinition {
  const { manifest } = agent;
  if (manifest.audience !== "runtime") throw new Error(`Agent ${manifest.name} is a member agent; the runtime kernel does not run it`);
  const skills = [
    ...manifest.skills.map((name) => {
      const skill = sharedSkills.get(name);
      if (skill === undefined) throw new Error(`Agent ${manifest.name} references unknown shared skill "${name}"`);
      return skill;
    }),
    ...agent.localSkills,
  ];
  return {
    id: manifest.name,
    version: manifest.version,
    instructions: agent.instructions,
    ...(skills.length === 0 ? {} : { skills: skills.map((skill) => ({ name: skill.name, content: skill.content, ...runtimeFiles(skill) })) }),
    tools: [...(manifest.tools ?? knownTools)],
    ...(manifest.denyCommandPatterns === undefined ? {} : { denyCommandPatterns: [...manifest.denyCommandPatterns] }),
    ...(manifest.thinking === undefined ? {} : { thinking: manifest.thinking }),
  };
}
