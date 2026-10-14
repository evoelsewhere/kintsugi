// Domain of the plugin catalog (ADR-0035): what a plugin is, as the marketplace and the plugin page show it.

import type { PluginAudience, PluginComponent, PluginFile, PluginFlow, PluginLink } from "@kintsugi/agents";

export type PluginSource = "builtin";

/** A catalog entry: the card of the marketplace. */
export interface PluginSummary {
  name: string;
  title: string;
  version: string;
  description: string;
  audience: PluginAudience;
  source: PluginSource;
  /** How many components of each kind the plugin carries (agent, command, skill, workflow, script, hook). */
  counts: Record<string, number>;
}

/** A plugin with its components and the files of its folder. */
export interface PluginDetail extends PluginSummary {
  components: PluginComponent[];
  files: PluginFile[];
  /** How each command works end to end. */
  flows: PluginFlow[];
  /** Which command feeds which: the plugin's pipeline. */
  pipeline: PluginLink[];
}

export interface PluginFileContent {
  path: string;
  content: string;
}
