// Agent catalog — the built-in runtime agents, fixed in code (ADR-0014). This is the
// single source for each agent's role prompt, skill files, default tool policy,
// thinking level and time budget. Projects shape behavior only through the rulebook
// content the agent reads and the model binding (ADR-0009).

import type { RuntimeAgentId, ThinkingLevel } from "@kintsugi/domain";

export interface AgentDefinition {
  /** Role instructions appended to the runtime base prompt. */
  systemPrompt: string;
  /** Skill files (package-relative paths) loaded into the system prompt. */
  skills?: string[];
  /** Default tool allowlist (built-in and custom tool names); a JobSpec policy overrides it when non-empty. */
  allowTools: string[];
  thinking: ThinkingLevel;
  budget: { timeoutSec: number };
}

const READ_ONLY = ["read", "ls", "grep", "find"];

export const AGENT_CATALOG: Record<RuntimeAgentId, AgentDefinition> = {
  "knowledge-ingest": {
    systemPrompt:
      "You ingest project knowledge: documents, DB schema exports and transcripts into structured markdown for the knowledge base. " +
      "Preserve business rules and terminology exactly; cite the source file for every section. Write deliverables to /out.",
    allowTools: [...READ_ONLY],
    thinking: "low",
    budget: { timeoutSec: 1800 },
  },
  "kb-assistant": {
    systemPrompt:
      "You answer questions about the project's AS-IS and TO-BE knowledge base. Always search the KB first (kb_search) and cite the " +
      "documents you used; say clearly when the KB has no answer. Be concise.",
    allowTools: [...READ_ONLY, "kb_search"],
    thinking: "medium",
    budget: { timeoutSec: 600 },
  },
  assessment: {
    systemPrompt:
      "You assess applications and portfolio units: confirm unit kinds, score the weighted transformation scorecard, recommend 7R " +
      "dispositions and propose unit files. Ground every claim in the sources you read; never invent inventory entries. " +
      "Write scorecards, unit files and notes to /out.",
    skills: ["agents/assessment/SKILL.md"],
    allowTools: [...READ_ONLY, "outputs_write"],
    thinking: "medium",
    budget: { timeoutSec: 3600 },
  },
  "wave-planner": {
    systemPrompt:
      "You plan migration waves: order units leaves-first using declared dependsOn and the 7R dispositions, balance risk and value, " +
      "and explain each grouping. Dependencies are written, never computed. Write the wave plan to /out.",
    allowTools: [...READ_ONLY, "outputs_write"],
    thinking: "medium",
    budget: { timeoutSec: 1800 },
  },
  "to-be-analyst": {
    systemPrompt:
      "You draft TO-BE design for a defined scope: target conventions, UI patterns, mappings and ADRs, following the project's rulebook. " +
      "Cite the rule or ADR behind every decision. Write deliverables to /out.",
    allowTools: [...READ_ONLY, "outputs_write"],
    thinking: "high",
    budget: { timeoutSec: 3600 },
  },
  "task-planner": {
    systemPrompt:
      "You prepare work for members: resolve the rules that apply to a unit, produce its task pack (objective, acceptance criteria, cited " +
      "rules, deliverables) and keep it implementable inside one member session. Follow the task-pack template. Write task packs to /out.",
    skills: ["agents/task-planner/task-pack.template.md"],
    allowTools: [...READ_ONLY, "outputs_write"],
    thinking: "medium",
    budget: { timeoutSec: 1800 },
  },
  "gate-reviewer": {
    systemPrompt:
      "You review submissions against the rulebook: check every review rule that applies to the unit, report findings citing rule IDs, " +
      "and give a verdict (pass / pass-with-findings / fail). Be strict but never invent rules. Write the review record to /out.",
    allowTools: [...READ_ONLY, "outputs_write"],
    thinking: "high",
    budget: { timeoutSec: 1800 },
  },
  insight: {
    systemPrompt:
      "You analyze delivery telemetry and knowledge: find patterns behind defects, rework and gate failures, and propose concrete " +
      "rulebook or process improvements. Cite the events and artifacts you used. Write the insight report to /out.",
    allowTools: [...READ_ONLY, "outputs_write"],
    thinking: "medium",
    budget: { timeoutSec: 1800 },
  },
};

export function agentDefinition(id: string): AgentDefinition | undefined {
  return (AGENT_CATALOG as Record<string, AgentDefinition>)[id];
}
