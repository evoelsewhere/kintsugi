// The kernel `ls` (ADR-0039): pi's flat listing plus a `tree` mode. pi's ls definition cannot
// take extra parameters, so the kernel wraps it — without `tree`/`depth` the call is delegated to
// pi unchanged (same output models already know); with them the listing renders as an indented
// tree under the same path guards. `depth` implies `tree`.

import { createLsToolDefinition, formatSize, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { PathGuard } from "./paths.js";

const DEFAULT_TREE_DEPTH = 3;
const MAX_TREE_DEPTH = 8;
const MAX_TREE_LINES = 500;
const SKIPPED_DIRS = new Set([".git", "node_modules"]);

const parameters = Type.Object({
  path: Type.Optional(Type.String({ description: "Absolute path to the directory to list." })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of entries to list." })),
  tree: Type.Optional(Type.Boolean({ description: "Render an indented directory tree instead of a flat listing." })),
  depth: Type.Optional(Type.Number({ description: `Tree depth (default ${DEFAULT_TREE_DEPTH}, max ${MAX_TREE_DEPTH}); implies tree.` })),
});

function clampDepth(depth: number | undefined): number {
  if (depth === undefined || Number.isNaN(depth)) return DEFAULT_TREE_DEPTH;
  return Math.min(Math.max(Math.round(depth), 1), MAX_TREE_DEPTH);
}

export function createKernelLsTool(cwd: string, guard: PathGuard): ToolDefinition {
  const flat = createLsToolDefinition(cwd, {
    operations: {
      exists: async (path) => {
        try {
          await stat(guard.check(path));
          return true;
        } catch {
          return false;
        }
      },
      stat: (path) => stat(guard.check(path)),
      readdir: (path) => readdir(guard.check(path)),
    },
  });
  const wrapped: Record<string, unknown> = {
    ...(flat as unknown as Record<string, unknown>),
    parameters,
    execute: async (
      toolCallId: string,
      params: { path?: string; limit?: number; tree?: boolean; depth?: number },
      signal: AbortSignal | undefined,
      onUpdate: unknown,
      ctx: unknown,
    ): Promise<unknown> => {
      const tree = params.tree === true || params.depth !== undefined;
      if (!tree) {
        return flat.execute(toolCallId, params as never, signal, onUpdate as never, ctx as never);
      }
      const root = params.path ?? cwd;
      guard.check(root);
      const depth = clampDepth(params.depth);
      const lines: string[] = [`${root.replace(/[\\/]+$/, "")}/`];
      let truncated = false;
      const walk = async (dir: string, prefix: string, depthLeft: number): Promise<void> => {
        const entries = (await readdir(guard.check(dir), { withFileTypes: true }))
          .filter((entry) => !SKIPPED_DIRS.has(entry.name))
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          if (lines.length >= MAX_TREE_LINES) {
            truncated = true;
            return;
          }
          const child = join(dir, entry.name);
          if (entry.isDirectory()) {
            lines.push(`${prefix}${entry.name}/`);
            if (depthLeft > 1) await walk(child, `${prefix}  `, depthLeft - 1);
            if (truncated) return;
          } else {
            let size = "";
            try {
              size = ` (${formatSize((await stat(guard.check(child))).size)})`;
            } catch {
              // Unreadable entry: show the name without a size.
            }
            lines.push(`${prefix}${entry.name}${size}`);
          }
        }
      };
      await walk(root, "  ", depth);
      if (truncated) lines.push("  [truncated: tree listing limit reached]");
      return { details: undefined, content: [{ type: "text", text: lines.join("\n") }] };
    },
  };
  return wrapped as unknown as ToolDefinition;
}
