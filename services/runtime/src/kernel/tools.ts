// Kernel tool registry (ADR-0023). Tools are generic and fixed in code; an agent picks
// from them by name. Only tools named in the agent's allowlist are created for a job.
// File tools are pi's own, with their file operations confined to the job workspace.
// Adding a tool here widens what any agent can do: review its security boundary.

import { glob as fsGlob, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, sep } from "node:path";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createKernelGrepTool } from "./grep.js";
import { PathGuard } from "./paths.js";
import type { KernelToolName } from "./tool-names.js";

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

// grep searches in-process (grep.ts): pi's grep needs ripgrep, which a job has no way to get.
const grepTool: ToolFactory = (context) => erase(createKernelGrepTool(context.cwd, readGuard(context)));

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

// write and edit are pi's own tools, working in the job's output directory: a relative path is
// relative to it, and every path (symlinks included) must stay inside it. The read-only roots and
// the rest of the filesystem are out of reach. Each file written is reported as an output.
const outputOperations = (context: ToolContext): { guard: PathGuard; save: (path: string, content: string) => Promise<void> } => {
  const guard = new PathGuard([context.outDir]);
  return {
    guard,
    save: async (path, content) => {
      const target = guard.check(path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
      context.onOutput(relative(guard.check(context.outDir), target).split(sep).join("/"));
    },
  };
};

// pi resolves a relative path against the session's working directory (the first read-only root);
// the output tools run with the output directory as theirs, so `report/result.md` lands in it.
const inOutputDir = (tool: ToolDefinition, outDir: string): ToolDefinition => ({
  ...tool,
  execute: (toolCallId, params, signal, onUpdate, ctx) => tool.execute(toolCallId, params, signal, onUpdate, Object.create(ctx ?? null, { cwd: { value: outDir } })),
});

const writeTool: ToolFactory = (context) => {
  const { guard, save } = outputOperations(context);
  return inOutputDir(
    erase(
      createWriteToolDefinition(context.outDir, {
        operations: {
          writeFile: save,
          mkdir: async (dir) => {
            await mkdir(guard.check(dir), { recursive: true });
          },
        },
      }),
    ),
    context.outDir,
  );
};

const editTool: ToolFactory = (context) => {
  const { guard, save } = outputOperations(context);
  return inOutputDir(
    erase(
      createEditToolDefinition(context.outDir, {
        operations: {
          readFile: (path) => readFile(guard.check(path)),
          access: async (path) => {
            await stat(guard.check(path));
          },
          writeFile: save,
        },
      }),
    ),
    context.outDir,
  );
};

const KERNEL_TOOLS: Record<KernelToolName, ToolFactory> = {
  read: readTool,
  ls: lsTool,
  grep: grepTool,
  find: findTool,
  write: writeTool,
  edit: editTool,
};

export { KERNEL_TOOL_NAMES } from "./tool-names.js";

/** Creates the allowlisted tools; unknown names are rejected by job validation first. */
export function createTools(names: readonly string[], context: ToolContext): ToolDefinition[] {
  return names.map((name) => {
    const factory = (KERNEL_TOOLS as Record<string, ToolFactory | undefined>)[name];
    if (factory === undefined) throw new Error(`unknown tool "${name}"`);
    return factory(context);
  });
}
