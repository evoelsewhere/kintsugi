// Names of the kernel tools (ADR-0023), without the tools themselves: importable without
// pi, so the API can validate agent tool allowlists (`@kintsugi/runtime/tool-names`).
// The registry in tools.ts is typed against this list, so the two cannot drift.

export const KERNEL_TOOL_NAMES = ["read", "ls", "grep", "find", "outputs_write"] as const;
export type KernelToolName = (typeof KERNEL_TOOL_NAMES)[number];

export function isKernelToolName(name: string): name is KernelToolName {
  return (KERNEL_TOOL_NAMES as readonly string[]).includes(name);
}
