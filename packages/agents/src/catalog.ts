// Agent resolution (ADR-0026): the one place that turns an agent name into a package and,
// for runtime agents, into the AgentDefinition a job carries. An installation's agents are
// the built-in catalog (read-only, names reserved) plus the custom agents admins keep in
// the Agent Builder (Postgres, admin.agent); its shared skills are the built-in skill
// library plus the custom shared skills (admin.agent_skill). Names are unambiguous: a
// custom agent or skill can never take a built-in name.

import type { AgentDefinition } from "@kintsugi/runtime-sdk";
import type { BuiltinCatalog } from "./builtin.js";
import { toAgentDefinition, validateAgent } from "./definition.js";
import { type AgentPackage, parseAgentPackage, parseSkill, type Parsed, type SkillPackage } from "./format.js";

export type AgentSource = "builtin" | "custom";

/** A custom agent as stored: its package files (relative path → content). */
export interface StoredAgent {
  files: Record<string, string>;
  enabled: boolean;
}

/** A custom shared skill as stored: its SKILL.md text and the files beside it. */
export interface StoredSkill {
  name: string;
  text: string;
  files?: Record<string, string>;
}

/** Where the installation keeps custom agents and shared skills (implemented over admin.*). */
export interface CustomAgentStore {
  agent(name: string): Promise<StoredAgent | undefined>;
  skills(): Promise<StoredSkill[]>;
}

export interface ResolveOptions {
  builtin: BuiltinCatalog;
  /** Absent: built-in agents only. */
  store?: CustomAgentStore;
  /** Kernel tool names (`@kintsugi/runtime/tool-names`). */
  knownTools: readonly string[];
}

export interface ResolvedAgent {
  agent: AgentPackage;
  source: AgentSource;
  /** The installation's shared skills, by name. */
  sharedSkills: ReadonlyMap<string, SkillPackage>;
  /** Problems that keep it from running here (validateAgent); [] when it can run. */
  problems: string[];
}

export type Resolution = { ok: true; value: ResolvedAgent } | { ok: false; reason: "unknown" | "disabled" | "invalid"; message: string };

/** Re-reads stored package files with the full format checks. */
export function parseStoredAgent(files: Record<string, string>): Parsed<AgentPackage> {
  return parseAgentPackage(new Map(Object.entries(files)));
}

/** Built-in shared skills plus the valid stored ones (a stored skill never shadows a built-in). */
export function installationSkills(builtin: BuiltinCatalog, stored: readonly StoredSkill[]): Map<string, SkillPackage> {
  const skills = new Map(builtin.skills.map((skill) => [skill.name, skill]));
  for (const entry of stored) {
    if (skills.has(entry.name)) continue;
    const parsed = parseSkill(entry.text, entry.name);
    if (parsed.ok) skills.set(entry.name, entry.files === undefined || Object.keys(entry.files).length === 0 ? parsed.value : { ...parsed.value, files: entry.files });
  }
  return skills;
}

/** Resolves an agent by name: a built-in first (names are reserved), else an enabled custom agent. */
export async function resolveAgent(name: string, options: ResolveOptions): Promise<Resolution> {
  let agent: AgentPackage | undefined = options.builtin.agents.find((entry) => entry.manifest.name === name);
  let source: AgentSource = "builtin";
  if (agent === undefined) {
    const stored = await options.store?.agent(name);
    if (stored === undefined) return { ok: false, reason: "unknown", message: `Unknown agent "${name}"` };
    if (!stored.enabled) return { ok: false, reason: "disabled", message: `Agent "${name}" is disabled` };
    const parsed = parseStoredAgent(stored.files);
    if (!parsed.ok) return { ok: false, reason: "invalid", message: `Agent "${name}" is not a valid package: ${parsed.problems.join("; ")}` };
    agent = parsed.value;
    source = "custom";
  }
  const sharedSkills = installationSkills(options.builtin, (await options.store?.skills()) ?? []);
  return { ok: true, value: { agent, source, sharedSkills, problems: validateAgent(agent, { knownTools: options.knownTools, sharedSkills }) } };
}

/** A failure to turn a name into a runnable definition; the message is safe to show. */
export class AgentResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentResolutionError";
  }
}

/** The definition a job embeds for agent `name`; throws AgentResolutionError when it cannot run. */
export async function resolveAgentDefinition(name: string, options: ResolveOptions): Promise<{ definition: AgentDefinition; source: AgentSource }> {
  const resolution = await resolveAgent(name, options);
  if (!resolution.ok) throw new AgentResolutionError(resolution.message);
  const { agent, source, sharedSkills, problems } = resolution.value;
  if (agent.manifest.audience !== "runtime") throw new AgentResolutionError(`Agent "${name}" is a member agent; the runtime does not run it`);
  if (problems.length > 0) throw new AgentResolutionError(`Agent "${name}" cannot run: ${problems.join("; ")}`);
  return { definition: toAgentDefinition(agent, sharedSkills, options.knownTools), source };
}
