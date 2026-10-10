// System prompt builder — base runtime prompt + agent role + skills + job context.
// Skills load from the package's agents/<id>/ assets, fixed in code (ADR-0014).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { describeInputs } from "../job-inputs.js";
import type { AgentDefinition } from "./catalog.js";

const PACKAGE_ROOT = resolve(import.meta.dirname, "../..");

const skillCache = new Map<string, string>();

function loadSkill(path: string): string {
  const cached = skillCache.get(path);
  if (cached !== undefined) return cached;
  const content = readFileSync(resolve(PACKAGE_ROOT, path), "utf8");
  skillCache.set(path, content);
  return content;
}

export function buildSystemPrompt(spec: JobSpec, definition: AgentDefinition): string {
  return buildJobSystemPrompt(spec, definition.systemPrompt, (definition.skills ?? []).map(loadSkill));
}

/** Skill texts for a DB-resolved agent (inline content or file paths, ADR-0022). */
export function resolveSkillTexts(skills: Array<{ path?: string; content?: string }>): string[] {
  return skills.map((skill) => skill.content ?? (skill.path === undefined ? "" : loadSkill(skill.path))).filter((text) => text !== "");
}

export function buildJobSystemPrompt(spec: JobSpec, rolePrompt: string, skillTexts: string[]): string {
  const commit = spec.rulebook.commit === undefined ? "" : ` @ ${spec.rulebook.commit}`;
  const lines = [
    `You are the Kintsugi runtime agent "${spec.agent.id}" (v${spec.agent.version}) — a server-side platform agent (ADR-0014).`,
    "The source checkout is read-only. Write deliverables to /out with the outputs_write tool.",
    `Project: ${spec.context.projectId}${spec.context.applicationId === undefined ? "" : ` / application ${spec.context.applicationId}`} · trigger: ${spec.context.trigger}.`,
    `Rulebook: ${spec.rulebook.version}${commit} · packs: ${spec.packs.join(", ") || "(none)"} · required capabilities: ${spec.requires.join(", ") || "(none)"}.`,
    `Inputs: ${describeInputs(spec.inputs) || "(none)"}.`,
    "",
    "## Role",
    rolePrompt,
    "",
    "## Ground rules",
    "- Read the sources before claiming anything; cite file paths and rule IDs.",
    "- If information is missing, say what is missing instead of guessing.",
    "- Keep deliverables structured and tight; every accepted difference needs a cited rule or ADR.",
  ];

  for (const [index, text] of skillTexts.entries()) {
    lines.push("", `## Skill ${index + 1}`, text.trim());
  }

  if (spec.instruction) {
    lines.push("", "## Task instruction", spec.instruction);
  }
  return lines.join("\n");
}
