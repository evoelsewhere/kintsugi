// Runtime Agent Builder catalog from the release (packages/agents/builtin), loaded once, and
// the kernel tool names (importable without pi). The separate member plugin catalog retains
// member skills; only skills referenced by runtime agents are shared with runtime agents.

import { Injectable } from "@nestjs/common";
import { type BuiltinCatalog, loadBuiltinCatalog } from "@kintsugi/agents";
import { KERNEL_TOOL_NAMES } from "@kintsugi/runtime/tool-names";
import { AgentCatalog } from "../domain/agent.repository.js";

@Injectable()
export class PackagedAgentCatalog extends AgentCatalog {
  readonly kernelTools: readonly string[] = KERNEL_TOOL_NAMES;
  #catalog: Promise<BuiltinCatalog> | undefined;

  builtin(): Promise<BuiltinCatalog> {
    this.#catalog ??= loadBuiltinCatalog().then((catalog) => {
      const runtimeSkillNames = new Set(
        catalog.agents
          .filter((agent) => agent.manifest.audience === "runtime")
          .flatMap((agent) => agent.manifest.skills ?? []),
      );
      return { ...catalog, skills: catalog.skills.filter((skill) => runtimeSkillNames.has(skill.name)) };
    }).catch((error: unknown) => {
      this.#catalog = undefined;
      throw error;
    });
    return this.#catalog;
  }
}
