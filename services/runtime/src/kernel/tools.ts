// Kernel tool registry (ADR-0023). Tools are generic and fixed in code; an agent picks
// from them by name. Only tools named in the agent's allowlist are created for a job.
// File tools are pi's own, with their file operations confined to the job workspace.
// Adding a tool here widens what any agent can do: review its security boundary.

import { glob as fsGlob, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import {
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { PathGuard } from "./paths.js";

export interface ToolContext {
  /** Working directory: the first read-only root. */
  cwd: string;
  readOnly: readonly string[];
  outDir: string;
  /** Reports a file written to outDir (path relative to outDir). */
  onOutput(path: string): void;
}

type ToolFactory = (context: ToolContext) => ToolDefinition;

// pi's definitions are generic over their parameter schema; the registry stores them erased.
const erase = (tool: unknown): ToolDefinition => tool as ToolDefinition;

const readGuard = (context: ToolContext): PathGuard => new PathGuard(context.readOnly);

const readTool: ToolFactory = (context) => {
  const guard = readGuard(context);
  return erase(
    createReadToolDefinition(context.cwd, {
      operations: {
        readFile: (path) => readFile(guard.check(path)),
        access: async (path) => {
          await stat(guard.check(path));
        },
      },
    }),
  );
};

const lsTool: ToolFactory = (context) => {
  const guard = readGuard(context);
  return erase(
    createLsToolDefinition(context.cwd, {
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
    }),
  );
};

// grep runs ripgrep on the search path; isDirectory() rejects paths outside the workspace
// before it spawns (ripgrep does not follow symlinks by default).
const grepTool: ToolFactory = (context) => {
  const guard = readGuard(context);
  return erase(
    createGrepToolDefinition(context.cwd, {
      operations: {
        isDirectory: async (path) => (await stat(guard.check(path))).isDirectory(),
        readFile: (path) => readFile(guard.check(path), "utf8"),
      },
    }),
  );
};

const findTool: ToolFactory = (context) => {
  const guard = readGuard(context);
  return erase(
    createFindToolDefinition(context.cwd, {
      operations: {
        exists: async (path) => {
          try {
            await stat(guard.check(path));
            return true;
          } catch {
            return false;
          }
        },
        // Supplying glob() also keeps pi from spawning fd, which would skip exists().
        glob: async (pattern, searchPath, options) => {
          const results: string[] = [];
          const skip = (path: string): boolean => /(^|[\\/])(node_modules|\.git)$/.test(path);
          for await (const path of fsGlob(pattern, { cwd: guard.check(searchPath), exclude: skip })) {
            results.push(path);
            if (results.length >= options.limit) break;
          }
          return results;
        },
      },
    }),
  );
};

const outputsWriteTool: ToolFactory = (context) => {
  const guard = new PathGuard([context.outDir]);
  return erase(
    defineTool({
      name: "outputs_write",
      label: "Write output",
      description:
        "Write a file to the job's output directory. `path` is relative to the output directory and must stay inside it; existing files are overwritten.",
      promptSnippet: "outputs_write — write a file to the job output directory",
      parameters: Type.Object({
        path: Type.String({ minLength: 1 }),
        content: Type.String(),
      }),
      execute: async (_toolCallId, params) => {
        let target: string;
        try {
          target = guard.check(`${context.outDir}/${params.path}`);
        } catch {
          return { details: undefined, content: [{ type: "text", text: `Refused: "${params.path}" escapes the output directory.` }], isError: true };
        }
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, params.content, "utf8");
        context.onOutput(params.path);
        return { details: undefined, content: [{ type: "text", text: `wrote ${params.path} (${params.content.length} chars)` }] };
      },
    }),
  );
};

const KERNEL_TOOLS: Record<string, ToolFactory> = {
  read: readTool,
  ls: lsTool,
  grep: grepTool,
  find: findTool,
  outputs_write: outputsWriteTool,
};

export const KERNEL_TOOL_NAMES: readonly string[] = Object.keys(KERNEL_TOOLS);

/** Creates the allowlisted tools; unknown names are rejected by job validation first. */
export function createTools(names: readonly string[], context: ToolContext): ToolDefinition[] {
  return names.map((name) => {
    const factory = KERNEL_TOOLS[name];
    if (factory === undefined) throw new Error(`unknown tool "${name}"`);
    return factory(context);
  });
}
