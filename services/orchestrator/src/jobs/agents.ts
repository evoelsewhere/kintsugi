// Agent definitions for job runs (ADR-0026): resolved by name across the built-in catalog
// shipped in packages/agents/builtin and the custom agents of the Agent Builder
// (admin.agent, admin.agent_skill), validated against the kernel tools and converted to
// the AgentDefinition a JobSpec carries (@kintsugi/agents resolveAgentDefinition).

import { AgentResolutionError, type BuiltinCatalog, type CustomAgentStore, loadBuiltinCatalog, resolveAgentDefinition } from "@kintsugi/agents";
import { KERNEL_TOOL_NAMES } from "@kintsugi/runtime/tool-names";
import type { AgentDefinition } from "@kintsugi/runtime-sdk";
import type { Pool } from "pg";
import { JobFailure } from "./model.js";

export interface AgentResolver {
  definition(name: string): Promise<AgentDefinition>;
}

/** Built-in agents plus, with a pool, the installation's enabled custom agents. */
export function installedAgents(options: { dir?: string; pool?: Pick<Pool, "query"> } = {}): AgentResolver {
  let catalog: Promise<BuiltinCatalog> | undefined;
  const store = options.pool === undefined ? undefined : pgCustomAgents(options.pool);
  return {
    async definition(name) {
      catalog ??= loadBuiltinCatalog(options.dir).catch((error: unknown) => {
        catalog = undefined;
        throw error;
      });
      try {
        const resolved = await resolveAgentDefinition(name, { builtin: await catalog, knownTools: KERNEL_TOOL_NAMES, ...(store === undefined ? {} : { store }) });
        return resolved.definition;
      } catch (error) {
        throw error instanceof AgentResolutionError ? new JobFailure(error.message) : error;
      }
    },
  };
}

/** The built-in catalog only. */
export function builtinAgents(dir?: string): AgentResolver {
  return installedAgents(dir === undefined ? {} : { dir });
}

/** Custom agents and shared skills from migration 012; none while it is not applied yet. */
export function pgCustomAgents(pool: Pick<Pool, "query">): CustomAgentStore {
  const missingTable = (error: unknown): boolean => (error as { code?: string }).code === "42P01";
  return {
    async agent(name) {
      try {
        const result = await pool.query<{ package: Record<string, string>; enabled: boolean }>("select package, enabled from admin.agent where name = $1", [name]);
        const row = result.rows[0];
        return row === undefined ? undefined : { files: row.package, enabled: row.enabled };
      } catch (error) {
        if (missingTable(error)) return undefined;
        throw error;
      }
    },
    async skills() {
      try {
        return (await pool.query<{ name: string; text: string }>("select name, content as text from admin.agent_skill")).rows;
      } catch (error) {
        if (missingTable(error)) return [];
        throw error;
      }
    },
  };
}
