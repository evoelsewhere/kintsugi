// The kernel `grep` tool, searched in-process. pi's own grep runs ripgrep and downloads it on
// first use; a runtime job has neither a ripgrep on its PATH nor network access to fetch one
// (ADR-0029), so pi's tool failed every call ("ripgrep (rg) is not available"). This one reads
// the files itself, through the same path guard as `read`, with the same parameters and output
// format as pi's tool so the agents' prompts and habits carry over.
//
// Security: every path is confined with PathGuard (symlinks resolved); symbolic links met while
// walking are skipped, never followed; .git and node_modules are skipped; files larger than
// MAX_FILE_BYTES and binary files are skipped; lines are cut to MAX_SCAN_CHARS before matching,
// which bounds what a backtracking pattern can cost on hostile input.

import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { DEFAULT_MAX_BYTES, defineTool, formatSize, truncateHead, truncateLine, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { PathGuard } from "./paths.js";
import type { SourceRead } from "./tools.js";

const DEFAULT_LIMIT = 100;
/** pi's truncateLine default (its GREP_MAX_LINE_LENGTH, not exported). */
const GREP_MAX_LINE_LENGTH = 500;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SCAN_CHARS = 4096;
const SKIPPED_DIRS = new Set([".git", "node_modules"]);

const parameters = Type.Object({
  pattern: Type.String({ description: "Search pattern (regex or literal string)" }),
  path: Type.Optional(Type.String({ description: "Directory or file to search (default: current directory)" })),
  glob: Type.Optional(Type.String({ description: "Filter files by glob pattern, e.g. '*.ts' or '**/*.spec.ts'" })),
  ignoreCase: Type.Optional(Type.Boolean({ description: "Case-insensitive search (default: false)" })),
  literal: Type.Optional(Type.Boolean({ description: "Treat pattern as literal string instead of regex (default: false)" })),
  context: Type.Optional(Type.Number({ description: "Number of lines to show before and after each match (default: 0)" })),
  limit: Type.Optional(Type.Number({ description: "Maximum number of matches to return (default: 100)" })),
});

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A glob as a regular expression over a `/`-separated relative path: `*`, `?`, `**`, `{a,b}` and
 * `[...]`. A glob without `/` matches the file name anywhere (as ripgrep's --glob does).
 */
export function globToRegExp(glob: string): RegExp {
  let source = "";
  let braces = 0;
  for (let index = 0; index < glob.length; index++) {
    const char = glob[index]!;
    if (char === "*") {
      if (glob[index + 1] === "*") {
        index++;
        if (glob[index + 1] === "/") {
          index++;
          source += "(?:.*/)?";
        } else {
          source += ".*";
        }
      } else {
        source += "[^/]*";
      }
    } else if (char === "?") {
      source += "[^/]";
    } else if (char === "{") {
      braces++;
      source += "(?:";
    } else if (char === "}" && braces > 0) {
      braces--;
      source += ")";
    } else if (char === "," && braces > 0) {
      source += "|";
    } else if (char === "[") {
      const end = glob.indexOf("]", index + 1);
      if (end < 0) {
        source += "\\[";
      } else {
        const body = glob.slice(index + 1, end).replace(/^!/, "^").replace(/\\/g, "\\\\");
        source += `[${body}]`;
        index = end;
      }
    } else {
      source += escapeRegExp(char);
    }
  }
  source += ")".repeat(braces);
  return new RegExp(glob.includes("/") ? `^${source}$` : `(?:^|/)${source}$`);
}

/** Files under `root` (or `root` itself), sorted; symbolic links and skipped folders are not entered. */
async function filesUnder(root: string, isFile: boolean): Promise<string[]> {
  if (isFile) return [root];
  const files: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRS.has(entry.name)) await walk(path);
      } else if (entry.isFile()) {
        files.push(path);
      }
    }
  };
  await walk(root);
  return files;
}

/** Reports runs of consecutive shown lines of a file as one read each. */
function reportShown(origins: ReadonlyArray<{ file: string; line: number }>, onRead: (read: SourceRead) => void): void {
  let current: SourceRead | undefined;
  for (const { file, line } of origins) {
    if (current !== undefined && current.path === file && current.to === line - 1) {
      current.to = line;
      continue;
    }
    if (current !== undefined) onRead(current);
    current = { tool: "grep", path: file, from: line, to: line };
  }
  if (current !== undefined) onRead(current);
}

/** The kernel `grep` tool over the workspace's read-only roots. */
/** `defaultDir`: where a call without a path searches (the workspace root cannot be searched as a whole). */
/** `onRead`: told the lines of each file the output showed (matches and their context), after truncation (ADR-0086). */
export function createKernelGrepTool(cwd: string, guard: PathGuard, defaultDir: string = cwd, onRead?: (read: SourceRead) => void): ToolDefinition {
  return defineTool({
    name: "grep",
    label: "grep",
    description: `Search file contents for a pattern (JavaScript regular expression, or a literal string). Returns matching lines with file paths and line numbers. Skips .git, node_modules, binary files and files over ${formatSize(MAX_FILE_BYTES)}. Output is truncated to ${DEFAULT_LIMIT} matches or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Long lines are truncated to ${GREP_MAX_LINE_LENGTH} chars.`,
    promptSnippet: "Search file contents for patterns",
    parameters,
    execute: async (_toolCallId, params, signal) => {
      const fail = (text: string) => ({ details: undefined, content: [{ type: "text" as const, text }], isError: true });
      let regex: RegExp;
      try {
        regex = new RegExp(params.literal === true ? escapeRegExp(params.pattern) : params.pattern, params.ignoreCase === true ? "i" : "");
      } catch (error) {
        return fail(`Invalid pattern: ${error instanceof Error ? error.message : String(error)}`);
      }
      const searchPath = resolve(cwd, params.path ?? defaultDir);
      let real: string;
      let isDirectory: boolean;
      try {
        real = guard.check(searchPath);
        isDirectory = (await stat(real)).isDirectory();
      } catch (error) {
        return fail(error instanceof Error && error.message.startsWith("path is outside") ? error.message : `Path not found: ${searchPath}`);
      }
      const globRegExp = params.glob === undefined || params.glob === "" ? undefined : globToRegExp(params.glob);
      const context = params.context !== undefined && params.context > 0 ? Math.floor(params.context) : 0;
      const limit = Math.max(1, Math.floor(params.limit ?? DEFAULT_LIMIT));
      const output: string[] = [];
      /** The file and line of each output line, to report what the model was shown. */
      const origins: Array<{ file: string; line: number }> = [];
      let matches = 0;
      let linesTruncated = false;
      const show = (line: string): string => {
        const { text, wasTruncated } = truncateLine(line);
        if (wasTruncated) linesTruncated = true;
        return text;
      };

      for (const file of await filesUnder(real, !isDirectory)) {
        if (signal?.aborted === true) return fail("Operation aborted");
        if (matches >= limit) break;
        const rel = isDirectory ? relative(real, file).split(sep).join("/") : (file.split(sep).at(-1) ?? file);
        if (globRegExp !== undefined && !globRegExp.test(rel)) continue;
        let text: string;
        try {
          guard.check(file);
          if ((await stat(file)).size > MAX_FILE_BYTES) continue;
          const bytes = await readFile(file);
          if (bytes.subarray(0, 8192).includes(0)) continue;
          text = bytes.toString("utf8");
        } catch {
          continue;
        }
        const lines = text.replace(/\r\n?/g, "\n").split("\n");
        let shownUpTo = 0;
        for (let index = 0; index < lines.length && matches < limit; index++) {
          if (!regex.test(lines[index]!.slice(0, MAX_SCAN_CHARS))) continue;
          matches++;
          const start = Math.max(shownUpTo, index - context);
          const end = Math.min(lines.length - 1, index + context);
          for (let at = start; at <= end; at++) {
            output.push(at === index ? `${rel}:${at + 1}: ${show(lines[at]!)}` : `${rel}-${at + 1}- ${show(lines[at]!)}`);
            origins.push({ file, line: at + 1 });
          }
          shownUpTo = end + 1;
        }
      }

      if (matches === 0) return { details: undefined, content: [{ type: "text", text: "No matches found" }] };
      const truncation = truncateHead(output.join("\n"), { maxLines: Number.MAX_SAFE_INTEGER });
      if (onRead !== undefined) reportShown(origins.slice(0, truncation.truncated ? truncation.outputLines : origins.length), onRead);
      const notices: string[] = [];
      if (matches >= limit) notices.push(`${limit} matches limit reached. Use limit=${limit * 2} for more, or refine pattern`);
      if (truncation.truncated) notices.push(`${formatSize(DEFAULT_MAX_BYTES)} limit reached`);
      if (linesTruncated) notices.push(`Some lines truncated to ${GREP_MAX_LINE_LENGTH} chars. Use read tool to see full lines`);
      const text = notices.length > 0 ? `${truncation.content}\n\n[${notices.join(". ")}]` : truncation.content;
      return { details: undefined, content: [{ type: "text", text }] };
    },
  });
}
