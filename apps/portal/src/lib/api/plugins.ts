// Typed access to the plugin marketplace (Administration → Plugins, ADR-0035).
// Mirrors apps/api → modules/admin/plugins.

import { apiGet } from "../api";

export type PluginAudience = "runtime" | "member" | "both";
export type PluginComponentKind = "agent" | "command" | "skill" | "workflow" | "script" | "hook";

export interface PluginSummary {
  name: string;
  title: string;
  version: string;
  description: string;
  audience: PluginAudience;
  source: "builtin";
  /** Components per kind. */
  counts: Partial<Record<PluginComponentKind, number>>;
}

export interface PluginComponent {
  kind: PluginComponentKind;
  name: string;
  /** Main file of the component inside the plugin. */
  path: string;
  description: string;
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
  path: string;
  /** Workflow: the agents it starts and the scripts it names. */
  agents?: string[];
  scripts?: string[];
}

/** What a stage runs, in order, as its command declares it (kept equal to the stage plan by a test). */
export type FlowNode =
  | { kind: "script"; name: string; label?: string; generated?: boolean; repair?: string }
  | { kind: "agent"; name: string; label?: string }
  | { kind: "workflow"; name: string; label?: string }
  | { kind: "parallel"; steps: FlowNode[] }
  | { kind: "each"; label: string; step: FlowNode }
  | { kind: "gate"; label: string };

/** How one command works: what it reads, what it runs, what it writes and where a person decides. */
export interface PluginFlow {
  command: string;
  path: string;
  description: string;
  audience: string;
  reads: string[];
  steps: PluginFlowStep[];
  writes: string[];
  gates: string[];
  /** The declared order of what runs, with groups; absent when the command declares none. */
  flow?: FlowNode[];
}

/** A command whose output another command reads. */
export interface PluginLink {
  from: string;
  to: string;
  via: string[];
}

export interface PluginDetail extends PluginSummary {
  components: PluginComponent[];
  files: PluginFile[];
  flows: PluginFlow[];
  pipeline: PluginLink[];
}

const PLUGINS = "/api/admin/plugins";

export const pluginsApi = {
  list: () => apiGet<PluginSummary[]>(PLUGINS),
  get: (name: string) => apiGet<PluginDetail>(`${PLUGINS}/${encodeURIComponent(name)}`),
  file: (name: string, path: string) => apiGet<{ path: string; content: string }>(`${PLUGINS}/${encodeURIComponent(name)}/file?path=${encodeURIComponent(path)}`),
};

/** Display order and labels of the component kinds. */
export const COMPONENT_KINDS: ReadonlyArray<{ kind: PluginComponentKind; label: string; plural: string }> = [
  { kind: "command", label: "Command", plural: "Commands" },
  { kind: "agent", label: "Agent", plural: "Agents" },
  { kind: "skill", label: "Skill", plural: "Skills" },
  { kind: "workflow", label: "Workflow", plural: "Workflows" },
  { kind: "script", label: "Script", plural: "Scripts" },
  { kind: "hook", label: "Hook", plural: "Hooks" },
];
