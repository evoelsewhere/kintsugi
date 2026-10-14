// Typed access to the Agent Builder (Administration → Agents, ADR-0026).
// Mirrors apps/api → modules/admin/agents.

import type { ThinkingLevel } from "@kintsugi/domain";
import { ApiError, apiGet, apiSend, type ApiErrorBody } from "../api";
import type { AgentModelBindingInput } from "./providers";

export type AgentAudience = "runtime" | "member";
export type AgentSource = "builtin" | "custom";

export interface SkillPackage {
  name: string;
  description: string;
  content: string;
  license?: string;
  /** Files beside SKILL.md (references/, scripts/, assets/), by relative path. */
  files?: Record<string, string>;
}

export interface AgentManifest {
  name: string;
  audience: AgentAudience;
  version: string;
  description: string;
  tools: string[];
  skills: string[];
  thinking?: ThinkingLevel;
  denyCommandPatterns?: string[];
  metadata?: Record<string, string>;
}

export interface AgentSummary {
  name: string;
  source: AgentSource;
  audience: AgentAudience;
  version: string;
  description: string;
  enabled: boolean;
  problems: string[];
  copiedFrom?: string;
  updatedAt?: string;
  updatedBy?: string;
  binding?: { provider: string; model: string; thinking?: ThinkingLevel };
}

export interface AgentDetail extends AgentSummary {
  manifest?: AgentManifest;
  instructions: string;
  localSkills: SkillPackage[];
  files: Record<string, string>;
  bindings: AgentModelBindingInput[];
}

export interface AgentDraft {
  name: string;
  audience: AgentAudience;
  version: string;
  description: string;
  tools: string[];
  skills: string[];
  thinking?: ThinkingLevel;
  denyCommandPatterns?: string[];
  metadata?: Record<string, string>;
  instructions: string;
  localSkills: SkillPackage[];
}

export interface AgentDefinition {
  id: string;
  version: string;
  instructions: string;
  skills?: { name: string; content: string }[];
  tools: string[];
  denyCommandPatterns?: string[];
  thinking?: ThinkingLevel;
}

export interface AgentPreview {
  problems: string[];
  files: Record<string, string>;
  definition?: AgentDefinition;
}

export interface AgentVersionView {
  version: string;
  createdBy?: string;
  createdAt: string;
  current: boolean;
}

export interface SharedSkillView {
  name: string;
  source: AgentSource;
  description: string;
  content: string;
  /** Files beside SKILL.md (references, scripts, assets, licenses); only built-in skills carry any. */
  files: Array<{ path: string; content: string }>;
  usedBy: string[];
  problems: string[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface AgentBuilderContext {
  kernelTools: string[];
  sharedSkills: { name: string; description: string; source: AgentSource }[];
  reservedNames: string[];
}

export type AgentImport = { files: Record<string, string> } | { zip: string };

const BASE = "/api/admin/agents";
const SKILLS = "/api/admin/agent-skills";
const at = (name: string): string => `${BASE}/${encodeURIComponent(name)}`;

/** Downloads an agent package (ZIP) through the browser. */
async function download(name: string, version?: string): Promise<void> {
  const response = await fetch(`${at(name)}/export${version === undefined ? "" : `?version=${encodeURIComponent(version)}`}`, { credentials: "same-origin" });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ApiErrorBody | null;
    throw new ApiError(response.status, body ?? { success: false, statusCode: response.status, error: response.statusText, message: "Export failed", timestamp: new Date().toISOString(), path: response.url });
  }
  const fileName = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? `${name}.zip`;
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export const agentsApi = {
  list: () => apiGet<AgentSummary[]>(BASE),
  context: () => apiGet<AgentBuilderContext>(`${BASE}/context`),
  get: (name: string) => apiGet<AgentDetail>(at(name)),
  definition: (name: string) => apiGet<AgentDefinition>(`${at(name)}/definition`),
  preview: (draft: AgentDraft) =>apiSend<AgentPreview>(`${BASE}/preview`, "POST", draft),
  create: (draft: AgentDraft) => apiSend<AgentDetail>(BASE, "POST", draft),
  update: (name: string, draft: AgentDraft) => apiSend<AgentDetail>(at(name), "PUT", draft),
  setEnabled: (name: string, enabled: boolean) => apiSend<AgentDetail>(at(name), "PATCH", { enabled }),
  remove: (name: string) => apiSend<void>(at(name), "DELETE"),
  copy: (name: string, newName: string) => apiSend<AgentDetail>(`${at(name)}/copy`, "POST", { name: newName }),
  import: (input: AgentImport) => apiSend<{ created: boolean; agent: AgentDetail }>(`${BASE}/import`, "POST", input),
  export: download,
  versions: (name: string) => apiGet<AgentVersionView[]>(`${at(name)}/versions`),
  restore: (name: string, version: string) => apiSend<AgentDetail>(`${at(name)}/versions/${encodeURIComponent(version)}/restore`, "POST"),
  listSkills: () => apiGet<SharedSkillView[]>(SKILLS),
  getSkill: (name: string) => apiGet<SharedSkillView>(`${SKILLS}/${encodeURIComponent(name)}`),
  createSkill: (skill: SkillPackage) => apiSend<SharedSkillView>(SKILLS, "POST", skill),
  updateSkill: (name: string, skill: SkillPackage) => apiSend<SharedSkillView>(`${SKILLS}/${encodeURIComponent(name)}`, "PUT", skill),
  removeSkill: (name: string) => apiSend<void>(`${SKILLS}/${encodeURIComponent(name)}`, "DELETE"),
};
