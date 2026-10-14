// Typed access to the plugin marketplace (Administration → Plugins, ADR-0035).
// Mirrors apps/api → modules/admin/plugins.

import { apiGet } from "../api";

export type PluginAudience = "runtime" | "member";
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

export interface PluginDetail extends PluginSummary {
  components: PluginComponent[];
  files: PluginFile[];
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
