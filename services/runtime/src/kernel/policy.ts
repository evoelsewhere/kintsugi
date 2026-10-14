// Kernel pi extensions: the system prompt (instructions + skills, verbatim) and the
// command policy (denyCommandPatterns, checked at tool-call time). The tool allowlist
// itself is enforced when the session is created: tools outside it are never registered.

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { AgentDefinition } from "@kintsugi/runtime-sdk";

/** The agent's instructions followed by its skills, each in a named block. */
export function composeSystemPrompt(agent: AgentDefinition): string {
  const parts = [agent.instructions.trim()];
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
