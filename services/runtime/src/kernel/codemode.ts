// codemode in the kernel (ADR-0047): the model writes a short JavaScript that calls tools and prints only
// what it needs, so a hundred reads stay out of the context window. pi runs the script in a QuickJS
// sandbox (WebAssembly, in a worker thread) with no file system, network or timers; its only reach is
// the tools it is given. The kernel narrows that reach and bounds the script:
//
//  - a script may call only the read tools (`read`, `ls`, `grep`, `find`) and read-only MCP tools. The
//    other kernel tools are marked `model-only` (not callable from a script at all), and a `tool_call`
//    handler refuses any other nested call as a second line, so a job's write boundary is the same
//    with or without a script;
//  - the `models` global (classifier and image models, billed to the job) is off;
//  - a script gets a deadline and an output cap even when the model asks for none (pi's defaults are
//    "no deadline" and 10000 tokens).

import { createCodemodeExtension, type ExtensionAPI, type ExtensionFactory } from "@earendil-works/pi-coding-agent";
import type { BlockedCallSink } from "./policy.js";

export const CODEMODE_TOOL = "codemode";

/** The kernel tools a script may call. */
export const SCRIPT_TOOLS: ReadonlySet<string> = new Set(["read", "ls", "grep", "find"]);

/** The longest a script may run, and the most output it may return to the model. */
export const SCRIPT_TIMEOUT_MS = 120_000;
export const SCRIPT_MAX_OUTPUT_TOKENS = 8_000;

const OPTIONS_LINE = /^\/\/ @options:(.*)(?:\r?\n|$)/;

/**
 * The script with its options line clamped to the kernel's ceilings: the model's own smaller numbers
 * stay, larger or missing ones become the ceiling. A script whose options line is not valid JSON is left
 * alone, and pi rejects it.
 */
export function boundScript(code: string): string {
  const match = OPTIONS_LINE.exec(code);
  let requested: Record<string, unknown> = {};
  if (match !== null) {
    try {
      const parsed: unknown = JSON.parse(match[1] ?? "");
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return code;
      requested = parsed as Record<string, unknown>;
    } catch {
      return code;
    }
  }
  const ceiling = (value: unknown, limit: number): number => (typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.min(value, limit) : limit);
  const options = { ...requested, timeout_ms: ceiling(requested["timeout_ms"], SCRIPT_TIMEOUT_MS), max_output_tokens: ceiling(requested["max_output_tokens"], SCRIPT_MAX_OUTPUT_TOKENS) };
  const body = match === null ? code : code.slice(match[0].length);
  return `// @options: ${JSON.stringify(options)}\n${body}`;
}

export interface CodemodeOptions {
  /** Whether a nested call to this (MCP) tool is allowed besides the read tools. */
  allowsNestedTool?: (tool: string) => boolean;
  onBlocked: BlockedCallSink;
}

/** The codemode tool and the policy that keeps its scripts to what the job may do. */
export function createCodemodeExtensions(options: CodemodeOptions): ExtensionFactory[] {
  const policy: ExtensionFactory = (pi: ExtensionAPI): void => {
    pi.on("tool_call", (event) => {
      if (event.toolName === CODEMODE_TOOL && event.parentToolCallId === undefined) {
        const input = event.input as { code?: unknown };
        if (typeof input.code === "string") input.code = boundScript(input.code);
        return undefined;
      }
      if (event.parentToolCallId === undefined) return undefined;
      if (SCRIPT_TOOLS.has(event.toolName) || options.allowsNestedTool?.(event.toolName) === true) return undefined;
      const reason = `a codemode script may call only read-only tools (${[...SCRIPT_TOOLS].join(", ")}); "${event.toolName}" is not one`;
      options.onBlocked(event.toolName, reason, event.input);
      return { block: true, reason };
    });
  };
  return [createCodemodeExtension({ mode: "on", models: false }), policy];
}
