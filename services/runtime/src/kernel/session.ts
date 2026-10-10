// A locked-down pi session for one job (ADR-0023). pi discovers a lot by default: context
// files (AGENTS.md / CLAUDE.md up to the filesystem root), `.pi/` extensions, skills,
// prompts and settings in the checkout, SYSTEM.md, packages and MCP servers. None of
// that is allowed to shape a job: everything the agent gets comes from the JobSpec.

import { mkdtempSync, rmSync } from "node:fs";
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
import type { JobSpec } from "@kintsugi/runtime-sdk";
import { composeSystemPrompt } from "./policy.js";
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
  extensions: ExtensionFactory[];
  onOutput: ToolContext["onOutput"];
}

export async function createJobSession(options: CreateJobSessionOptions): Promise<JobSession> {
  const { spec, modelRuntime } = options;
  const model = modelRuntime.getModel(spec.model.provider, spec.model.id);
  if (model === undefined) throw new Error(`model ${spec.model.provider}/${spec.model.id} is not registered`);

  const cwd = spec.workspace.readOnly[0]!;
  // pi needs an agent directory; a fresh empty one per job means nothing is read from the host.
  const agentDir = mkdtempSync(join(tmpdir(), "kintsugi-job-"));
  const cleanup = (): void => rmSync(agentDir, { recursive: true, force: true });

  try {
    const settingsManager = SettingsManager.inMemory(
      { compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 } },
      { projectTrusted: false },
    );
    const systemPrompt = composeSystemPrompt(spec.agent);
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
      extensionFactories: options.extensions,
    });
    await resourceLoader.reload();

    const toolContext: ToolContext = { cwd, readOnly: spec.workspace.readOnly, outDir: spec.workspace.outDir, onOutput: options.onOutput };
    const { session } = await createAgentSession({
      cwd,
      agentDir,
      modelRuntime,
      model,
      thinkingLevel: (spec.model.thinking ?? spec.agent.thinking ?? "off") as ThinkingLevelOption,
      // The allowlist covers built-in, custom and extension tools alike; [] means no tools.
      tools: [...spec.agent.tools],
      ...(spec.agent.tools.length === 0 ? { noTools: "all" as const } : {}),
      customTools: createTools(spec.agent.tools, toolContext),
      resourceLoader,
      settingsManager,
      sessionManager: SessionManager.inMemory(cwd),
    });

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
