// Names of the kernel tools (ADR-0023), without the tools themselves: importable without
// pi, so the API can validate agent tool allowlists (`@kintsugi/runtime/tool-names`).
// The registry in tools.ts is typed against this list, so the two cannot drift.

export const KERNEL_TOOL_NAMES = ["read", "ls", "grep", "find", "write", "edit", "shell", "git", "codemode"] as const;
export type KernelToolName = (typeof KERNEL_TOOL_NAMES)[number];

/** The tool a job with a result schema gets besides its agent's tools (result.ts), and the file it writes. */
export const RESULT_TOOL = "submit_result";
export const RESULT_FILE = "result.json";

/**
 * The allowlist deduplicated and in the kernel's own order. pi sends tool definitions in registration
 * order and a provider's prompt cache starts with them: the same tools in a different order are a
 * different prefix.
 */
export function normalizeTools(names: readonly string[]): string[] {
  const rank = (name: string): number => {
    const index = (KERNEL_TOOL_NAMES as readonly string[]).indexOf(name);
    return index === -1 ? KERNEL_TOOL_NAMES.length : index;
  };
  return [...new Set(names)].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
}

export function isKernelToolName(name: string): name is KernelToolName {
  return (KERNEL_TOOL_NAMES as readonly string[]).includes(name);
}
