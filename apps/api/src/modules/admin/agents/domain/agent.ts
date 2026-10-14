// Agent Builder domain (ADR-0026, ADR-0027): custom agents and shared skills as the
// installation stores them, and the views the API returns. Built-in agents and skills come
// from the release (packages/agents/builtin) and are read-only.

import type { AgentAudience, AgentManifest, AgentSource, SkillPackage } from "@kintsugi/agents";
import type { AgentDefinition, AgentModelBinding } from "@kintsugi/runtime-sdk";

export type { AgentAudience, AgentSource };

/** Package files: relative POSIX path → content. */
export type PackageFileMap = Record<string, string>;

/** The current version of a custom agent (admin.agent). */
export interface CustomAgentRecord {
  name: string;
  audience: AgentAudience;
  version: string;
  files: PackageFileMap;
  enabled: boolean;
  copiedFrom?: string;
  createdBy?: string;
  createdAt: string;
  updatedBy?: string;
  updatedAt: string;
}

/** A saved version (admin.agent_version), immutable. */
export interface AgentVersionRecord {
  version: string;
  files: PackageFileMap;
  createdBy?: string;
  createdAt: string;
}

/** A new custom agent or a new version of one. */
export interface SaveAgent {
  name: string;
  audience: AgentAudience;
  version: string;
  files: PackageFileMap;
  copiedFrom?: string;
}

/** An agent as the editor sends it: frontmatter fields, instructions and agent-local skills. */
export interface AgentDraft {
  name: string;
  audience: AgentAudience;
  version: string;
  description: string;
  tools: string[];
  skills: string[];
  thinking?: AgentManifest["thinking"];
  denyCommandPatterns?: string[];
  metadata?: Record<string, string>;
  instructions: string;
  localSkills: SkillDraft[];
}

export interface SkillDraft {
  name: string;
  description: string;
  content: string;
  license?: string;
}

/** Import: package files, or a base64 ZIP of `<name>.md` and `skills/<n>/SKILL.md`. */
export type AgentImport = { files: PackageFileMap } | { zip: string };

/** A custom shared skill (admin.agent_skill): its SKILL.md text. */
export interface SharedSkillRecord {
  name: string;
  content: string;
  createdBy?: string;
  updatedBy?: string;
  updatedAt: string;
}

/** The installation-default model binding of an agent (Settings → Providers). */
export type AgentBinding = Omit<AgentModelBinding, "agent" | "projectId">;

export interface AgentSummary {
  name: string;
  source: AgentSource;
  audience: AgentAudience;
  version: string;
  description: string;
  /** Built-in agents are always enabled. */
  enabled: boolean;
  /** Problems that keep it from running on this installation; [] when valid. */
  problems: string[];
  copiedFrom?: string;
  updatedAt?: string;
  updatedBy?: string;
  /** The installation-default model binding, when one is set. */
  binding?: AgentBinding;
}

export interface AgentDetail extends AgentSummary {
  /** Undefined only when a stored package no longer parses (see problems). */
  manifest?: AgentManifest;
  instructions: string;
  localSkills: SkillPackage[];
  files: PackageFileMap;
  /** Every model binding of this agent: the installation default and per project. */
  bindings: AgentModelBinding[];
}

export interface AgentVersionView {
  version: string;
  createdBy?: string;
  createdAt: string;
  current: boolean;
}

export interface AgentVersionDetail extends AgentVersionView {
  files: PackageFileMap;
}

/** Dry run of an unsaved draft: what would be stored and, for runtime agents, the job definition. */
export interface AgentPreview {
  problems: string[];
  files: PackageFileMap;
  definition?: AgentDefinition;
}

export interface SharedSkillView {
  name: string;
  source: AgentSource;
  description: string;
  content: string;
  /** Files beside SKILL.md (references, scripts, assets, licenses); only built-in skills carry any. */
  files: Array<{ path: string; content: string }>;
  /** Agents (built-in and custom) that reference it. */
  usedBy: string[];
  problems: string[];
  updatedAt?: string;
  updatedBy?: string;
}

/** What the editor needs to offer valid choices. */
export interface AgentBuilderContext {
  kernelTools: readonly string[];
  sharedSkills: { name: string; description: string; source: AgentSource }[];
  /** Names of built-in agents and skills; custom ones cannot use them. */
  reservedNames: string[];
}
