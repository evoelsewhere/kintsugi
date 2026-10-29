// Kernel tool registry (ADR-0023). Tools are generic and fixed in code; an agent picks
// from them by name. Only tools named in the agent's allowlist are created for a job.
// File tools are pi's own, with their file operations confined to the job workspace.
// Adding a tool here widens what any agent can do: review its security boundary.

import { glob as fsGlob, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import {
  createEditToolDefinition,
  createFindToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { createKernelGrepTool } from "./grep.js";
import { createKernelGitTool } from "./git.js";
import { createKernelLsTool } from "./ls.js";
import { PathGuard } from "./paths.js";
import { createKernelShellTool } from "./shell.js";
import { CODEMODE_TOOL, SCRIPT_TOOLS } from "./codemode.js";
import { MCP_TOOL_PREFIX } from "./mcp.js";
import { GLOB_ALIAS, isMemoryToolName, isWebToolName, type KernelToolName } from "./tool-names.js";

export interface ToolContext {
  /** Working directory: the job workspace root (ADR-0055); a relative path is resolved against it. */
  cwd: string;
  /** Where ls, grep and find look when given no path: the first read-only root (the as-is code). */
  searchDir: string;
  readOnly: readonly string[];
  outDir: string;
  /** Scratch directory: HOME, TEMP and TMPDIR of every child process the tools start. */
  tmpDir: string;
  /** Reports a file written to outDir (path relative to outDir). */
  onOutput(path: string): void;
  /** Reports the lines of a file `read` or `grep` showed the model (absolute path; `to` null for the rest of the file). */
  onRead?(read: SourceRead): void;
}

/** Lines of a file shown to the model (ADR-0086). */
export interface SourceRead {
  tool: "read" | "grep";
  path: string;
  from: number;
  to: number | null;
}

type ToolFactory = (context: ToolContext) => ToolDefinition;

// pi's definitions are generic over their parameter schema; the registry stores them erased.
const erase = (tool: unknown): ToolDefinition => tool as ToolDefinition;

const readGuard = (context: ToolContext): PathGuard => new PathGuard(context.readOnly);

/**
 * The lines a successful `read` showed, from its parameters and pi's truncation details: from `offset`, as many lines
 * as the output kept, or `limit` of them, or the rest of the file. Undefined when no line was shown (a first line over
 * the size limit).
 */
export function linesShown(params: { offset?: number; limit?: number }, details: unknown): { from: number; to: number | null } | undefined {
  const from = params.offset !== undefined && params.offset > 1 ? Math.floor(params.offset) : 1;
  const truncation = (details as { truncation?: { truncated?: boolean; firstLineExceedsLimit?: boolean; outputLines?: number } } | undefined)?.truncation;
  if (truncation?.firstLineExceedsLimit === true) return undefined;
  if (truncation?.truncated === true && typeof truncation.outputLines === "number") return { from, to: from + Math.max(1, truncation.outputLines) - 1 };
  if (params.limit !== undefined && params.limit > 0) return { from, to: from + Math.floor(params.limit) - 1 };
  return { from, to: null };
}

const readTool: ToolFactory = (context) => {
  const guard = readGuard(context);
  const tool = erase(
    createReadToolDefinition(context.cwd, {
      operations: {
        readFile: (path) => readFile(guard.check(path)),
        access: async (path) => {
          await stat(guard.check(path));
        },
      },
    }),
  );
  const onRead = context.onRead;
  if (onRead === undefined) return tool;
  return {
    ...tool,
    execute: async (toolCallId, params, signal, onUpdate, ctx) => {
      const result = await tool.execute(toolCallId, params, signal, onUpdate, ctx);
      const given = params as { path: string; offset?: number; limit?: number };
      const shown = (result as { isError?: boolean }).isError === true ? undefined : linesShown(given, result.details);
      if (shown !== undefined) onRead({ tool: "read", path: resolve(context.cwd, given.path), ...shown });
      return result;
    },
  };
};

const lsTool: ToolFactory = (context) => erase(createKernelLsTool(context.cwd, readGuard(context), context.searchDir));

// grep searches in-process (grep.ts): pi's grep needs ripgrep, which a job has no way to get.
const grepTool: ToolFactory = (context) => erase(createKernelGrepTool(context.cwd, readGuard(context), context.searchDir, context.onRead));

// pi's find searches the working directory when given no path; here that is the workspace root, which is not
// readable as a whole, so a call without a path searches the first read-only root instead.
const searchingIn = (tool: ToolDefinition, dir: string): ToolDefinition => ({
  ...tool,
  execute: (toolCallId, params, signal, onUpdate, ctx) => {
    const given = params as { path?: string };
    return tool.execute(toolCallId, { ...given, path: given.path ?? dir } as typeof params, signal, onUpdate, ctx);
  },
});

const findTool: ToolFactory = (context) => {
  const guard = readGuard(context);
  return searchingIn(erase(
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
  ), context.searchDir);
};

// Models trained on other harnesses call `glob` (also as `tools.glob` in a codemode script) and failed every
// time: find is the same search, so it answers to that name too (tool-names.ts adds it wherever find is allowed).
const globTool: ToolFactory = (context) => {
  const tool = findTool(context);
  return { ...tool, name: GLOB_ALIAS, label: GLOB_ALIAS };
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

// shell and git run child processes (ADR-0040) through the launcher's runProcess: the job's
// cleared environment, a wall-clock timeout and kill-tree on timeout or abort.
const shellTool: ToolFactory = (context) => erase(createKernelShellTool(context.cwd, context.tmpDir));

const gitTool: ToolFactory = (context) =>
  erase(
    createKernelGitTool(
      context.cwd,
      new PathGuard([...context.readOnly, context.outDir, context.tmpDir]),
      new PathGuard([context.outDir, context.tmpDir]),
      context.tmpDir,
    ),
  );

// `codemode` is pi's own tool, added as an extension (codemode.ts), so it has no factory here.
const KERNEL_TOOLS: Record<Exclude<KernelToolName, typeof CODEMODE_TOOL>, ToolFactory> = {
  read: readTool,
  ls: lsTool,
  grep: grepTool,
  find: findTool,
  write: writeTool,
  edit: editTool,
  shell: shellTool,
  git: gitTool,
};

export { KERNEL_TOOL_NAMES } from "./tool-names.js";

/** Creates the allowlisted tools; unknown names are rejected by job validation first. */
export function createTools(names: readonly string[], context: ToolContext): ToolDefinition[] {
  return names
    // codemode and the MCP tools are pi's own, added as extensions (codemode.ts, mcp.ts): no factory here.
    .filter((name) => name !== CODEMODE_TOOL && !isMemoryToolName(name) && !isWebToolName(name) && !name.startsWith(MCP_TOOL_PREFIX))
    .map((name) => {
      const factory = (KERNEL_TOOLS as Record<string, ToolFactory | undefined>)[name] ?? (name === GLOB_ALIAS ? globTool : undefined);
      if (factory === undefined) throw new Error(`unknown tool "${name}"`);
      const tool = factory(context);
      // A codemode script reaches only the read tools: the others are declared to the model, never to a script.
      return SCRIPT_TOOLS.has(name) ? tool : { ...tool, exposure: "model-only" as const };
    });
}
