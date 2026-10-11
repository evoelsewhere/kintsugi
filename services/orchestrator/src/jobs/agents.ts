// Agent definitions for job runs (ADR-0026): the built-in catalog shipped in
// packages/agents/builtin, validated against the kernel tools and converted to the
// AgentDefinition a JobSpec carries. Admin-created agents join here when they are stored.

import { type BuiltinCatalog, loadBuiltinCatalog, toAgentDefinition, validateAgent } from "@kintsugi/agents";
import { KERNEL_TOOL_NAMES } from "@kintsugi/runtime/tool-names";
import type { AgentDefinition } from "@kintsugi/runtime-sdk";
import { JobFailure } from "./model.js";

export interface AgentResolver {
  definition(name: string): Promise<AgentDefinition>;
}

export function builtinAgents(dir?: string): AgentResolver {
  let catalog: Promise<BuiltinCatalog> | undefined;
  return {
    async definition(name) {
      catalog ??= loadBuiltinCatalog(dir).catch((error: unknown) => {
        catalog = undefined;
        throw error;
      });
      const { agents, skills } = await catalog;
      const agent = agents.find((entry) => entry.manifest.name === name);
      if (agent === undefined) throw new JobFailure(`Unknown agent "${name}"`);
      if (agent.manifest.audience !== "runtime") throw new JobFailure(`Agent "${name}" is a member agent; the runtime does not run it`);
      const sharedSkills = new Map(skills.map((skill) => [skill.name, skill]));
      const problems = validateAgent(agent, { knownTools: KERNEL_TOOL_NAMES, sharedSkills });
      if (problems.length > 0) throw new JobFailure(`Agent "${name}" cannot run: ${problems.join("; ")}`);
      return toAgentDefinition(agent, sharedSkills);
    },
  };
}
