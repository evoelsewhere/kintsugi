// Interface layer: request schemas of the Agent Builder. They check shapes and sizes only;
// the package format and the installation checks run in the application layer, so the
// editor gets every problem of a draft at once.

import { THINKING_LEVELS } from "@kintsugi/domain";
import { z } from "zod";
import type { AgentDraft, AgentImport, SkillDraft } from "../domain/agent.js";

const shortText = z.string().max(200);
const nameField = z.string().min(1).max(64);

export const skillDraftSchema = z.object({
  name: nameField,
  description: z.string().max(1024),
  content: z.string().max(100_000),
  license: shortText.optional(),
});

export const agentDraftSchema = z.object({
  name: nameField,
  audience: z.enum(["runtime", "member"]),
  version: z.string().min(1).max(64),
  description: z.string().max(1024),
  tools: z.array(shortText).max(100),
  skills: z.array(shortText).max(100),
  thinking: z.enum(THINKING_LEVELS).optional(),
  denyCommandPatterns: z.array(z.string().max(1000)).max(100).optional(),
  metadata: z.record(shortText, z.string().max(2000)).optional(),
  instructions: z.string().max(100_000),
  localSkills: z.array(skillDraftSchema).max(50),
});
export type AgentDraftInput = z.infer<typeof agentDraftSchema>;

export const copyAgentSchema = z.object({ name: nameField });
export type CopyAgentInput = z.infer<typeof copyAgentSchema>;

export const setEnabledSchema = z.object({ enabled: z.boolean() });
export type SetEnabledInput = z.infer<typeof setEnabledSchema>;

export const importAgentSchema = z.union([
  z.object({ files: z.record(z.string().min(1).max(300), z.string().max(200_000)).refine((files) => Object.keys(files).length <= 100, "at most 100 files") }),
  z.object({ zip: z.string().min(1).max(3_000_000) }),
]);
export type ImportAgentInput = z.infer<typeof importAgentSchema>;

export const exportQuerySchema = z.object({ version: z.string().min(1).max(64).optional() });
export type ExportQuery = z.infer<typeof exportQuerySchema>;

export function toDraft(input: AgentDraftInput): AgentDraft {
  return {
    ...input,
    localSkills: input.localSkills.map(toSkillDraft),
  } as AgentDraft;
}

export function toSkillDraft(input: z.infer<typeof skillDraftSchema>): SkillDraft {
  return { name: input.name, description: input.description, content: input.content, ...(input.license === undefined ? {} : { license: input.license }) };
}

export function toImport(input: ImportAgentInput): AgentImport {
  return "zip" in input ? { zip: input.zip } : { files: input.files };
}
