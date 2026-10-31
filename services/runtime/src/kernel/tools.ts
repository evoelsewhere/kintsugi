// Kernel tool registry (ADR-0023). Tools are generic and fixed in code; an agent picks
// from them by name. Only tools named in the agent's allowlist are created for a job.
// File tools are pi's own, with their file operations confined to the job workspace.
// Adding a tool here widens what any agent can do: review its security boundary.

import { glob as fsGlob, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
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
import { PathGuard, isInside, realPath } from "./paths.js";
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

/** What ls, grep, find and glob answer when asked to search the output folder: models that look for what they wrote loop on a denial. */
export const OUTPUT_FOLDER_NOTE = "Your output folder is write-only and cannot be listed. A step is done when its files are written; reply with your result.";

// A search tool given a path inside the output folder answers with OUTPUT_FOLDER_NOTE instead of running: the folder
// is not readable, and a plain denial or an empty result sends a model looking for its files again and again.
const notInOutput = (tool: ToolDefinition, context: ToolContext): ToolDefinition => {
  const out = realPath(context.outDir);
  return {
    ...tool,
    execute: (toolCallId, params, signal, onUpdate, ctx) => {
      const given = (params as { path?: unknown }).path;
      if (typeof given === "string" && given.trim() !== "" && isInside(out, realPath(resolve(context.cwd, given.trim())))) {
        return Promise.resolve({ content: [{ type: "text" as const, text: OUTPUT_FOLDER_NOTE }], details: undefined }) as ReturnType<ToolDefinition["execute"]>;
      }
      return tool.execute(toolCallId, params, signal, onUpdate, ctx);
    },
  };
};

const lsTool: ToolFactory = (context) => notInOutput(erase(createKernelLsTool(context.cwd, readGuard(context), context.searchDir)), context);

// grep searches in-process (grep.ts): pi's grep needs ripgrep, which a job has no way to get.
const grepTool: ToolFactory = (context) => notInOutput(erase(createKernelGrepTool(context.cwd, readGuard(context), context.searchDir, context.onRead)), context);

// pi's find searches the working directory when given no path; here that is the workspace root, which is not
// readable as a whole, so a call without a path searches the first read-only root instead.
const searchingIn = (tool: ToolDefinition, dir: string): ToolDefinition => ({
  ...tool,
  execute: (toolCallId, params, signal, onUpdate, ctx) => {
    const given = params as { path?: string };
    return tool.execute(toolCallId, { ...given, path: given.path ?? dir } as typeof params, signal, onUpdate, ctx);
  },
});

/**
 * A find pattern names files below the search path only. An absolute or drive pattern, or one with a `..` segment, is
 * refused; fs.glob also climbs out through `{..,x}`, `.[.]` and the like, so the first match outside the search path
 * refuses the pattern too (before it walks the disk), and a match whose real path leaves the readable locations (a
 * link) is left out (T3-004).
 */
function escapingPattern(pattern: string): boolean {
  const normalized = pattern.replaceAll("\\", "/");
  return isAbsolute(pattern) || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..");
}

const findTool: ToolFactory = (context) => {
  const guard = readGuard(context);
  return notInOutput(searchingIn(erase(
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
          const refused = `the pattern "${pattern}" leaves the search path: a find pattern is relative to the search path and names files below it (pass another path instead)`;
          if (escapingPattern(pattern)) throw new Error(refused);
          const results: string[] = [];
          const skip = (path: string): boolean => /(^|[\\/])(node_modules|\.git)$/.test(path);
          const root = guard.check(searchPath);
          for await (const path of fsGlob(pattern, { cwd: root, exclude: skip })) {
            const full = resolve(root, path);
            if (!isInside(root, full)) throw new Error(refused);
            try {
              guard.check(full);
            } catch {
              continue;
            }
            results.push(path);
            if (results.length >= options.limit) break;
          }
          return results;
        },
      },
    }),
  ), context.searchDir), context);
};

// Models trained on other harnesses call `glob` (also as `tools.glob` in a codemode script) and failed every
// time: find is the same search, so it answers to that name too (tool-names.ts adds it wherever find is allowed).
const globTool: ToolFactory = (context) => {
  const tool = findTool(context);
  return { ...tool, name: GLOB_ALIAS, label: GLOB_ALIAS };
};

// write and edit are pi's own tools, working in the job's output directory: a relative path is
// relative to it, and every path (symlinks included) must stay inside it. The read-only roots and
// the rest of the filesystem are out of reach. Each file written is reported as an output. The inside of a
// repository's .git folder is out of reach too: a config or hook written there would make git run a command (T3-003).
const outputOperations = (context: ToolContext): { guard: Pick<PathGuard, "check">; save: (path: string, content: string) => Promise<void> } => {
  const output = new PathGuard([context.outDir]);
  const root = output.check(context.outDir);
  const guard = {
    check: (path: string): string => {
      const real = output.check(path);
      if (relative(root, real).split(sep).some((part) => part.toLowerCase() === ".git")) {
        throw new Error(`path is inside a repository's .git folder, which git keeps: ${path}`);
      }
      return real;
    },
  };
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
