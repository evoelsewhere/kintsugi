// A locked-down pi session for one job (ADR-0023). pi discovers a lot by default: context
// files (AGENTS.md / CLAUDE.md up to the filesystem root), `.pi/` extensions, skills,
// prompts and settings in the checkout, SYSTEM.md, packages and MCP servers. None of
// that is allowed to shape a job: everything the agent gets comes from the JobSpec.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  type AgentSession,
  type ExtensionFactory,
  type ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { JobSpec, JobServices } from "@kintsugi/runtime-sdk";
import { CODEMODE_TOOL, createCodemodeExtensions } from "./codemode.js";
import { compactionBudget, stableSessionId } from "./context.js";
import { createMcpKernel } from "./mcp.js";
import { composeSystemPrompt } from "./policy.js";
import { createWebSearchTools } from "./web-search.js";
import { createMemoryTools } from "./memory.js";
import { createResultTool } from "./result.js";
import { normalizeTools, RESULT_TOOL, withAliases } from "./tool-names.js";
import { createTools, type ToolContext } from "./tools.js";

type ThinkingLevelOption = NonNullable<NonNullable<Parameters<typeof createAgentSession>[0]>["thinkingLevel"]>;

export interface JobSession {
  session: AgentSession;
  /** Disposes the session and deletes its scratch directory. */
  dispose(): void;
}

export interface CreateJobSessionOptions {
  spec: JobSpec;
  modelRuntime: ModelRuntime;
  services?: JobServices;
  extensions: ExtensionFactory[];
  /** Reports a call a policy refused (a script calling a tool it may not). */
  onBlocked?: (tool: string, reason: string, input: unknown) => void;
  onOutput: ToolContext["onOutput"];
}

export async function createJobSession(options: CreateJobSessionOptions): Promise<JobSession> {
  const { spec, modelRuntime } = options;
  const model = modelRuntime.getModel(spec.model.provider, spec.model.id);
  if (model === undefined) throw new Error(`model ${spec.model.provider}/${spec.model.id} is not registered`);

  const cwd = spec.workspace.root;
  // pi needs an agent directory; a fresh empty one per job means nothing is read from the host.
  const agentDir = mkdtempSync(join(tmpdir(), "kintsugi-job-"));
  const scratch = join(agentDir, "tmp");
  mkdirSync(scratch);
  const cleanup = (): void => rmSync(agentDir, { recursive: true, force: true });

  try {
    // Compaction starts early enough for the window (context.ts), and cache warming stays off: its extra
    // requests would bill tokens the job never asked for. Retention comes from the provider (PI_CACHE_RETENTION).
    const settingsManager = SettingsManager.inMemory(
      { compaction: { enabled: true, ...compactionBudget(model.contextWindow) }, retry: { enabled: true, maxRetries: 2 }, cacheWarming: "off" },
      { projectTrusted: false },
    );
    const systemPrompt = composeSystemPrompt(spec.agent, spec.workspace);
    // codemode only for an agent that lists it (an agent without a tool list has every kernel tool).
    const onBlocked = options.onBlocked ?? (() => undefined);
    const hasCodemode = spec.agent.tools.includes(CODEMODE_TOOL);
    const mcpServers = spec.mcp?.servers ?? [];
    const mcp = mcpServers.length === 0 ? undefined : createMcpKernel({ servers: mcpServers, codemode: hasCodemode, onBlocked });
    const codemode = hasCodemode ? createCodemodeExtensions({ onBlocked, ...(mcp === undefined ? {} : { allowsNestedTool: mcp.allows }) }) : [];
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      appendSystemPrompt: [],
      systemPromptOverride: () => systemPrompt,
      extensionFactories: [...options.extensions, ...codemode, ...(mcp?.factories ?? [])],
    });
    await resourceLoader.reload();

    // The same tools in the same order for every job of the agent: tool definitions open the cached prefix.
    // A job with a result schema also gets submit_result, last: the agent's own tools keep their order.
    const tools = [...withAliases(normalizeTools(spec.agent.tools)), ...(spec.resultSchema === undefined ? [] : [RESULT_TOOL])];
    const toolContext: ToolContext = { cwd, searchDir: spec.workspace.readOnly[0]!, readOnly: spec.workspace.readOnly, outDir: spec.workspace.outDir, tmpDir: scratch, onOutput: options.onOutput };
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      model,
      thinkingLevel: (spec.model.thinking ?? spec.agent.thinking ?? "off") as ThinkingLevelOption,
      // The allowlist covers built-in, custom and extension tools alike; [] means no tools.
      tools,
      ...(tools.length === 0 ? { noTools: "all" as const } : {}),
      customTools: [...createTools(tools.filter((name) => name !== RESULT_TOOL), toolContext), ...createMemoryTools(spec, options.services ?? {}), ...createWebSearchTools(spec, options.services ?? {}), ...(spec.resultSchema === undefined ? [] : [createResultTool(spec.resultSchema, toolContext.outDir, options.onOutput)])],
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(cwd, { id: stableSessionId(spec) }),
    });
    // session_start is what connects the MCP servers (in the background: a script or the first prompt waits for the ones it needs).
    if (mcp !== undefined) await session.bindExtensions({});

    return {
      session,
      dispose: () => {
        session.dispose();
        cleanup();
      },
    };
  } catch (error) {
    cleanup();
    throw error;
  }
}
