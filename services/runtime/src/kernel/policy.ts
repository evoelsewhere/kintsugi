// Kernel pi extensions: the system prompt (instructions + skills, verbatim) and the
// command policy (denyCommandPatterns, checked at tool-call time). The tool allowlist
// itself is enforced when the session is created: tools outside it are never registered.

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition, JobSpec } from "@kintsugi/runtime-sdk";

/**
 * Where things are, in the agent's own terms. The read tools resolve a relative path against the
 * first read-only root while write and edit resolve it against the output directory, and nothing
 * written can be read back: without this an agent prefixes its output paths with the checkout's
 * name, then goes looking for what it wrote.
 */
export function describeWorkspace(workspace: JobSpec["workspace"], tools: readonly string[]): string {
  const [checkout, ...others] = workspace.readOnly;
  const lines = [`Read tools (read, ls, grep, find) are read-only and resolve a relative path against the source checkout (${checkout}).`];
  if (others.length > 0) lines.push(`Other readable locations, by absolute path: ${others.join(", ")}.`);
  if (tools.includes("write") || tools.includes("edit")) {
    lines.push(
      "write and edit work only in the output directory: give them a path relative to it, never an absolute path and never prefixed with the checkout's name or `src/`.",
      "The output directory is not readable with the read tools: do not read, ls or find what you wrote, and do not rewrite a file to check it. A path the read tools reject as outside the workspace is not a place to write instead.",
    );
  }
  return ["<workspace>", ...lines, "</workspace>"].join("\n");
}

/** The agent's instructions, the workspace note when given, then its skills, each in a named block. */
export function composeSystemPrompt(agent: AgentDefinition, workspace?: JobSpec["workspace"]): string {
  const parts = [agent.instructions.trim()];
  if (workspace !== undefined) parts.push(describeWorkspace(workspace, agent.tools));
  for (const skill of agent.skills ?? []) {
    const supporting =
      skill.supporting === undefined || skill.supporting.paths.length === 0
        ? ""
        : `\n\nSupporting files of this skill, read only when you need them (read tool), under ${skill.supporting.dir}:\n${skill.supporting.paths.map((path) => `- ${path}`).join("\n")}`;
    parts.push(`<skill name="${skill.name}">\n${skill.content.trim()}${supporting}\n</skill>`);
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
