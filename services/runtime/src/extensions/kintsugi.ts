// Kintsugi pi extensions (fixed in code, ADR-0014):
//   - system-prompt: replaces pi's default system prompt with the agent's prompt;
//   - policy: enforces ToolPolicy.denyBashPatterns at tool-call time and reports
//     blocked calls to the job (the allowlist itself is enforced at session creation).

import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { ToolPolicy } from "@kintsugi/runtime-sdk";

export interface PolicySink {
  /** Called when a tool call is blocked by policy. */
  blocked(tool: string, reason: string, input: unknown): void;
}

export function createSystemPromptExtension(prompt: string): ExtensionFactory {
  return (pi: ExtensionAPI): void => {
    pi.on("before_agent_start", () => ({ systemPrompt: prompt }));
  };
}

export function createPolicyExtension(policy: ToolPolicy, sink?: PolicySink): ExtensionFactory {
  const patterns = policy.denyBashPatterns ?? [];
  const deny = patterns.map((pattern) => new RegExp(pattern));
  return (pi: ExtensionAPI): void => {
    pi.on("tool_call", (event) => {
      if (event.toolName !== "bash" && event.toolName !== "powershell") return undefined;
      const command = String((event.input as { command?: unknown }).command ?? "");
      const match = deny.find((expression) => expression.test(command));
      if (match === undefined) return undefined;
      const reason = `command denied by agent policy (/${match.source}/)`;
      sink?.blocked(event.toolName, reason, event.input);
      return { block: true, reason };
    });
  };
}
