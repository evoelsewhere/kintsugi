// Postgres adapter for the agent registry (ADR-0022). The launcher resolves the job's
// agent definition here and embeds it into the JobSpec so the runner stays stateless.
// TODO: move to the worker's shared layer when services/orchestrator lands.

import type { ResolvedAgent } from "@kintsugi/runtime-sdk";
import type { ThinkingLevel } from "@kintsugi/domain";
import { Pool } from "pg";

interface AgentRow {
  id: string;
  version: string;
  system_prompt: string;
  skills: Array<{ path?: string; content?: string }>;
  allow_tools: string[];
  deny_bash_patterns: string[];
  thinking: string;
  budget: ResolvedAgent["budget"];
}

export async function loadAgent(agentId: string, databaseUrl = process.env["DATABASE_URL"]): Promise<ResolvedAgent | undefined> {
  if (databaseUrl === undefined || databaseUrl === "") throw new Error("DATABASE_URL is not set");
  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const result = await pool.query<AgentRow>(
      `select id, version, system_prompt, skills, allow_tools, deny_bash_patterns, thinking, budget
       from admin.agent where id = $1 and enabled`,
      [agentId],
    );
    const row = result.rows[0];
    if (row === undefined) return undefined;
    return {
      id: row.id,
      version: row.version,
      systemPrompt: row.system_prompt,
      skills: row.skills,
      allowTools: row.allow_tools,
      denyBashPatterns: row.deny_bash_patterns,
      thinking: row.thinking as ThinkingLevel,
      budget: row.budget,
    };
  } finally {
    await pool.end();
  }
}
