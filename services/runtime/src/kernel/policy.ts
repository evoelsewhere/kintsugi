// Kernel pi extensions: the system prompt (instructions + skills, verbatim) and the
// command policy (denyCommandPatterns, checked at tool-call time). The tool allowlist
// itself is enforced when the session is created: tools outside it are never registered.

import { basename, relative, sep } from "node:path";
import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition, JobSpec } from "@kintsugi/runtime-sdk";

/** The workspace guide the orchestrator generates at the root of a job workspace. */
export const GUIDE_FILE = "WORKSPACE.md";

/**
 * Where things are, in the agent's own terms. The agent works in the job workspace (ADR-0055): the read tools resolve
 * a relative path against its root, a search without a path looks in the first read-only directory (the as-is code),
 * while write and edit resolve a relative path against the output directory, and nothing written can be read back:
 * without this an agent prefixes its output paths with the checkout's name, then goes looking for what it wrote.
 */
export function describeWorkspace(workspace: JobSpec["workspace"], tools: readonly string[]): string {
  const shown = (path: string): string => {
    const rel = relative(workspace.root, path).split(sep).join("/");
    return rel === "" ? "." : rel;
  };
  const [first, ...others] = workspace.readOnly;
  const guide = workspace.readOnly.find((path) => basename(path) === GUIDE_FILE);
  const lines = [`Your working directory is the job workspace. Read tools (read, ls, grep, find) are read-only and resolve a relative path against it; a call without a path looks in ${shown(first!)}.`];
  const readable = [first!, ...others].map(shown);
  lines.push(`Readable locations (relative to the working directory): ${readable.join(", ")}.`);
  if (guide !== undefined) lines.push(`Read ${shown(guide)} first: it describes the workspace, the repositories in it and what earlier attempts left.`);
  if (tools.includes("write") || tools.includes("edit")) {
    lines.push(
      "write and edit work only in the output directory: give them a path relative to it, never an absolute path and never prefixed with the name of a repository or a workspace folder.",
      "The output directory is not readable with the read tools: do not read, ls or find what you wrote, and do not rewrite a file to check it. A path the read tools reject as outside the workspace is not a place to write instead.",
    );
  }
  return ["<workspace>", ...lines, "</workspace>"].join("\n");
}

/**
 * The system prompt, ordered for the provider's prompt cache (ADR-0048): a cache reuses a prompt from
 * its start up to the first difference. What every job of an agent shares comes first (instructions,
 * then each skill with its text only); what is specific to this job (the workspace paths, where a
 * skill's supporting files were placed) comes last, so the long shared part stays a reusable prefix.
 */
export function composeSystemPrompt(agent: AgentDefinition, workspace?: JobSpec["workspace"]): string {
  const parts = [agent.instructions.trim()];
  for (const skill of agent.skills ?? []) parts.push(`<skill name="${skill.name}">\n${skill.content.trim()}\n</skill>`);
  if (workspace !== undefined) parts.push(describeWorkspace(workspace, agent.tools));
  const files = (agent.skills ?? []).filter((skill) => skill.supporting !== undefined && skill.supporting.paths.length > 0);
  if (files.length > 0) {
    parts.push(
      [
        "<skill-files>",
        "Supporting files of the skills above, read only when you need them (read tool):",
        ...files.map((skill) => `${skill.name} (under ${skill.supporting!.dir}): ${skill.supporting!.paths.join(", ")}`),
        "</skill-files>",
      ].join("\n"),
    );
  }
  return parts.join("\n\n");
}

export type BlockedCallSink = (tool: string, reason: string, input: unknown) => void;

/** Blocks any tool call whose `command` input matches a deny pattern. */
export function createCommandPolicyExtension(patterns: readonly string[], onBlocked: BlockedCallSink): ExtensionFactory {
  const deny = patterns.map((pattern) => new RegExp(pattern));
  return (pi: ExtensionAPI): void => {
    if (deny.length === 0) return;
    pi.on("tool_call", (event) => {
      const command = (event.input as { command?: unknown }).command;
      if (typeof command !== "string") return undefined;
      const match = deny.find((expression) => expression.test(command));
      if (match === undefined) return undefined;
      const reason = `command denied by agent policy (/${match.source}/)`;
      onBlocked(event.toolName, reason, event.input);
      return { block: true, reason };
    });
  };
}
