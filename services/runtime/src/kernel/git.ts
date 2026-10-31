// The kernel `git` tool (ADR-0040): git subcommands as an explicit argument list — no shell, no
// alias expansion (the first argument must be a real git command), and no option that redirects
// the repository, loads extra configuration or starts an external helper. Read-only subcommands
// run anywhere in the job workspace; every other subcommand runs only where the job may write
// (the output directory or the scratch), because a mutating command must not touch a checkout
// the job only reads — clone or init the repository there first. The environment is the job's
// cleared one plus git hardening: no system or global configuration, no prompts, no pager,
// neutral commit identity, hooks and fsmonitor pointed at nothing, and only network protocols
// that cannot start a command. Repository configuration can still name a textconv driver; that
// runs inside the same account with no secrets in the environment (ADR-0029), so it is residual
// risk shared with the shell tool, not a new boundary.

import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runProcess } from "../launcher/process.js";
import { jobEnvironment } from "../launcher/script.js";
import { boundOutput } from "./output.js";
import type { PathGuard } from "./paths.js";

const DEFAULT_TIMEOUT_SEC = 120;
const MAX_TIMEOUT_SEC = 600;

/** Subcommands that never change the repository or the working tree. */
const READ_ONLY_SUBCOMMANDS = new Set([
  "blame", "cat-file", "cherry", "count-objects", "describe", "diff", "grep", "log", "ls-files",
  "ls-tree", "merge-base", "name-rev", "range-diff", "rev-parse", "shortlog", "show", "show-ref",
  "status", "version", "whatchanged",
]);

/** Everything the tool accepts. The first argument must be one of these: git would otherwise
 * expand a repository-configured alias — including `alias.x '!command'` — for unknown names. */
const ALL_SUBCOMMANDS = new Set([
  ...READ_ONLY_SUBCOMMANDS,
  "add", "am", "apply", "branch", "checkout", "cherry-pick", "clean", "clone", "commit", "config",
  "fetch", "gc", "init", "merge", "mv", "pull", "push", "rebase", "reflog", "remote", "reset",
  "restore", "revert", "rm", "stash", "submodule", "switch", "tag", "worktree",
]);

/** Options that would take the tool outside its boundary: redirect the repository, load extra
 * configuration (`--config`, `-c`), write files (`--output`) or start an external helper
 * (`--upload-pack`, `-u` on clone, `--exec`, `--ext-diff`, `--textconv`). */
const FORBIDDEN_OPTIONS = [
  "-c", "-C", "-u",
  "--git-dir", "--work-tree", "--exec-path", "--namespace", "--config-env", "--config",
  "--upload-pack", "--receive-pack", "--ext-diff", "--textconv", "--output", "--exec",
  // Another repository or a template from anywhere on disk, a git directory outside, a command that opens files (T3-003).
  "--reference", "--reference-if-able", "--separate-git-dir", "--template", "--open-files-in-pager",
];

/**
 * Short options that start a command, by subcommand. git also takes them bundled (`-qu <cmd>`) or with the value
 * attached (`-u<cmd>`), so any single-dash argument that holds the letter before a value starts is refused. Long
 * options cannot be abbreviated (`--upload=<cmd>`): the environment tells git to refuse abbreviations.
 */
const COMMAND_SHORT_OPTIONS: Readonly<Record<string, string>> = { clone: "u", rebase: "x", grep: "O" };

/** `git config` only reads: one of these forms, and no file of its own choosing. */
const CONFIG_READS = new Set(["--get", "--get-all", "--get-regexp", "--list", "-l", "get", "list"]);
const CONFIG_REFUSED = new Set([
  "--add", "--unset", "--unset-all", "--replace-all", "--rename-section", "--remove-section", "--edit", "-e",
  "set", "unset", "rename-section", "remove-section", "edit", "--file", "--blob",
]);

/** Options of clone whose value is the next argument, so it is not taken for the source or the target. */
const CLONE_VALUE_OPTIONS = new Set(["--depth", "--branch", "-b", "--origin", "-o", "--jobs", "-j", "--filter", "--shallow-since", "--shallow-exclude", "--bundle-uri", "--server-option", "--revision"]);

/** Subcommands that accept `--no-ext-diff` and `--no-textconv`, to keep repository-configured diff drivers and
 * converters (which are commands) out of diff rendering. An empty GIT_EXTERNAL_DIFF or `diff.external` does not
 * switch them off: git takes it as an external diff command named "" and every patch fails (T3-002). */
const TEXTCONV_SUBCOMMANDS = new Set(["diff", "log", "show"]);

const parameters = Type.Object({
  args: Type.Array(Type.String(), {
    description: 'Git arguments starting with the subcommand, e.g. ["log", "--oneline", "-5"].',
  }),
  cwd: Type.Optional(Type.String({
    description: "Directory to run git in (default: the workspace root). Mutating subcommands require a directory under the job's writable area.",
  })),
  timeout: Type.Optional(Type.Number({ description: `Timeout in seconds (default ${DEFAULT_TIMEOUT_SEC}, max ${MAX_TIMEOUT_SEC}).` })),
});

function clampTimeoutSec(timeout: number | undefined): number {
  if (timeout === undefined || Number.isNaN(timeout)) return DEFAULT_TIMEOUT_SEC;
  return Math.min(Math.max(Math.round(timeout), 1), MAX_TIMEOUT_SEC);
}

/**
 * `git diff` with a path outside the repository (or run outside one) compares the two paths as files anywhere on disk,
 * as `--no-index` does: every argument that is not an option must stay in the workspace. A revision resolves to a
 * path inside the directory, so it passes.
 */
function checkDiffPaths(args: readonly string[], dir: string, guard: PathGuard): void {
  let paths = false;
  for (const arg of args) {
    if (!paths && arg === "--") paths = true;
    else if (paths || !arg.startsWith("-")) guard.check(resolve(dir, arg));
  }
}

function findForbiddenOption(subcommand: string, args: readonly string[]): string | undefined {
  const short = COMMAND_SHORT_OPTIONS[subcommand];
  for (const arg of args) {
    const name = arg.includes("=") ? arg.slice(0, arg.indexOf("=")) : arg;
    if (FORBIDDEN_OPTIONS.includes(name)) return arg;
    if (short === undefined || !/^-[^-]/.test(arg)) continue;
    for (const letter of arg.slice(1)) {
      if (letter === short) return arg;
      if (!/[A-Za-z]/.test(letter)) break;
    }
  }
  return undefined;
}

/** A clone source or remote given as a local path (or a file: URL), as the path; undefined for a network URL. */
function localPath(arg: string): string | undefined {
  if (/^file:/i.test(arg)) {
    try {
      return fileURLToPath(arg);
    } catch {
      return arg;
    }
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(arg) || /^[^/\\@]+@[^/\\]+:/.test(arg)) return undefined;
  return arg;
}

/**
 * The paths a subcommand makes or reads a repository at stay in the workspace (T3-003): what init and worktree make,
 * and the target of a clone, where the job may write; the source of a local clone, where it may read.
 */
function checkRepositoryPaths(subcommand: string, args: readonly string[], dir: string, guard: PathGuard, writeGuard: PathGuard): void {
  const outside = (path: string, where: string): Error => new Error(`git "${subcommand}" may not use ${path}: ${where}`);
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (subcommand === "clone" && CLONE_VALUE_OPTIONS.has(arg)) index += 1;
    else if (!arg.startsWith("-")) positional.push(arg);
  }
  const writable = (path: string): void => {
    try {
      writeGuard.check(resolve(dir, path));
    } catch {
      throw outside(path, "a repository is made only in the job's writable area (the output directory or scratch)");
    }
  };
  if (subcommand === "init") positional.forEach(writable);
  // After the action (add, move, remove, ...): the worktree's path, and names that resolve inside the cwd.
  if (subcommand === "worktree") positional.slice(1).forEach(writable);
  if (subcommand === "clone") {
    const [source, ...targets] = positional;
    const local = source === undefined ? undefined : localPath(source);
    if (local !== undefined) {
      try {
        guard.check(resolve(dir, local));
      } catch {
        throw outside(source!, "a local repository is cloned only from inside the job workspace");
      }
    }
    targets.forEach(writable);
  }
}

export function createKernelGitTool(cwd: string, guard: PathGuard, writeGuard: PathGuard, tmp: string): ToolDefinition {
  return defineTool({
    name: "git",
    label: "git",
    description: "Runs a git subcommand in the job workspace. Read-only subcommands (status, log, diff, ...) run anywhere; mutating ones only where the job may write.",
    parameters,
    execute: async (_toolCallId, params, signal) => {
      const [subcommand, ...rest] = params.args;
      if (subcommand === undefined || !ALL_SUBCOMMANDS.has(subcommand)) {
        throw new Error(
          `unknown git subcommand "${subcommand ?? ""}": the first argument must be a git command name (git aliases are not expanded)`,
        );
      }
      const forbidden = findForbiddenOption(subcommand, rest);
      if (forbidden !== undefined) {
        throw new Error(`git option "${forbidden}" is not allowed: it redirects the repository, reaches outside the workspace or starts an external helper (give an option's value as a separate argument)`);
      }
      if (subcommand === "config" && (!rest.some((arg) => CONFIG_READS.has(arg)) || rest.some((arg) => CONFIG_REFUSED.has(arg.split("=")[0]!) || /^-f/.test(arg)))) {
        throw new Error('git "config" only reads here (--get, --get-all, --get-regexp, --list): configuration can make git run commands, so a job does not set it');
      }
      if (subcommand === "diff" && rest.includes("--no-index")) {
        throw new Error('git "diff --no-index" is not allowed: it compares files outside a repository, anywhere on disk; diff commits or the working tree of a repository instead');
      }
      if (subcommand === "submodule" && rest[0] === "foreach") {
        throw new Error('git "submodule foreach" is not allowed: it runs a shell command');
      }
      const dir = params.cwd === undefined ? cwd : guard.check(params.cwd);
      if (subcommand === "diff") checkDiffPaths(rest, dir, guard);
      checkRepositoryPaths(subcommand, rest, dir, guard, writeGuard);
      if (!READ_ONLY_SUBCOMMANDS.has(subcommand)) {
        try {
          writeGuard.check(dir);
        } catch {
          throw new Error(
            `git "${subcommand}" changes the repository and runs only in the job's writable area: pass a cwd under the output directory or scratch (clone or init the repository there first)`,
          );
        }
      }
      await mkdir(join(tmp, "no-hooks"), { recursive: true });
      const env: Record<string, string> = {
        ...jobEnvironment(tmp),
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
        GIT_PAGER: "cat",
        GIT_EDITOR: "true",
        GIT_SEQUENCE_EDITOR: "true",
        GIT_OPTIONAL_LOCKS: "0",
        // A long option abbreviated (`--upload=<cmd>` for --upload-pack) would pass the option checks above.
        GIT_TEST_DISALLOW_ABBREVIATED_OPTIONS: "1",
        // `ext::` and `fd::` transports execute commands; the rest are ordinary remotes.
        // The list is colon-separated (git's GIT_ALLOW_PROTOCOL format).
        GIT_ALLOW_PROTOCOL: "file:git:http:https:ssh",
        GIT_AUTHOR_NAME: "Kintsugi Job",
        GIT_AUTHOR_EMAIL: "job@kintsugi.invalid",
        GIT_COMMITTER_NAME: "Kintsugi Job",
        GIT_COMMITTER_EMAIL: "job@kintsugi.invalid",
        // Command-line-style configuration beats the repository's own config, which is untrusted.
        GIT_CONFIG_COUNT: "5",
        GIT_CONFIG_KEY_0: "core.hooksPath",
        GIT_CONFIG_VALUE_0: join(tmp, "no-hooks"),
        GIT_CONFIG_KEY_1: "core.fsmonitor",
        GIT_CONFIG_VALUE_1: "",
        GIT_CONFIG_KEY_2: "core.pager",
        GIT_CONFIG_VALUE_2: "cat",
        GIT_CONFIG_KEY_3: "core.askpass",
        GIT_CONFIG_VALUE_3: "",
        GIT_CONFIG_KEY_4: "credential.helper",
        GIT_CONFIG_VALUE_4: "",
      };
      const timeoutSec = clampTimeoutSec(params.timeout);
      const result = await runProcess({
        command: "git",
        args: TEXTCONV_SUBCOMMANDS.has(subcommand) ? [subcommand, "--no-ext-diff", "--no-textconv", ...rest] : params.args,
        cwd: dir,
        env,
        timeoutMs: timeoutSec * 1000,
        signal,
      });
      const chunks: string[] = [];
      if (result.stdout !== "") chunks.push(result.stdout);
      if (result.stderr !== "") chunks.push(result.stderr);
      const bounded = boundOutput(chunks.join(chunks.length === 2 ? "\n" : ""), "head");
      let text = bounded.text === "" ? "(no output)" : bounded.text;
      const notices: string[] = bounded.notice === undefined ? [] : [bounded.notice];
      if (result.stopped === "timeout") notices.push(`git timed out after ${timeoutSec}s`);
      else if (result.stopped === "aborted") notices.push("git aborted");
      else if (result.stopped === "output-limit") notices.push("git output exceeded the capture limit");
      else if (result.exitCode !== 0) notices.push(`git exited with code ${result.exitCode}`);
      if (result.truncated) notices.push("output truncated");
      if (result.outlived === true) notices.push("A process it started was still running when it ended; its output was cut there");
      if (notices.length > 0) text = `${text}\n\n[${notices.join(". ")}]`;
      return { details: undefined, content: [{ type: "text", text }] };
    },
  });
}
