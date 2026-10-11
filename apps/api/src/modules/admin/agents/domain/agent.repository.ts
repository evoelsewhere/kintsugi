// Ports of the Agent Builder: storage of custom agents and shared skills (PgAgentRepository)
// and the release's built-in catalog plus the kernel tool names (PackagedAgentCatalog).

import type { BuiltinCatalog } from "@kintsugi/agents";
import type { AgentVersionRecord, CustomAgentRecord, SaveAgent, SharedSkillRecord } from "./agent.js";

export abstract class AgentRepository {
  abstract list(): Promise<CustomAgentRecord[]>;
  abstract get(name: string): Promise<CustomAgentRecord | undefined>;
  /** Inserts the agent and its first version; false when the name is taken. */
  abstract create(agent: SaveAgent, actor: string): Promise<boolean>;
  /** Makes `agent` the current version and records it; false when that version exists. */
  abstract saveVersion(agent: SaveAgent, actor: string): Promise<boolean>;
  /** Makes a recorded version current again. */
  abstract restore(name: string, version: AgentVersionRecord, audience: CustomAgentRecord["audience"], actor: string): Promise<void>;
  abstract setEnabled(name: string, enabled: boolean, actor: string): Promise<boolean>;
  abstract remove(name: string): Promise<boolean>;
  /** Newest first. */
  abstract versions(name: string): Promise<AgentVersionRecord[]>;
  abstract version(name: string, version: string): Promise<AgentVersionRecord | undefined>;

  abstract listSkills(): Promise<SharedSkillRecord[]>;
  abstract getSkill(name: string): Promise<SharedSkillRecord | undefined>;
  /** False when the name is taken. */
  abstract createSkill(name: string, content: string, actor: string): Promise<boolean>;
  abstract updateSkill(name: string, content: string, actor: string): Promise<boolean>;
  abstract removeSkill(name: string): Promise<boolean>;
}

export abstract class AgentCatalog {
  /** The built-in agents and shared skills of this release. */
  abstract builtin(): Promise<BuiltinCatalog>;
  /** The kernel's tool names, the only tools a runtime agent may list. */
  abstract readonly kernelTools: readonly string[];
}
